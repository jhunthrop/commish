"""THE HISTORY REBUILD: the seasons the store lost, re-created from nflverse with phase A's ingests.

Production pruned these before the dump, so neither the legacy tables nor the loader carry them, and
nine of the ten fits phase B carries as constants cannot be re-run without them (`research/README.md`,
"Unported fits"). Every ingest here is phase A's, each with its own row-for-row parity, so the rows
are the ones the oracle's ingests would have written. Their stamps are deterministic (game-day stamps
for the observations, the cutdown stamp for the week-one rosters), so the archived boards' replay
moments see them as the archive did.

| What the store lost | Seasons | Ingest |
|---|---|---|
| schedule, kickoffs, results, points allowed | 2018-2023 | `ingest_schedule`, `ingest_game_results`, `ingest_points_allowed` |
| box scores, snap counts (`player_week_observations`) | 2018-2022 | `ingest_season`; 2019, which nflverse never published weekly stats for (`STAT_LINE_GAPS`), from play-by-play (`ingest_derived_stat_lines`) |
| player teams (`player_week_teams`) | 2018-2023 | `ingest_season` |
| play-by-play touches and team context, coaches, opponent adjustment | 2018-2023 | `ingest_play_by_play`, `ingest_coaches`, `ingest_opponent_defence` |
| injury filings | 2018-2022 | `ingest_injury_reports` |
| depth charts | 2018-2022 | `ingest_depth_charts` |
| week-one rosters (`preseason_rosters`) | 2021-2024 | `ingest_week1_rosters` |

The schedule goes first: a week-one roster's stamp and a season's week stamps are read from it. Each
step commits on its own (the rebuild is a re-runnable operator ingest; every write is idempotent), so
a stop part way keeps what it wrote and a re-run finishes the rest.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.pipeline.http import Fetcher
from research.pipeline.nflverse import context, derived_stat_lines, ingest, ingest_schedule, injury_reports
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.stat_lines import STAT_LINE_GAPS
from research.pipeline.preseason.ingest import ingest_depth_charts, ingest_week1_rosters

SCHEDULE_SEASONS: Final = tuple(range(2018, 2024))
OBSERVATION_SEASONS: Final = tuple(range(2018, 2023))
PLAYER_TEAM_SEASONS: Final = tuple(range(2018, 2024))
CONTEXT_SEASONS: Final = tuple(range(2018, 2024))
ROSTER_SEASONS: Final = tuple(range(2021, 2025))

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


def rebuild_history(conn: Connection, fetcher: Fetcher, now: datetime, checkpoint: Callable[[], None]) -> HistoryReport:
    """Every step in the table's order, committing after each."""
    seasons = sorted({*SCHEDULE_SEASONS, *OBSERVATION_SEASONS, *ROSTER_SEASONS})
    before = season_counts(conn, seasons)
    report = HistoryReport()
    client = NflverseClient(fetcher)

    def step(line: str) -> None:
        checkpoint()
        report.steps.append(line)

    universe = ingest.ingest_player_universe(conn, client)
    step("universe: refreshed")
    written = sum(
        writer(conn, client, SCHEDULE_SEASONS)
        for writer in (
            ingest_schedule.ingest_schedule,
            ingest_schedule.ingest_game_results,
            ingest_schedule.ingest_points_allowed,
        )
    )
    step(f"schedule {SCHEDULE_SEASONS[0]}-{SCHEDULE_SEASONS[-1]}: {written} team-week observations")
    as_of = ingest.schedule_week_as_of(client, list(PLAYER_TEAM_SEASONS))
    for season in PLAYER_TEAM_SEASONS:
        result = ingest.ingest_season(conn, client, universe, season, as_of.get(season))
        step(
            f"season {season}: {result.observations_written} observations, {result.player_team_edges} player-team edges"
        )
    for season in (s for s in OBSERVATION_SEASONS if s in STAT_LINE_GAPS):
        derived = derived_stat_lines.ingest_derived_stat_lines(conn, client, season)
        step(f"derived stat lines {season}: {derived.stat_lines} lines, {derived.observations_written} observations")
    for season in CONTEXT_SEASONS:
        pbp = context.ingest_play_by_play(conn, client, season)
        step(f"play-by-play {season}: {pbp.plays_read} plays, {pbp.observations_written} observations")
    step(f"coaches: {context.ingest_coaches(conn, client, list(CONTEXT_SEASONS))} observations")
    step(f"opponent adjustment: {context.ingest_opponent_defence(conn, client, list(CONTEXT_SEASONS))} observations")
    filings = injury_reports.ingest_injury_reports(conn, client, list(OBSERVATION_SEASONS))
    step(f"injury filings: {sum(r.observations_written for r in filings)} observations")
    for season in OBSERVATION_SEASONS:
        step(f"depth chart {season}: {ingest_depth_charts(conn, client, season, now)} observations")
    for season in ROSTER_SEASONS:
        rosters = ingest_week1_rosters(conn, client, season, now)
        step(f"week-one rosters {season}: {rosters.written} written of {rosters.entries_read} read")
    after = season_counts(conn, seasons)
    report.counts = [
        TableCount(table, season, before.get((table, season), 0), after.get((table, season), 0))
        for table in COUNTED_TABLES
        for season in seasons
    ]
    return report
