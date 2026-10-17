"""KICKERS' AND TEAM DEFENSES' WEEKS AS STAT LINES, in the shape the API's one stat read takes (Lane 70a).

`nflverse_kicking_weeks` and `nflverse_team_defense_weeks` hold each week's raw events; the API reads
one statement over `player_week_observations` (`api/internal/boards/weekfacts.go`, `StatLines`),
keyed by universe id, joined through `player_crosswalk` to the provider id the league sync places.
This writes both tables' weeks there as their own source, `nflverse_kdef_week`:

- a kicker's line under his gsis id (the crosswalk's `espn_id` match to his provider id): field goals
  made, missed, attempted and blocked, made and missed by distance (0-19, 20-29, 30-39, 40-49, 50-59,
  60 plus), extra points made, missed, attempted and blocked;
- a defense's line under its synthetic universe row, `team-def:<nflverse code>` (the crosswalk's
  `team_defense` match to `DST-<abbr>`): sacks, interceptions, fumble recoveries, defensive and return
  (special teams) touchdowns, safeties, blocked kicks, points allowed (only once the schedule posts
  the score, never a zero for an unknown), and yards allowed, net (the opponent's passing and rushing
  yards plus its sack yards lost, which nflverse stores as a negative), with the three parts beside it.

WHY A SOURCE OF ITS OWN, IN THE SAME TABLE. The published weekly stats (`nflverse_player_week`) write a
kicker's field goals and every defensive field as zero and have no defense rows, and the fits, the
capsules, the register's grade and the player pages read that source as it is; a source of its own
changes none of them. The API keeps one read: `source = any(...)` over both, the kicker and defense
source first when a metric appears in both (a kicker's `field_goals_made` is zero in the published
stats), e.g. `order by week, player_id, metric, (source = 'nflverse_kdef_week') desc, as_of desc`.

THE STAMP. Each line is stamped as its club's lines of that week are: the newest stamp of the
club-week's edges in `player_week_teams` (one per club-week, the week's snap counts' game day plus
the publication lag). A club-week with no stored line yet waits, counted, and is written by the pass
that finds it. A line is written once per stamp (the observation writer ignores a conflict), so a
re-run writes nothing.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection, func, select

from research.db.schema import NFLVERSE_KICKING_WEEKS, NFLVERSE_TEAM_DEFENSE_WEEKS, PLAYER_WEEK_TEAMS
from research.pipeline.crosswalk import seed_team_defense_universe
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.ingest import schedule_client
from research.pipeline.nflverse.kicking_weeks import KickingWeekIngestReport, ingest_kicking_weeks
from research.pipeline.nflverse.participation import NflverseSource
from research.pipeline.nflverse.team_codes import product_team_code, source_team_code, team_defense_universe_id
from research.pipeline.nflverse.team_defense_weeks import TeamDefenseWeekIngestReport, ingest_team_defense_weeks
from research.pipeline.observations import PlayerWeekObservation, record_observations

KDEF_LINE_SOURCE: Final = NflverseSource.KDEF_WEEK

# `nflverse_kicking_weeks` column -> metric.
KICKING_METRICS: Final[Mapping[str, str]] = MappingProxyType(
    {
        "fg_made": "field_goals_made",
        "fg_att": "field_goals_attempted",
        "fg_missed": "field_goals_missed",
        "fg_blocked": "field_goals_blocked",
        "fg_made_0_19": "field_goals_made_0_19",
        "fg_made_20_29": "field_goals_made_20_29",
        "fg_made_30_39": "field_goals_made_30_39",
        "fg_made_40_49": "field_goals_made_40_49",
        "fg_made_50_59": "field_goals_made_50_59",
        "fg_made_60": "field_goals_made_60_plus",
        "fg_missed_0_19": "field_goals_missed_0_19",
        "fg_missed_20_29": "field_goals_missed_20_29",
        "fg_missed_30_39": "field_goals_missed_30_39",
        "fg_missed_40_49": "field_goals_missed_40_49",
        "fg_missed_50_59": "field_goals_missed_50_59",
        "fg_missed_60": "field_goals_missed_60_plus",
        "pat_made": "extra_points_made",
        "pat_att": "extra_points_attempted",
        "pat_missed": "extra_points_missed",
        "pat_blocked": "extra_points_blocked",
    }
)
# `nflverse_team_defense_weeks` column -> metric, each written as stored.
DEFENSE_METRICS: Final[Mapping[str, str]] = MappingProxyType(
    {
        "def_sacks": "sacks",
        "def_interceptions": "defensive_interceptions",
        "fumble_recovery_opp": "defensive_fumbles_recovered",
        "def_tds": "defensive_touchdowns",
        "special_teams_tds": "return_touchdowns",
        "def_safeties": "safeties",
        "passing_yards_allowed": "passing_yards_allowed",
        "rushing_yards_allowed": "rushing_yards_allowed",
        "sack_yards_lost_allowed": "sack_yards_lost_allowed",
    }
)
BLOCKED_KICKS: Final = "blocked_kicks"
_BLOCK_COLUMNS: Final = ("def_punt_blocks", "def_pat_blocks", "def_fg_blocks")
YARDS_ALLOWED: Final = "yards_allowed"
_YARD_COLUMNS: Final = ("passing_yards_allowed", "rushing_yards_allowed", "sack_yards_lost_allowed")
POINTS_ALLOWED: Final = "points_allowed"

Row = Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class ClubWeek:
    """A club's week, the club in the provider's code (`LAR`, `WSH`), whatever spelling the row had."""

    week: int
    team: str


@dataclass(frozen=True, slots=True)
class MappedLines:
    observations: list[PlayerWeekObservation]
    lines: int
    # The club-weeks whose lines wait for the club's stored lines (their stamp).
    waiting: tuple[ClubWeek, ...]
    weeks: tuple[int, ...] = ()


def _club_week(row: Row) -> ClubWeek:
    return ClubWeek(int(row["week"]), product_team_code(str(row["team"])))


def _observations(
    row: Row, player_id: str, values: Mapping[str, float], as_of: datetime
) -> list[PlayerWeekObservation]:
    return [
        PlayerWeekObservation(int(row["season"]), int(row["week"]), player_id, KDEF_LINE_SOURCE, metric, value, as_of)
        for metric, value in values.items()
    ]


def _lines(
    rows: Sequence[Row],
    stamps: Mapping[ClubWeek, datetime],
    player_of: Callable[[Row], str],
    values_of: Callable[[Row], dict[str, float]],
) -> MappedLines:
    observations: list[PlayerWeekObservation] = []
    waiting: list[ClubWeek] = []
    weeks: list[int] = []
    for row in rows:
        club_week = _club_week(row)
        stamp = stamps.get(club_week)
        if stamp is None:
            waiting.append(club_week)
            continue
        observations += _observations(row, player_of(row), values_of(row), stamp)
        weeks.append(club_week.week)
    return MappedLines(observations, len(weeks), tuple(waiting), tuple(weeks))


def _kicking_values(row: Row) -> dict[str, float]:
    return {metric: float(row[column]) for column, metric in KICKING_METRICS.items()}


def kicking_lines(rows: Sequence[Row], stamps: Mapping[ClubWeek, datetime]) -> MappedLines:
    """Each kicker's week as his line, under his gsis id."""
    return _lines(rows, stamps, lambda row: str(row["player_id"]), _kicking_values)


