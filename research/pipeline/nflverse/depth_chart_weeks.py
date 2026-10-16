"""THE WEEKLY DEPTH CHARTS (`nflverse_depth_chart_weeks`): nflverse's `depth_charts_<season>` per week.

The store held week 1 only (`preseason/rosters.py`). The weekly round 4's share models read a player's
chart rank in the week of the game, and a return's evidence may be a row on that week's chart
(preregistration §2.2, §5 item 6). Only the offensive skill positions are kept (QB, RB, FB, WR, TE).

TWO SCHEMAS, AS IN `preseason/rosters.py`.

- **To 2024, one chart per week** (`week`, `game_type`, `formation`, `depth_team`). nflverse's file
  carries no publication time (its columns, and the data dictionary checked 2026-10-16, which
  documents only the 2025 schema's `dt`), so a week's chart is stamped at the in-season pass of its
  week (§5 item 6): the latest Wednesday 18:00 New York before the week's first kickoff, provided it
  falls at least `GAME_LENGTH` after the previous week's last kickoff (that game is over); else (a
  Wednesday game, Christmas 2024) the latest Tuesday 08:00 on the same condition; else (a Wednesday
  afternoon game the week before, PIT at BAL in 2020) the Thursday 14:00 pass; else the week is refused.
- **From 2025, dated snapshots** (`dt`, "the timestamp ... when the data record was loaded", the
  dictionary's words). Each club-game takes the club's latest snapshot loaded at or before one
  millisecond before its kickoff, and only a snapshot loaded after the club's previous kickoff: a
  chart from before the last game is stale, and a game more than one ahead is not yet charted. The
  row's stamp is the snapshot's own instant. A re-run after a newer snapshot adds the newer
  statement beside the older one; a read takes the latest at or before its instant.

A re-run writes nothing new (the whole row, stamp included, is the key).
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from sqlalchemy import Connection

from research.db.schema import NFLVERSE_DEPTH_CHART_WEEKS
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_date_parse, js_is_integer, js_number, js_trim
from research.pipeline.kickoffs import TeamKickoff, stored_kickoffs, week_bounds
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import SEASON_TYPE, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.observations import insert_ignoring_conflicts

DATED_FROM_SEASON: Final = 2025
SKILL_POSITIONS: Final = frozenset({"QB", "RB", "FB", "WR", "TE"})
WEEKLY_COLUMNS: Final = (
    "week",
    "game_type",
    "club_code",
    "formation",
    "depth_team",
    "gsis_id",
    "position",
    "depth_position",
)
DATED_COLUMNS: Final = ("dt", "team", "gsis_id", "pos_grp", "pos_abb", "pos_slot", "pos_rank")
_DATED_OFFENSE: Final = "3WR 1TE"
_NEW_YORK: Final = ZoneInfo("America/New_York")
_TUESDAY, _WEDNESDAY, _THURSDAY = 1, 2, 3
# The in-season passes a week's chart is stamped at (JOBS.md `inseason`), in the order they are tried.
PASSES: Final = ((_WEDNESDAY, time(18, 0)), (_TUESDAY, time(8, 0)), (_THURSDAY, time(14, 0)))
# A pass is taken only once the previous week's last game is over: its kickoff plus this.
GAME_LENGTH: Final = timedelta(hours=4)
_ONE_MS: Final = timedelta(milliseconds=1)


@dataclass(frozen=True, slots=True)
class ChartRow:
    season: int
    week: int
    team: str
    slot: str
    depth_order: int
    player_id: str
    as_of: datetime
    position: str


def _whole(raw: str, what: str, file: str) -> int:
    value = js_number(raw)
    if not js_is_integer(value):
        raise SchemaDriftError(f'{file} has a {what} "{raw}" that is not a whole number; the release changed.')
    return int(value)


def latest_pass_before(first_kickoff: datetime, after: datetime | None) -> datetime:
    """The in-season pass a week's chart is stamped at: the first of `PASSES` whose latest occurrence
    strictly before the week's first kickoff falls after the previous week's last game."""
    local = first_kickoff.astimezone(_NEW_YORK)
    for weekday, at in PASSES:
        days_back = (local.weekday() - weekday) % 7
        candidate = datetime.combine(local.date() - timedelta(days=days_back), at, _NEW_YORK)
        if candidate >= first_kickoff:
            candidate -= timedelta(days=7)
        if after is None or candidate >= after + GAME_LENGTH:
            return candidate.astimezone(UTC)
    raise SchemaDriftError(f"no in-season pass falls between {after} and the kickoff at {first_kickoff}.")


def weekly_stamps(kickoffs: Sequence[TeamKickoff]) -> dict[int, datetime]:
    """Each week's chart stamp, from the stored kickoffs."""
    bounds = week_bounds(list(kickoffs))
    stamps: dict[int, datetime] = {}
    for week in sorted(bounds):
        previous = bounds.get(week - 1)
        stamps[week] = latest_pass_before(bounds[week][0], None if previous is None else previous[1])
    return stamps


