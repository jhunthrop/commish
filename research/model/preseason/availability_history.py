"""EACH PRIOR SEASON'S RECORD OF AVAILABILITY: games played, and the weeks the archives say a
player could not play or was suspended.

Ported from `research-ts/src/projections/preseason/availability-history.ts` and
`availability/{season-record,week-classification}.ts`.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.preseason.availability import SeasonAvailability, team_games_in
from research.model.reads.observations import season_span, usage_as_of

_UNAVAILABLE_REPORT_STATUSES: Final = ("OUT", "INJURED RESERVE")
_DOUBTFUL: Final = "DOUBTFUL"
_UNAVAILABLE_ROSTER_STATUSES: Final = frozenset(("RES", "PUP", "NON", "EXE"))
_SUSPENSION_ROSTER_STATUSES: Final = frozenset(("SUS",))
_SUSPENSION_STATUS_DETAILS: Final = frozenset(("R30", "R33", "R40"))
_NUMBERED_EXEMPTION: Final = re.compile(r"^E\d{2}$")


@dataclass(frozen=True, slots=True)
class WeeklyRosterStatus:
    week: int
    status: str
    status_detail: str


@dataclass(frozen=True, slots=True)
class WeeklyInjuryReport:
    week: int
    report_status: str
    primary_injury: str


def _normalise(code: str) -> str:
    return code.strip().upper()


def is_unavailable_roster_status(status: str) -> bool:
    code = _normalise(status)
    return code in _UNAVAILABLE_ROSTER_STATUSES or _NUMBERED_EXEMPTION.search(code) is not None


def is_suspended_roster_week(status: str, status_detail: str) -> bool:
    return _normalise(status) in _SUSPENSION_ROSTER_STATUSES or _normalise(status_detail) in _SUSPENSION_STATUS_DETAILS


def classify_week(roster_status: str, roster_status_detail: str, report_status: str | None, played: bool) -> str:
    """`classifyWeek`."""
    if played:
        return "played"
    if is_suspended_roster_week(roster_status, roster_status_detail):
        return "suspended"
    report = _normalise(report_status or "")
    if report in _UNAVAILABLE_REPORT_STATUSES or report == _DOUBTFUL:
        return "unavailable"
    if is_unavailable_roster_status(roster_status):
        return "unavailable"
    return "did_not_play"


def classify_season_weeks(
    roster_rows: Sequence[WeeklyRosterStatus],
    injury_rows: Sequence[WeeklyInjuryReport],
    games_played_weeks: Sequence[int],
) -> dict[str, list[int]]:
    """`classifySeasonWeeks`: each week the player was rostered or played, by class."""
    played = set(games_played_weeks)
    report_by_week = {row.week: row.report_status for row in injury_rows}
    roster_by_week = {row.week: row for row in roster_rows}
    weeks = sorted({*roster_by_week, *played})
    classes: dict[str, list[int]] = {"played": [], "suspended": [], "unavailable": [], "did_not_play": []}
    for week in weeks:
        roster = roster_by_week.get(week)
        weekly = classify_week(
            "" if roster is None else roster.status,
            "" if roster is None else roster.status_detail,
            report_by_week.get(week),
            week in played,
        )
        classes[weekly].append(week)
    return classes


def availability_store_coverage(conn: Connection, seasons: Sequence[int]) -> set[int]:
    """`availabilityStoreCoverage`: seasons both archives hold."""
    if not seasons:
        return set()
    roster = {
        row[0]
        for row in conn.execute(
            text("select distinct season from research.nflverse_roster_weeks where season = any(:s)"),
            {"s": list(seasons)},
        )
    }
    injuries = {
        row[0]
        for row in conn.execute(
            text("select distinct season from research.nflverse_injuries where season = any(:s)"), {"s": list(seasons)}
        )
    }
    return {season for season in roster if season in injuries}


def _grouped[T](seasons: Sequence[int], rows: list[tuple[int, str, T]]) -> dict[int, dict[str, list[T]]]:
    out: dict[int, dict[str, list[T]]] = {season: {} for season in seasons}
    for season, player_id, shaped in rows:
        by_season = out.get(season)
        if by_season is None:
            continue
        by_season.setdefault(player_id, []).append(shaped)
    return out


def roster_weeks_by_season(conn: Connection, seasons: Sequence[int]) -> dict[int, dict[str, list[WeeklyRosterStatus]]]:
    """`rosterWeeksBySeason`."""
    if not seasons:
        return {}
    rows = conn.execute(
        text(
            "select season, week, player_id, status, status_detail from research.nflverse_roster_weeks "
            "where season = any(:s) order by week asc"
        ),
        {"s": list(seasons)},
    )
    return _grouped(
        seasons,
        [(row.season, row.player_id, WeeklyRosterStatus(row.week, row.status, row.status_detail)) for row in rows],
    )


def injury_reports_by_season(
    conn: Connection, seasons: Sequence[int]
) -> dict[int, dict[str, list[WeeklyInjuryReport]]]:
    """`injuryReportsBySeason`."""
    if not seasons:
        return {}
    rows = conn.execute(
        text(
            "select season, week, player_id, report_status, primary_injury from research.nflverse_injuries "
            "where season = any(:s) order by week asc"
        ),
        {"s": list(seasons)},
    )
    return _grouped(
        seasons,
        [
            (row.season, row.player_id, WeeklyInjuryReport(row.week, row.report_status, row.primary_injury))
            for row in rows
        ],
    )


def season_availability_records(
    season: int,
    covered: bool,
    played_weeks: Mapping[str, Sequence[int]],
    roster_rows: Mapping[str, Sequence[WeeklyRosterStatus]],
    injury_rows: Mapping[str, Sequence[WeeklyInjuryReport]],
) -> dict[str, SeasonAvailability]:
    """`seasonAvailabilityRecords`."""
    team_games = team_games_in(season)
    roster_players = list(roster_rows) if covered else []
    players = dict.fromkeys([*played_weeks, *roster_players])
    records: dict[str, SeasonAvailability] = {}
    for player_id in players:
        weeks = played_weeks.get(player_id, [])
        unavailable: int | None = None
        suspended: int | None = None
        if covered:
            classes = classify_season_weeks(roster_rows.get(player_id, []), injury_rows.get(player_id, []), weeks)
            unavailable = min(len(classes["unavailable"]), team_games)
            suspended = min(len(classes["suspended"]), team_games)
        games_played = len(set(weeks))
        if games_played == 0 and (unavailable or 0) == 0:
            continue
        records[player_id] = SeasonAvailability(season, games_played, team_games, unavailable, suspended)
    return records


def _played_weeks_for(conn: Connection, season: int, as_of: datetime) -> dict[str, list[int]]:
    weeks: dict[str, list[int]] = {}
    for row in usage_as_of(conn, season_span(season, as_of)):
        weeks.setdefault(row.player_id, []).append(row.week)
    return weeks


@dataclass(frozen=True, slots=True)
class AvailabilityBySeason:
    covered: frozenset[int]
    by_season: dict[int, dict[str, SeasonAvailability]]


def availability_by_season(conn: Connection, seasons: Sequence[int], as_of: datetime) -> AvailabilityBySeason:
    """`availabilityBySeason`."""
    covered = availability_store_coverage(conn, seasons)
    roster_rows = roster_weeks_by_season(conn, seasons)
    injury_rows = injury_reports_by_season(conn, seasons)
    by_season = {
        season: season_availability_records(
            season,
            season in covered,
            _played_weeks_for(conn, season, as_of),
            roster_rows.get(season, {}),
            injury_rows.get(season, {}),
        )
        for season in seasons
    }
    return AvailabilityBySeason(frozenset(covered), by_season)
