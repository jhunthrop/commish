"""WEEK-ONE ROSTERS AND DEPTH CHARTS (`src/projections/nflverse/rosters.ts`, `preseason/depth.ts`).

The week-one roster is the only source whose facts predate the season they describe (the cutdown
to fifty-three is a late-August deadline). Statuses coarsen to four. The depth chart is the
week-one offensive chart: the legacy files carry week, game type and formation; the dated files
(2025 onward) carry a `dt` snapshot stamp and a position group, and the snapshot taken is the last
one at or before the cutoff.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal

from research.errors import SchemaDriftError
from research.pipeline.jscompat import (
    collation_key,
    from_epoch_ms,
    js_date_parse,
    js_epoch_ms,
    js_is_finite,
    js_is_integer,
    js_number,
    js_trim,
)
from research.pipeline.nflverse.config import SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.observations import PlayerWeekObservation

RosterStatus = Literal["active", "reserve", "practice_squad", "off_roster"]

ROSTER_WEEK = 1
ROSTER_EARLIEST_SEASON = 2021
HISTORICAL_ROSTER_FLOOR = 2003
DEPTH_SOURCE = "nflverse_depth_charts"
DEPTH_METRIC = "depth_team"
_DATED_OFFENSE_POS_GRP = "3WR 1TE"


def roster_file(season: int) -> str:
    return f"roster_weekly_{season}.csv"


def week1_roster_as_of(season: int) -> datetime:
    return datetime(season, 9, 1, tzinfo=UTC)


def week1_roster_as_of_bounded_by(season: int, fetched_at: datetime) -> datetime:
    stamp = week1_roster_as_of(season)
    return stamp if stamp <= fetched_at else fetched_at


def roster_status_of(code: str) -> RosterStatus:
    match js_trim(code).upper():
        case "ACT" | "INA":
            return "active"
        case "DEV":
            return "practice_squad"
        case "CUT" | "RET":
            return "off_roster"
        case _:
            return "reserve"


@dataclass(frozen=True)
class PreseasonRosterEntry:
    season: int
    team: str
    player_id: str
    position: str
    status: RosterStatus
    birth_date: date | None
    draft_year: int | None
    draft_pick: int | None
    draft_club: str | None
    as_of: datetime


def _iso_date(raw: str | None) -> date | None:
    """nflverse's `YYYY-MM-DD` as a date; anything else is a changed release, and refused."""
    return None if raw is None else date.fromisoformat(raw)


def _text(row: CsvRow, column: str) -> str | None:
    raw = row.get(column)
    if raw is None or js_trim(raw) == "":
        return None
    return js_trim(raw)


def _whole(row: CsvRow, column: str, at_least: int) -> int | None:
    raw = _text(row, column)
    if raw is None:
        return None
    value = js_number(raw)
    return int(value) if js_is_integer(value) and value >= at_least else None


def map_week1_rosters(rows: Sequence[CsvRow], season: int, as_of: datetime) -> list[PreseasonRosterEntry]:
    """`mapWeek1Rosters`: one entry per player for week one, the last row for him winning."""
    by_player: dict[str, PreseasonRosterEntry] = {}
    for row in rows:
        if js_number(_text(row, "week") or "") != ROSTER_WEEK:
            continue
        game_type = _text(row, "game_type")
        if game_type is not None and game_type != SEASON_TYPE:
            continue
        if js_number(_text(row, "season") or "") != season:
            continue
        player_id = _text(row, "gsis_id")
        team = _text(row, "team")
        position = _text(row, "position")
        if player_id is None or team is None or position is None:
            continue
        entry_year = _whole(row, "entry_year", 1936)
        by_player[player_id] = PreseasonRosterEntry(
            season=season,
            team=team,
            player_id=player_id,
            position=position,
            status=roster_status_of(_text(row, "status") or ""),
            birth_date=_iso_date(_text(row, "birth_date")),
            draft_year=entry_year if entry_year is not None else _whole(row, "rookie_year", 1936),
            draft_pick=_whole(row, "draft_number", 1),
            draft_club=_text(row, "draft_club"),
            as_of=as_of,
        )
    return sorted(by_player.values(), key=lambda entry: collation_key(entry.player_id))


