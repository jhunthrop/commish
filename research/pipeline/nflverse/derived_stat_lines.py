"""STAT LINES DERIVED FROM PLAY-BY-PLAY, for the seasons nflverse never published weekly stats for
(`src/projections/nflverse/derived-stat-lines.ts`, the computation and the write).

Stored under their own source (`nflverse_pbp_derived`), never mixed into the published one, and
SELF-SUPERSEDING: the write deletes the season's derived rows and writes the fresh ones in one
transaction, because a corrected formula recomputes the same rows under the same stamp and an
insert-or-ignore would keep the stale values forever. Each week is dated from its last game.

The backfill's VALIDATION (the control season's derived points against its published points,
which needs the scoring engine) is the model's concern and lands with it in phase B.
"""

import functools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection

from research.pipeline.jscompat import js_locale_compare, js_string
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.pbp import _sign, flag, identifier, number_or_null
from research.pipeline.nflverse.schedule import kickoff_as_of
from research.pipeline.nflverse.stat_lines import STAT_FIELDS, SeasonStatLine, stat_line_observations
from research.pipeline.nflverse.universe_reads import all_positions
from research.pipeline.observations import PlayerWeekObservation, delete_observations_by_source, record_observations

DERIVED_STAT_LINE_SOURCE = "nflverse_pbp_derived"

READ_COLUMNS: tuple[str, ...] = (
    "season", "week", "season_type", "game_date", "play_type", "two_point_attempt", "passer_player_id",
    "passing_yards", "pass_touchdown", "interception", "rusher_player_id", "rush_attempt", "qb_kneel",
    "rushing_yards", "rush_touchdown", "receiver_player_id", "receiving_yards", "complete_pass", "fumble_lost",
    "fumbled_1_player_id",
)  # fmt: skip

_DERIVED_FIELDS = (
    "passingYards",
    "passingTouchdowns",
    "interceptions",
    "rushingYards",
    "rushingTouchdowns",
    "receivingYards",
    "receivingTouchdowns",
    "receptions",
    "fumblesLost",
)


@dataclass
class DerivedTally:
    season: float
    week: float
    player_id: str
    game_date: str
    totals: dict[str, float]


def _or_zero(value: float | None) -> float:
    """`value ?? 0`: only a missing value is zero (a negative zero stays negative, as in JavaScript)."""
    return 0.0 if value is None else value


class DerivedStatLineAggregator:
    def __init__(self) -> None:
        self._tallies: dict[str, DerivedTally] = {}

    def _tally(self, season: float, week: float, player_id: str, game_date: str) -> DerivedTally:
        key = f"{js_string(season)}|{js_string(week)}|{player_id}"
        existing = self._tallies.get(key)
        if existing is None:
            existing = DerivedTally(season, week, player_id, game_date, dict.fromkeys(_DERIVED_FIELDS, 0.0))
            self._tallies[key] = existing
        return existing

    def add(self, row: CsvRow) -> None:
        if row.get("season_type") != "REG":
            return
        season = number_or_null(row, "season")
        week = number_or_null(row, "week")
        if season is None or week is None or flag(row, "two_point_attempt"):
            return
        game_date = row.get("game_date") or ""
        passer = identifier(row, "passer_player_id")
        if passer is not None:
            totals = self._tally(season, week, passer, game_date).totals
            totals["passingYards"] += _or_zero(number_or_null(row, "passing_yards"))
            totals["passingTouchdowns"] += 1 if flag(row, "pass_touchdown") else 0
            totals["interceptions"] += 1 if flag(row, "interception") else 0
        rusher = identifier(row, "rusher_player_id")
        if rusher is not None and flag(row, "rush_attempt") and not flag(row, "qb_kneel"):
            totals = self._tally(season, week, rusher, game_date).totals
            totals["rushingYards"] += _or_zero(number_or_null(row, "rushing_yards"))
            totals["rushingTouchdowns"] += 1 if flag(row, "rush_touchdown") else 0
        receiver = identifier(row, "receiver_player_id")
        if receiver is not None and row.get("play_type") == "pass":
            totals = self._tally(season, week, receiver, game_date).totals
            totals["receivingYards"] += _or_zero(number_or_null(row, "receiving_yards"))
            totals["receptions"] += 1 if flag(row, "complete_pass") else 0
            totals["receivingTouchdowns"] += 1 if flag(row, "pass_touchdown") else 0
        if flag(row, "fumble_lost"):
            fumbler = identifier(row, "fumbled_1_player_id")
            if fumbler is not None:
                self._tally(season, week, fumbler, game_date).totals["fumblesLost"] += 1

    def lines(self) -> list[DerivedTally]:
        def order(a: DerivedTally, b: DerivedTally) -> int:
            return _sign(a.season - b.season) or _sign(a.week - b.week) or js_locale_compare(a.player_id, b.player_id)

        return sorted(self._tallies.values(), key=functools.cmp_to_key(order))


