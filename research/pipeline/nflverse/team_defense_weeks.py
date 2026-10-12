"""A TEAM DEFENSE'S WEEK (`src/projections/nflverse/team-defense-weeks.ts`).

From the `stats_team` release: a club's own defensive counts, and the yards it ALLOWED read off its
opponent's row for the same week (a row with no opponent row is unpaired and skipped), plus the
points it allowed from the schedule. A null points-allowed never erases a stored one.
"""

import functools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import Connection
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import NFLVERSE_TEAM_DEFENSE_WEEKS
from research.db.upsert import changed_row_where, excluded_set
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_locale_compare, js_trim
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import SEASON_TYPE, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.kicking_weeks import count, parse_season_week
from research.pipeline.nflverse.schedule import SCHEDULE_FILE, SCHEDULE_RELEASE, TeamGame, map_schedule
from research.pipeline.nflverse.team_codes import team_week_key

TEAM_DEFENSE_WEEK_SOURCE = "nflverse_team_defense_weeks"
_INSERT_CHUNK_ROWS = 1_000
_NATURAL_KEYS = ("season", "week", "team", "ingested_at")
_COALESCED = ("points_allowed",)

# Table column -> release column, the club's own row.
_OWN_COLUMNS = {
    "def_sacks": "def_sacks",
    "def_interceptions": "def_interceptions",
    "fumble_recovery_opp": "fumble_recovery_opp",
    "def_tds": "def_tds",
    "def_safeties": "def_safeties",
    "def_punt_blocks": "def_punt_blocks",
    "def_pat_blocks": "def_pat_blocks",
    "def_fg_blocks": "def_fg_blocks",
    "special_teams_tds": "special_teams_tds",
}
# Table column -> release column, read off the OPPONENT's row.
_OPPONENT_COLUMNS = {
    "passing_yards_allowed": "passing_yards",
    "rushing_yards_allowed": "rushing_yards",
    "sack_yards_lost_allowed": "sack_yards_lost",
}
_REQUIRED = (
    "season",
    "week",
    "team",
    "season_type",
    "opponent_team",
    *_OWN_COLUMNS.values(),
    *_OPPONENT_COLUMNS.values(),
)


@dataclass(frozen=True)
class TeamDefenseWeekRow:
    season: int
    week: int
    team: str
    opponent_team: str
    counts: dict[str, float]
    points_allowed: float | None


@dataclass(frozen=True)
class _Parsed:
    season: int
    week: int
    team: str
    opponent_team: str
    row: CsvRow


def points_allowed_by_team_week(games: Sequence[TeamGame]) -> dict[str, float]:
    by_key: dict[str, float] = {}
    for game in games:
        if game.points_against is None:
            continue
        by_key[team_week_key(game.season, game.week, game.team)] = game.points_against
    return by_key


def _assert_shape(rows: Sequence[CsvRow]) -> None:
    if not rows:
        return
    missing = [column for column in _REQUIRED if column not in rows[0]]
    if missing:
        raise SchemaDriftError(
            f"nflverse stats_team file is missing column(s) {', '.join(missing)}. The published schema changed; "
            "mapping this file anyway would read every missing column as zero and grade a defense on a game it never played."
        )


def _parse(rows: Sequence[CsvRow]) -> list[_Parsed]:
    parsed: list[_Parsed] = []
    for row in rows:
        if js_trim(row.get("season_type") or "") != SEASON_TYPE:
            continue
        season, week = parse_season_week(row, "stats_team")
        team = js_trim(row.get("team") or "")
        opponent = js_trim(row.get("opponent_team") or "")
        if team == "" or opponent == "":
            continue
        parsed.append(_Parsed(season, week, team, opponent, row))
    return parsed


def _order(a: TeamDefenseWeekRow, b: TeamDefenseWeekRow) -> int:
    return (a.season - b.season) or (a.week - b.week) or js_locale_compare(a.team, b.team)


def map_team_defense_week_rows(rows: Sequence[CsvRow], points_allowed: Mapping[str, float]) -> list[TeamDefenseWeekRow]:
    _assert_shape(rows)
    by_key = {f"{entry.season}|{entry.week}|{entry.team}": entry for entry in _parse(rows)}
    mapped: list[TeamDefenseWeekRow] = []
    for entry in by_key.values():
        opponent = by_key.get(f"{entry.season}|{entry.week}|{entry.opponent_team}")
        if opponent is None:
            continue
        counts = {field: count(entry.row, column, "stats_team") for field, column in _OWN_COLUMNS.items()}
        counts.update({field: count(opponent.row, column, "stats_team") for field, column in _OPPONENT_COLUMNS.items()})
        mapped.append(
            TeamDefenseWeekRow(
                season=entry.season,
                week=entry.week,
                team=entry.team,
                opponent_team=entry.opponent_team,
                counts=counts,
                points_allowed=points_allowed.get(team_week_key(entry.season, entry.week, entry.team)),
            )
        )
    return sorted(mapped, key=functools.cmp_to_key(_order))


def record_team_defense_week_rows(conn: Connection, rows: Sequence[TeamDefenseWeekRow]) -> int:
    table = NFLVERSE_TEAM_DEFENSE_WEEKS
    written = 0
    for start in range(0, len(rows), _INSERT_CHUNK_ROWS):
        chunk = [
            {
                "season": row.season,
                "week": row.week,
                "team": row.team,
                "opponent_team": row.opponent_team,
                **row.counts,
                "points_allowed": row.points_allowed,
                "source": TEAM_DEFENSE_WEEK_SOURCE,
            }
            for row in rows[start : start + _INSERT_CHUNK_ROWS]
        ]
        statement = insert(table).values(chunk)
        upsert = statement.on_conflict_do_update(
            index_elements=[table.c.season, table.c.week, table.c.team],
            set_=excluded_set(statement, table, _NATURAL_KEYS, _COALESCED),
            where=changed_row_where(statement, table, _NATURAL_KEYS, _COALESCED),
        ).returning(table.c.season)
        written += len(conn.execute(upsert).all())
    return written


@dataclass(frozen=True)
class TeamDefenseWeekIngestReport:
    season: int
    rows_read: int
    written: int
    unpaired: int
    without_points_allowed: int


def ingest_team_defense_weeks(
    conn: Connection, client: NflverseClient, seasons: Sequence[int], schedule_client: NflverseClient
) -> list[TeamDefenseWeekIngestReport]:
    schedule_rows = schedule_client.get_csv(SCHEDULE_RELEASE, SCHEDULE_FILE)
    points_allowed = points_allowed_by_team_week(map_schedule(schedule_rows, seasons))
    reports: list[TeamDefenseWeekIngestReport] = []
    for season in seasons:
        rows = client.get_csv(Releases.STATS_TEAM, f"stats_team_week_{season}.csv")
        mapped = map_team_defense_week_rows(rows, points_allowed)
        regular = sum(1 for row in rows if js_trim(row.get("season_type") or "") == SEASON_TYPE)
        written = record_team_defense_week_rows(conn, mapped)
        reports.append(
            TeamDefenseWeekIngestReport(
                season, len(rows), written, regular - len(mapped), sum(1 for r in mapped if r.points_allowed is None)
            )
        )
    return reports