@dataclass(frozen=True)
class DepthChartResult:
    observations: list[PlayerWeekObservation]
    unknown_players: list[str]


def _required(row: CsvRow, column: str, season: int) -> str:
    value = row.get(column)
    if value is None:
        raise SchemaDriftError(f"depth_charts_{season}.csv has no {column} column; the published schema changed.")
    return js_trim(value)


def _finish(best: dict[str, float], unknown: set[str], season: int, as_of: datetime) -> DepthChartResult:
    ordered = sorted(best.items(), key=lambda item: collation_key(item[0]))
    return DepthChartResult(
        [PlayerWeekObservation(season, 1, pid, DEPTH_SOURCE, DEPTH_METRIC, depth, as_of) for pid, depth in ordered],
        sorted(unknown),
    )


def _take(best: dict[str, float], unknown: set[str], projected: frozenset[str], row: CsvRow, depth: float) -> None:
    player_id = js_trim(row.get("gsis_id") or "")
    if player_id == "" or not js_is_finite(depth) or depth < 1:
        return
    if player_id not in projected:
        unknown.add(player_id)
        return
    best[player_id] = min(best.get(player_id, float("inf")), depth)


def _legacy(rows: Sequence[CsvRow], projected: frozenset[str], season: int, as_of: datetime) -> DepthChartResult:
    best: dict[str, float] = {}
    unknown: set[str] = set()
    for row in rows:
        if _required(row, "week", season) != "1":
            continue
        if _required(row, "game_type", season) != SEASON_TYPE:
            continue
        if _required(row, "formation", season) != "Offense":
            continue
        if js_trim(row.get("gsis_id") or "") == "":
            continue
        _take(best, unknown, projected, row, js_number(_required(row, "depth_team", season)))
    return _finish(best, unknown, season, as_of)


def _dated(rows: Sequence[CsvRow], projected: frozenset[str], season: int, as_of: datetime) -> DepthChartResult:
    cutoff = js_epoch_ms(as_of)
    snapshot: str | None = None
    snapshot_ms = float("-inf")
    for row in rows:
        dt = _required(row, "dt", season)
        parsed = js_date_parse(dt)
        if parsed is None:
            raise SchemaDriftError(f'depth_charts_{season}.csv has a "dt" value "{dt}" that does not parse as a date.')
        ms = js_epoch_ms(parsed)
        if ms > cutoff:
            continue
        if ms > snapshot_ms:
            snapshot, snapshot_ms = dt, ms
    if snapshot is None:
        return DepthChartResult([], [])
    best: dict[str, float] = {}
    unknown: set[str] = set()
    for row in rows:
        if _required(row, "dt", season) != snapshot:
            continue
        if _required(row, "pos_grp", season) != _DATED_OFFENSE_POS_GRP:
            continue
        if js_trim(row.get("gsis_id") or "") == "":
            continue
        _take(best, unknown, projected, row, js_number(_required(row, "pos_rank", season)))
    return _finish(best, unknown, season, from_epoch_ms(snapshot_ms))


def map_depth_chart(
    rows: Sequence[CsvRow], projected: frozenset[str], season: int, as_of: datetime
) -> DepthChartResult:
    """`mapDepthChart`: whichever of the two published schemas the file carries."""
    if not rows:
        return DepthChartResult([], [])
    if "week" in rows[0]:
        return _legacy(rows, projected, season, as_of)
    if "dt" in rows[0]:
        return _dated(rows, projected, season, as_of)
    raise SchemaDriftError(
        f"depth_charts_{season}.csv matches neither the legacy week/game_type/formation schema nor the dated "
        "dt/pos_grp schema; the published schema changed again. See mapDepthChart's docblock."
    )