def defense_universe_id(team: str) -> str:
    """The defense's universe row for a club in any spelling: `STL` and `LAR` are both `team-def:LA`."""
    return team_defense_universe_id(source_team_code(product_team_code(team)))


def _defense_values(row: Row) -> dict[str, float]:
    values = {metric: float(row[column]) for column, metric in DEFENSE_METRICS.items() if row[column] is not None}
    values[BLOCKED_KICKS] = float(sum(row[column] for column in _BLOCK_COLUMNS))
    if all(row[column] is not None for column in _YARD_COLUMNS):
        values[YARDS_ALLOWED] = float(sum(row[column] for column in _YARD_COLUMNS))
    if row[POINTS_ALLOWED] is not None:
        values[POINTS_ALLOWED] = float(row[POINTS_ALLOWED])
    return values


def defense_lines(rows: Sequence[Row], stamps: Mapping[ClubWeek, datetime]) -> MappedLines:
    """Each club's defensive week as its defense's line, under `team-def:<nflverse code>`."""
    return _lines(rows, stamps, lambda row: defense_universe_id(str(row["team"])), _defense_values)


@dataclass(frozen=True, slots=True)
class KdefLinesReport:
    kicker_lines: int
    defense_lines: int
    written: int
    waiting: int
    # Week to (kicker lines, defense lines) this pass mapped.
    by_week: Mapping[int, tuple[int, int]]


