"""NFL NEXT GEN STATS, WEEK BY WEEK (`nextgen_stats`, `ngs_<kind>.csv.gz`).

nflverse publishes one file per kind (passing, receiving, rushing) holding every season from 2016,
rebuilt nightly. The per-season files (`ngs_<season>_<kind>`) stopped at 2024 (checked 2026-10-14:
the 2024 ones hold only a header-sized stub), so the season is read out of the all-seasons file.
Rows are keyed by `player_gsis_id`, `season` and `week`; week 0 is NGS's own season summary and is
not stored (a season figure is ours to build from the weeks, weighted by each week's own count, which
is stored beside the averages: targets, receptions, rush attempts, pass attempts). NGS lists only
the players above its own weekly minimum, so a week with no row is a week NGS did not publish him,
never a zero. Columns and their units are the nflverse dictionary's (`dictionary_nextgen_stats`):
percentages are 0 to 100 except `rush_pct_over_expected`, a fraction.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Final

from research.pipeline.nflverse.config import SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.pbp import identifier, number_or_null
from research.pipeline.observations import PlayerWeekObservation

NGS_SOURCE: Final = "nflverse_ngs"
NGS_ID_COLUMNS: Final = ("season", "season_type", "week", "player_gsis_id")


@dataclass(frozen=True, slots=True)
class NgsKind:
    """One NGS file: its kind and each stored column's metric name (prefixed by the kind, because
    passing and receiving both publish `avg_intended_air_yards`)."""

    kind: str
    metrics: Mapping[str, str]

    @property
    def file(self) -> str:
        return f"ngs_{self.kind}.csv.gz"

    @property
    def columns(self) -> tuple[str, ...]:
        return (*NGS_ID_COLUMNS, *self.metrics)


RECEIVING: Final = NgsKind(
    "receiving",
    MappingProxyType(
        {
            "targets": "rec_targets",
            "receptions": "rec_receptions",
            "avg_cushion": "rec_avg_cushion",
            "avg_separation": "rec_avg_separation",
            "avg_intended_air_yards": "rec_avg_intended_air_yards",
            "percent_share_of_intended_air_yards": "rec_share_of_intended_air_yards_pct",
            "catch_percentage": "rec_catch_pct",
            "avg_yac": "rec_avg_yac",
            "avg_expected_yac": "rec_avg_expected_yac",
            "avg_yac_above_expectation": "rec_avg_yac_above_expectation",
        }
    ),
)
RUSHING: Final = NgsKind(
    "rushing",
    MappingProxyType(
        {
            "rush_attempts": "rush_attempts",
            "efficiency": "rush_efficiency",
            "percent_attempts_gte_eight_defenders": "rush_eight_plus_defenders_pct",
            "avg_time_to_los": "rush_avg_time_to_los",
            "rush_yards_over_expected": "rush_yards_over_expected",
            "rush_yards_over_expected_per_att": "rush_yards_over_expected_per_att",
            "rush_pct_over_expected": "rush_over_expected_rate",
        }
    ),
)
PASSING: Final = NgsKind(
    "passing",
    MappingProxyType(
        {
            "attempts": "pass_attempts",
            "avg_time_to_throw": "pass_avg_time_to_throw",
            "avg_completed_air_yards": "pass_avg_completed_air_yards",
            "avg_intended_air_yards": "pass_avg_intended_air_yards",
            "avg_air_yards_differential": "pass_avg_air_yards_differential",
            "aggressiveness": "pass_aggressiveness_pct",
            "max_completed_air_distance": "pass_max_completed_air_distance",
            "completion_percentage_above_expectation": "pass_completion_pct_above_expectation",
        }
    ),
)
NGS_KINDS: Final = (PASSING, RECEIVING, RUSHING)


@dataclass(slots=True)
class NgsWeeks:
    """One kind's rows of one season, as they stream: stored rows, the season's rows read, the
    season-summary rows passed over, the players the universe does not project."""

    kind: NgsKind
    season: int
    week_as_of: Callable[[int], datetime]
    known: frozenset[str]
    observations: list[PlayerWeekObservation] = field(default_factory=list)
    season_rows: int = 0
    summary_rows: int = 0
    unknown: set[str] = field(default_factory=set)

    def add(self, row: CsvRow) -> None:
        season, week = number_or_null(row, "season"), number_or_null(row, "week")
        if season != self.season or row.get("season_type") != SEASON_TYPE or week is None:
            return
        self.season_rows += 1
        if week < 1:
            self.summary_rows += 1
            return
        player = identifier(row, "player_gsis_id")
        if player is None or player not in self.known:
            self.unknown.add(player or "(no id)")
            return
        as_of = self.week_as_of(int(week))
        for column, metric in self.kind.metrics.items():
            value = number_or_null(row, column)
            if value is not None:
                self.observations.append(
                    PlayerWeekObservation(self.season, int(week), player, NGS_SOURCE, metric, value, as_of)
                )
