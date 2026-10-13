"""THE HISTORY REBUILD: the seasons the store lost, re-created from nflverse with phase A's ingests.

Production pruned these before the dump, so neither the legacy tables nor the loader carry them, and
nine of the ten fits phase B carries as constants cannot be re-run without them (`research/README.md`,
"Unported fits"). Every ingest here is phase A's, each with its own row-for-row parity, so the rows
are the ones the oracle's ingests would have written. Their stamps are deterministic (game-day stamps
for the observations, the cutdown stamp for the week-one rosters), so the archived boards' replay
moments see them as the archive did.

| What the store lost | Seasons | Ingest |
|---|---|---|
| schedule, kickoffs, results, points allowed | 2003-2023 | `ingest_schedule`, `ingest_game_results`, `ingest_points_allowed` |
| box scores, snap counts (`player_week_observations`) | 2003-2022 (snap counts from 2012, nflverse's first) | `ingest_season`; 2019, which nflverse never published weekly stats for (`STAT_LINE_GAPS`), from play-by-play (`ingest_derived_stat_lines`) |
| player teams (`player_week_teams`) | 2003-2023 | `ingest_season` |
| play-by-play touches and team context, coaches, opponent adjustment | 2003-2023 | `ingest_play_by_play`, `ingest_coaches`, `ingest_opponent_defence` |
| injury filings | 2009-2022 (nflverse's first is 2009) | `ingest_injury_reports` |
| depth charts | 2003-2022 | `ingest_depth_charts` |
| week-one rosters (`preseason_rosters`) | 2003-2024 | `ingest_week1_rosters` |

The schedule goes first: a week-one roster's stamp and a season's week stamps are read from it. Each
step commits on its own (the rebuild is a re-runnable operator ingest; every write is idempotent), so
a stop part way keeps what it wrote and a re-run finishes the rest.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.errors import SchemaDriftError
from research.pipeline.http import Fetcher
from research.pipeline.nflverse import context, derived_stat_lines, ingest, ingest_schedule, injury_reports
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.stat_lines import STAT_LINE_GAPS
from research.pipeline.preseason.ingest import ingest_depth_charts, ingest_week1_rosters

# The seasons each table needs for every fit phase B carries as constants (`research/README.md`,
# "Unported fits"; `model/fit_inputs.py` checks them): the laws and the rookie curves reach back to
# 2003, the blend and the market curves to 2013, the kicker and defense priors to 2013. nflverse's
# injury filings start in 2009, so that is as far back as they go.
FIRST_SEASON: Final = 2003
SCHEDULE_SEASONS: Final = tuple(range(FIRST_SEASON, 2024))
OBSERVATION_SEASONS: Final = tuple(range(FIRST_SEASON, 2023))
PLAYER_TEAM_SEASONS: Final = tuple(range(FIRST_SEASON, 2024))
CONTEXT_SEASONS: Final = tuple(range(FIRST_SEASON, 2024))
INJURY_SEASONS: Final = tuple(range(2009, 2023))
ROSTER_SEASONS: Final = tuple(range(FIRST_SEASON, 2025))

# The tables the rebuild writes, and the season column each is counted by.
COUNTED_TABLES: Final = (
    "player_week_observations",
    "player_week_teams",
    "team_week_observations",
    "preseason_rosters",
    "coaches",
)


@dataclass(frozen=True, slots=True)
class TableCount:
    table: str
    season: int
    before: int
    after: int


@dataclass(slots=True)
class HistoryReport:
    steps: list[str] = field(default_factory=list)
    counts: list[TableCount] = field(default_factory=list)

    def __str__(self) -> str:
        lines = [*self.steps, "table                      season   before    after    added"]
        lines += [
            f"{c.table:<26} {c.season:>6} {c.before:>8} {c.after:>8} {c.after - c.before:>8}"
            for c in self.counts
            if c.before or c.after
        ]
        return "\n".join(lines)


def season_counts(conn: Connection, seasons: Sequence[int]) -> dict[tuple[str, int], int]:
    """Rows per table and season, over the rebuild's tables."""
    counts: dict[tuple[str, int], int] = {}
    for table in COUNTED_TABLES:  # the table names are the constants above, never input
        rows = conn.execute(
            text(f"select season, count(*) as n from research.{table} where season = any(:s) group by season"),
            {"s": list(seasons)},
        )
        for row in rows:
            counts[(table, int(row.season))] = int(row.n)
    return counts