def _by_week(kickers: MappedLines, defenses: MappedLines) -> dict[int, tuple[int, int]]:
    return {
        week: (kickers.weeks.count(week), defenses.weeks.count(week))
        for week in sorted({*kickers.weeks, *defenses.weeks})
    }


def club_week_stamps(conn: Connection, season: int) -> dict[ClubWeek, datetime]:
    """Each club-week's newest edge stamp in `player_week_teams`: when its lines became known."""
    edges = PLAYER_WEEK_TEAMS.c
    rows = conn.execute(
        select(edges.week, edges.team, func.max(edges.as_of).label("as_of"))
        .where(edges.season == season)
        .group_by(edges.week, edges.team)
    )
    stamps: dict[ClubWeek, datetime] = {}
    for row in rows:
        club_week = ClubWeek(int(row.week), product_team_code(row.team))
        stamps[club_week] = max(row.as_of, stamps.get(club_week, row.as_of))
    return stamps


def ingest_kdef_lines(conn: Connection, season: int) -> KdefLinesReport:
    """The season's kicking and team-defense weeks as stat lines, stamped as their clubs' lines."""
    stamps = club_week_stamps(conn, season)
    kicking = conn.execute(select(NFLVERSE_KICKING_WEEKS).where(NFLVERSE_KICKING_WEEKS.c.season == season)).mappings()
    defense = conn.execute(
        select(NFLVERSE_TEAM_DEFENSE_WEEKS).where(NFLVERSE_TEAM_DEFENSE_WEEKS.c.season == season)
    ).mappings()
    kickers = kicking_lines([dict(r) for r in kicking], stamps)
    defenses = defense_lines([dict(r) for r in defense], stamps)
    written = record_observations(conn, [*kickers.observations, *defenses.observations])
    waiting = len({*kickers.waiting, *defenses.waiting})
    return KdefLinesReport(kickers.lines, defenses.lines, written, waiting, _by_week(kickers, defenses))


@dataclass(frozen=True, slots=True)
class KdefRefresh:
    kicking: KickingWeekIngestReport
    defense: TeamDefenseWeekIngestReport
    lines: KdefLinesReport

    @property
    def written(self) -> int:
        return self.kicking.written + self.defense.written + self.lines.written

    def summary(self, season: int) -> str:
        k, d, lines = self.kicking, self.defense, self.lines
        return (
            f"{season}: kicking weeks {k.written} written of {k.kicker_rows} kicker rows "
            f"({k.unknown_to_universe} unknown to the universe), team defense weeks {d.written} written "
            f"({d.unpaired} unpaired, {d.without_points_allowed} without points allowed), "
            f"{lines.kicker_lines} kicker and {lines.defense_lines} defense lines, {lines.written} new observations, "
            f"{lines.waiting} club-weeks waiting on their stat lines"
        )

    def detail(self) -> tuple[str, ...]:
        return tuple(
            f"week {week}: {kickers} kicker lines, {defenses} defense lines"
            for week, (kickers, defenses) in self.lines.by_week.items()
        )


def refresh_kdef_season(conn: Connection, client: NflverseClient, season: int) -> KdefRefresh:
    """The season's kicking and team-defense weeks from nflverse, then their lines (the weekly pass's
    step and the operator's one-shot); every write is idempotent. The caller commits."""
    seed_team_defense_universe(conn)
    (kicking,) = ingest_kicking_weeks(conn, client, [season])
    (defense,) = ingest_team_defense_weeks(conn, client, [season], schedule_client(client))
    return KdefRefresh(kicking, defense, ingest_kdef_lines(conn, season))
