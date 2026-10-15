"""PRO FOOTBALL REFERENCE'S ADVANCED STATS, AS NFLVERSE PUBLISHES THEM (`pfr_advstats`).

nflverse's own release (`advstats_week_<kind>_<season>.csv`, weekly, 2018 on), so it is a nflverse
source: the founder's rule against any manual or recurring Pro Football Reference pull is about
PFR itself, never this release. Rows are keyed by `pfr_player_id`, mapped to the universe through
the `players` release's `pfr_id` (stored on `research.players`); a player with no mapping is counted
and named in the report, never guessed. Each row is stamped from its game's day (`pfr_game_id`
starts with the date), as the snap counts are.

The weekly files carry fewer columns than the season ones (checked 2026-10-14): no air yards, no
average depth of target, no pocket time, no RPO or play-action split. What each weekly file does
carry is stored under its own name (nflverse's columns, `receiving_drop` and `receiving_int` made
plural, `receiving_rat` spelled out); a blank is no row, never a zero.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Final

from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.participation import game_day_as_of
from research.pipeline.nflverse.pbp import identifier, number_or_null
from research.pipeline.observations import PlayerWeekObservation

PFR_SOURCE: Final = "nflverse_pfr_advstats"
PFR_ID_COLUMNS: Final = ("pfr_game_id", "season", "week", "game_type", "pfr_player_id", "pfr_player_name")


@dataclass(frozen=True, slots=True)
class PfrKind:
    kind: str
    metrics: Mapping[str, str]

    def file(self, season: int) -> str:
        return f"advstats_week_{self.kind}_{season}.csv"

    @property
    def columns(self) -> tuple[str, ...]:
        return (*PFR_ID_COLUMNS, *self.metrics)


RECEIVING: Final = PfrKind(
    "rec",
    MappingProxyType(
        {
            "receiving_broken_tackles": "receiving_broken_tackles",
            "receiving_drop": "receiving_drops",
            "receiving_drop_pct": "receiving_drop_pct",
            "receiving_int": "receiving_interceptions",
            "receiving_rat": "receiving_passer_rating",
        }
    ),
)
RUSHING: Final = PfrKind(
    "rush",
    MappingProxyType(
        {
            "carries": "rushing_carries",
            "rushing_yards_before_contact": "rushing_yards_before_contact",
            "rushing_yards_after_contact": "rushing_yards_after_contact",
            "rushing_broken_tackles": "rushing_broken_tackles",
        }
    ),
)
PASSING: Final = PfrKind(
    "pass",
    MappingProxyType(
        {
            "passing_drops": "passing_drops",
            "passing_bad_throws": "passing_bad_throws",
            "passing_bad_throw_pct": "passing_bad_throw_pct",
            "times_sacked": "times_sacked",
            "times_blitzed": "times_blitzed",
            "times_hurried": "times_hurried",
            "times_hit": "times_hit",
            "times_pressured": "times_pressured",
            "times_pressured_pct": "times_pressured_pct",
        }
    ),
)
PFR_KINDS: Final = (PASSING, RECEIVING, RUSHING)


@dataclass(frozen=True, slots=True)
class PfrPlayer:
    player_id: str
    projected: bool


@dataclass(slots=True)
class PfrWeeks:
    """One kind's rows of one season, as they stream, mapped by PFR id to the universe."""

    kind: PfrKind
    by_pfr_id: Mapping[str, PfrPlayer]
    observations: list[PlayerWeekObservation] = field(default_factory=list)
    rows: int = 0
    mapped: set[str] = field(default_factory=set)
    unmapped: dict[str, str] = field(default_factory=dict)
    not_projected: set[str] = field(default_factory=set)

    def add(self, row: CsvRow) -> None:
        if row.get("game_type") != SEASON_TYPE:
            return
        self.rows += 1
        pfr_id = identifier(row, "pfr_player_id")
        season, week = number_or_null(row, "season"), number_or_null(row, "week")
        if pfr_id is None or season is None or week is None:
            return
        player = self.by_pfr_id.get(pfr_id)
        if player is None:
            self.unmapped[pfr_id] = row.get("pfr_player_name") or ""
            return
        if not player.projected:
            self.not_projected.add(pfr_id)
            return
        self.mapped.add(pfr_id)
        as_of = game_day_as_of(row.get("pfr_game_id") or "", PUBLICATION_LAG_HOURS)
        for column, metric in self.kind.metrics.items():
            value = number_or_null(row, column)
            if value is not None:
                self.observations.append(
                    PlayerWeekObservation(int(season), int(week), player.player_id, PFR_SOURCE, metric, value, as_of)
                )