def _within(seasons: tuple[int, ...], window: range | None) -> list[int]:
    return [s for s in seasons if window is None or s in window]


def rebuild_history(
    conn: Connection, fetcher: Fetcher, now: datetime, checkpoint: Callable[[], None], window: range | None = None
) -> HistoryReport:
    """Every step in the table's order, committing after each; `window` limits it to those seasons."""
    schedule, teams, context_seasons = (
        _within(SCHEDULE_SEASONS, window),
        _within(PLAYER_TEAM_SEASONS, window),
        _within(CONTEXT_SEASONS, window),
    )
    observations, injuries, rosters = (
        _within(OBSERVATION_SEASONS, window),
        _within(INJURY_SEASONS, window),
        _within(ROSTER_SEASONS, window),
    )
    seasons = sorted({*schedule, *teams, *rosters})
    before = season_counts(conn, seasons)
    report = HistoryReport()
    client = NflverseClient(fetcher)

    def step(line: str) -> None:
        checkpoint()
        report.steps.append(line)

    universe = ingest.ingest_player_universe(conn, client)
    step("universe: refreshed")
    written = sum(
        writer(conn, client, schedule)
        for writer in (
            ingest_schedule.ingest_schedule,
            ingest_schedule.ingest_game_results,
            ingest_schedule.ingest_points_allowed,
        )
    )
    step(f"schedule {schedule[0]}-{schedule[-1]}: {written} team-week observations" if schedule else "schedule: none")
    as_of = ingest.schedule_week_as_of(client, teams)
    for season in teams:
        result = ingest.ingest_season(conn, client, universe, season, as_of.get(season))
        step(
            f"season {season}: {result.observations_written} observations, {result.player_team_edges} player-team edges"
        )
    for season in (s for s in observations if s in STAT_LINE_GAPS):
        derived = derived_stat_lines.ingest_derived_stat_lines(conn, client, season)
        step(f"derived stat lines {season}: {derived.stat_lines} lines, {derived.observations_written} observations")
    for season in context_seasons:
        pbp = context.ingest_play_by_play(conn, client, season)
        step(f"play-by-play {season}: {pbp.plays_read} plays, {pbp.observations_written} observations")
    step(f"coaches: {context.ingest_coaches(conn, client, context_seasons)} observations")
    step(f"opponent adjustment: {context.ingest_opponent_defence(conn, client, context_seasons)} observations")
    for season in injuries:
        try:
            with conn.begin_nested():
                filings = injury_reports.ingest_injury_reports(conn, client, [season])
            step(f"injury filings {season}: {sum(r.observations_written for r in filings)} observations")
        except SchemaDriftError as error:
            # nflverse's older injury files carry rows with no `date_modified`: a filing that cannot
            # be stamped cannot be replayed, so the season is named and left out, as the ingest refuses it.
            step(f"injury filings {season}: not ingested, {error}")
    for season in observations:
        step(f"depth chart {season}: {ingest_depth_charts(conn, client, season, now)} observations")
    for season in rosters:
        roster = ingest_week1_rosters(conn, client, season, now)
        step(f"week-one rosters {season}: {roster.written} written of {roster.entries_read} read")
    after = season_counts(conn, seasons)
    report.counts = [
        TableCount(table, season, before.get((table, season), 0), after.get((table, season), 0))
        for table in COUNTED_TABLES
        for season in seasons
    ]
    return report