@dataclass(slots=True)
class WeeklyCharts:
    """The schema to 2024: every offensive skill row of a regular-season week, stamped by week."""

    season: int
    stamps: Mapping[int, datetime]
    # The clubs of the stored kickoffs: a chart under any other code is a changed release, refused.
    clubs: frozenset[str]
    rows: list[ChartRow] = field(default_factory=list)
    read: int = 0
    no_id: int = 0
    # The files label the chart after the final regular-season week as one more REG week (2016's
    # week 18, 2024's week 19): no regular-season game follows it, so it is passed over and counted.
    after_season: int = 0

    @property
    def file(self) -> str:
        return f"depth_charts_{self.season}.csv"

    def add(self, row: CsvRow) -> None:
        self.read += 1
        if row.get("game_type") != SEASON_TYPE or row.get("formation") != "Offense":
            return
        position = js_trim(row.get("position") or "")
        if position not in SKILL_POSITIONS:
            return
        player = js_trim(row.get("gsis_id") or "")
        if player in ("", "NA"):
            self.no_id += 1
            return
        week = _whole(row.get("week") or "", "week", self.file)
        if week > max(self.stamps, default=0):
            self.after_season += 1
            return
        stamp = self.stamps.get(week)
        if stamp is None:
            raise SchemaDriftError(f"{self.file} has week {week}, which the stored schedule does not hold.")
        slot = js_trim(row.get("depth_position") or "") or position
        depth = _whole(row.get("depth_team") or "", "depth_team", self.file)
        team = js_trim(row.get("club_code") or "")
        if team not in self.clubs:
            raise SchemaDriftError(f'{self.file} has club "{team}", which no stored {self.season} kickoff names.')
        self.rows.append(ChartRow(self.season, week, team, slot, depth, player, stamp, position))