def week_as_of_from_derived_lines(
    lines: Sequence[DerivedTally], lag_hours: int = PUBLICATION_LAG_HOURS
) -> dict[float, datetime]:
    by_week: dict[float, datetime] = {}
    for line in lines:
        stamp = kickoff_as_of(line.game_date, lag_hours)
        known = by_week.get(line.week)
        if known is None or stamp > known:
            by_week[line.week] = stamp
    return by_week


@dataclass(frozen=True)
class DerivedLines:
    stat_lines: list[SeasonStatLine]
    unknown_players: list[str]


def derive_stat_lines(
    lines: Sequence[DerivedTally], week_as_of: Mapping[float, datetime], known: frozenset[str]
) -> DerivedLines:
    unknown: set[str] = set()
    stat_lines: list[SeasonStatLine] = []
    for tally in lines:
        if tally.player_id not in known:
            unknown.add(tally.player_id)
            continue
        as_of = week_as_of.get(tally.week)
        if as_of is None:
            raise ValueError(
                f"No as-of is known for week {js_string(tally.week)}; weekAsOf must come from "
                "weekAsOfFromDerivedLines built on these same lines."
            )
        values = {field: tally.totals.get(field, 0.0) for field in STAT_FIELDS}
        stat_lines.append(SeasonStatLine(int(tally.season), tally.player_id, int(tally.week), values, as_of))
    return DerivedLines(stat_lines, sorted(unknown))


def derived_stat_line_observations(rows: Sequence[SeasonStatLine]) -> list[PlayerWeekObservation]:
    return stat_line_observations(rows, DERIVED_STAT_LINE_SOURCE)


@dataclass(frozen=True)
class DerivedComputation:
    season: int
    plays_read: int
    unknown_players: int
    derived_lines: list[SeasonStatLine]


def compute_derived_stat_lines(conn: Connection, client: NflverseClient, season: int) -> DerivedComputation:
    """`computeDerivedStatLines`: a second, independent stream of the season's play-by-play. Never writes."""
    aggregator = DerivedStatLineAggregator()
    plays = client.stream_csv(Releases.PBP, f"play_by_play_{season}.csv", READ_COLUMNS, aggregator.add)
    lines = aggregator.lines()
    projected = frozenset(all_positions(conn))
    derived = derive_stat_lines(lines, week_as_of_from_derived_lines(lines), projected)
    return DerivedComputation(season, plays, len(derived.unknown_players), derived.stat_lines)


@dataclass(frozen=True)
class DerivedIngestReport:
    season: int
    plays_read: int
    stat_lines: int
    observations_written: int
    unknown_players: int


def ingest_derived_stat_lines(conn: Connection, client: NflverseClient, season: int) -> DerivedIngestReport:
    """`ingestDerivedStatLines`: delete the season's derived rows and write the fresh ones, atomically."""
    computation = compute_derived_stat_lines(conn, client, season)
    observations = derived_stat_line_observations(computation.derived_lines)
    with conn.begin_nested():
        delete_observations_by_source(conn, season, DERIVED_STAT_LINE_SOURCE)
        written = record_observations(conn, observations)
    return DerivedIngestReport(
        season, computation.plays_read, len(computation.derived_lines), written, computation.unknown_players
    )