@dataclass(slots=True)
class DatedCharts:
    """The schema from 2025: offensive skill rows by club and snapshot, assigned to club-games."""

    season: int
    clubs: frozenset[str]
    snapshots: dict[str, dict[datetime, list[tuple[str, int, str, str]]]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(list))
    )
    read: int = 0
    no_id: int = 0

    @property
    def file(self) -> str:
        return f"depth_charts_{self.season}.csv"

    def add(self, row: CsvRow) -> None:
        self.read += 1
        if row.get("pos_grp") != _DATED_OFFENSE:
            return
        position = js_trim(row.get("pos_abb") or "")
        if position not in SKILL_POSITIONS:
            return
        player = js_trim(row.get("gsis_id") or "")
        if player in ("", "NA"):
            self.no_id += 1
            return
        raw_dt = row.get("dt") or ""
        loaded = js_date_parse(raw_dt)
        if loaded is None:
            raise SchemaDriftError(f'{self.file} has a "dt" value "{raw_dt}" that does not parse as a date.')
        slot = f"{position}_{_whole(row.get('pos_slot') or '', 'pos_slot', self.file)}"
        rank = _whole(row.get("pos_rank") or "", "pos_rank", self.file)
        team = js_trim(row.get("team") or "")
        self.snapshots[team][loaded].append((slot, rank, player, position))

    def assigned(self, kickoffs: Sequence[TeamKickoff]) -> list[ChartRow]:
        """Each club-game's latest snapshot before its kickoff and after the club's previous one."""
        unknown = sorted(set(self.snapshots) - self.clubs)
        if unknown:
            raise SchemaDriftError(f"{self.file} has clubs {unknown}, which no stored {self.season} kickoff names.")
        rows: list[ChartRow] = []
        by_team: dict[str, list[TeamKickoff]] = defaultdict(list)
        for k in kickoffs:
            by_team[k.team].append(k)
        for team, games in by_team.items():
            loaded = sorted(self.snapshots.get(team, {}))
            previous: datetime | None = None
            for game in sorted(games, key=lambda g: g.at):
                eligible = [t for t in loaded if t <= game.at - _ONE_MS and (previous is None or t > previous)]
                previous = game.at
                if not eligible:
                    continue
                stamp = eligible[-1]
                for slot, rank, player, position in self.snapshots[team][stamp]:
                    rows.append(ChartRow(self.season, game.week, team, slot, rank, player, stamp, position))
        return rows


def record_chart_rows(conn: Connection, rows: Sequence[ChartRow]) -> int:
    distinct = {(r.season, r.week, r.team, r.slot, r.depth_order, r.player_id, r.as_of): r for r in rows}
    return insert_ignoring_conflicts(
        conn,
        NFLVERSE_DEPTH_CHART_WEEKS,
        [
            {
                "season": r.season, "week": r.week, "team": r.team, "slot": r.slot, "depth_order": r.depth_order,
                "player_id": r.player_id, "as_of": r.as_of, "position": r.position,
            }
            for r in distinct.values()
        ],
    )  # fmt: skip


@dataclass(frozen=True, slots=True)
class ChartReport:
    season: int
    rows_read: int
    chart_rows: int
    club_weeks: int
    no_id: int
    written: int

    def summary(self) -> str:
        return (
            f"depth charts {self.season}: {self.written} new rows of {self.chart_rows} skill-position rows over "
            f"{self.club_weeks} club-weeks ({self.rows_read} file rows read, {self.no_id} skill rows with no gsis id)"
        )


def chart_rows_for(
    client: NflverseClient, season: int, kickoffs: Sequence[TeamKickoff]
) -> tuple[list[ChartRow], int, int]:
    """The season's chart rows, the file rows read, and the skill rows that carried no id."""
    file = f"depth_charts_{season}.csv"
    clubs = frozenset(k.team for k in kickoffs)
    if season >= DATED_FROM_SEASON:
        dated = DatedCharts(season, clubs)
        client.stream_csv(Releases.DEPTH_CHARTS, file, DATED_COLUMNS, dated.add)
        return dated.assigned(kickoffs), dated.read, dated.no_id
    weekly = WeeklyCharts(season, weekly_stamps(kickoffs), clubs)
    client.stream_csv(Releases.DEPTH_CHARTS, file, WEEKLY_COLUMNS, weekly.add)
    return weekly.rows, weekly.read, weekly.no_id


def ingest_depth_chart_weeks(conn: Connection, client: NflverseClient, season: int) -> ChartReport:
    kickoffs = stored_kickoffs(conn, season)
    if not kickoffs:
        raise SchemaDriftError(f"{season} has no stored kickoffs; ingest the schedule before its depth charts.")
    rows, read, no_id = chart_rows_for(client, season, kickoffs)
    written = record_chart_rows(conn, rows)
    club_weeks = len({(r.week, r.team) for r in rows})
    return ChartReport(season, read, len(rows), club_weeks, no_id, written)
