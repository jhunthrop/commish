"""THE ACTUALS (`src/projections/nflverse/stat-lines.ts`, `lines.ts`).

What a player really did, from the PUBLISHED weekly stats file, as the same `StatLine` shape a
projection is. Every stat field is written, zeros included: a blank `receiving_yards` for a
quarterback is a positive statement that he gained none.
"""

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_finite, js_number, js_string, js_trim
from research.pipeline.nflverse.config import SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.participation import NflverseSource
from research.pipeline.nflverse.players import PlayerRef, PlayerUniverse, UnresolvedRef, is_projected_candidate
from research.pipeline.observations import PlayerWeekObservation

# Seasons whose published weekly stats file nflverse never released (a deterministic 404).
STAT_LINE_GAPS: tuple[int, ...] = (2019, 2025)
LIVE_ADMITTED_DERIVED_SEASONS: tuple[int, ...] = (2025,)

# `STAT_FIELDS` (`src/domain/player.ts`), in order: the scored fields every line carries.
STAT_FIELDS: tuple[str, ...] = (
    "passingYards",
    "passingTouchdowns",
    "interceptions",
    "rushingYards",
    "rushingTouchdowns",
    "receivingYards",
    "receivingTouchdowns",
    "receptions",
    "fumblesLost",
    "fieldGoalsMade",
    "extraPointsMade",
    "sacks",
    "defensiveInterceptions",
    "defensiveTouchdowns",
)

# nflverse's columns for each field, or none for the fields deliberately left at zero (the
# defensive three are TEAM stats in this product, nflverse's are per person).
_NFLVERSE_COLUMN: Mapping[str, tuple[str, ...]] = {
    "passingYards": ("passing_yards",),
    "passingTouchdowns": ("passing_tds",),
    "interceptions": ("passing_interceptions",),
    "rushingYards": ("rushing_yards",),
    "rushingTouchdowns": ("rushing_tds",),
    "receivingYards": ("receiving_yards",),
    "receivingTouchdowns": ("receiving_tds",),
    "receptions": ("receptions",),
    "fumblesLost": ("sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost"),
    "fieldGoalsMade": (),
    "extraPointsMade": (),
    "sacks": (),
    "defensiveInterceptions": (),
    "defensiveTouchdowns": (),
}

STAT_LINE_SOURCE = NflverseSource.PLAYER_WEEK
_CAPITAL = re.compile(r"[A-Z]")


def stat_metric_name(field: str) -> str:
    """`statMetricName`: `receivingYards` to `receiving_yards`."""
    return _CAPITAL.sub(lambda match: "_" + match.group(0).lower(), field)


@dataclass(frozen=True)
class SeasonStatLine:
    """One player-week outcome: the line's fields keyed by `STAT_FIELDS` name."""

    season: int
    player_id: str
    week: int
    values: Mapping[str, float]
    as_of: datetime


@dataclass(frozen=True)
class StatLinesResult:
    stat_lines: list[SeasonStatLine]
    unresolved: Sequence[UnresolvedRef]
    resolution_rate: float | None


def _stat_value(row: CsvRow, columns: tuple[str, ...]) -> float:
    total = 0.0
    for column in columns:
        raw = row.get(column)
        if raw is None or js_trim(raw) == "":
            continue
        value = js_number(raw)
        if not js_is_finite(value):
            raise SchemaDriftError(f"nflverse weekly stats row has an unreadable {column} (got {json.dumps(raw)}).")
        total += value
    return total


def map_stat_lines(
    player_week: Sequence[CsvRow], week_as_of: Mapping[float, datetime], universe: PlayerUniverse
) -> StatLinesResult:
    """`mapStatLines`: one narrowing (the universe's), throws on a week it cannot date."""
    scored: list[CsvRow] = []
    refs: list[PlayerRef] = []
    for row in player_week:
        if row.get("season_type") != SEASON_TYPE:
            continue
        ref = PlayerRef(kind="gsis", id=row.get("player_id") or "", name=row.get("player_display_name") or "")
        if not is_projected_candidate(universe, ref, row.get("position")):
            continue
        scored.append(row)
        refs.append(ref)
    resolution = universe.resolve_all(refs)

    lines: list[SeasonStatLine] = []
    for row, ref in zip(scored, refs, strict=True):
        player_id = resolution.resolved.get(ref.id)
        if player_id is None:
            continue
        week = js_number(row["week"]) if "week" in row else float("nan")
        as_of = week_as_of.get(week)
        if as_of is None:
            raise SchemaDriftError(
                f"No as-of is known for {row.get('season', 'undefined')} week {js_string(week)}; "
                "the week's snap counts are missing."
            )
        season = js_number(row["season"]) if "season" in row else float("nan")
        lines.append(
            SeasonStatLine(
                season=int(season),
                player_id=player_id,
                week=int(week),
                values={field: _stat_value(row, _NFLVERSE_COLUMN[field]) for field in STAT_FIELDS},
                as_of=as_of,
            )
        )
    return StatLinesResult(
        stat_lines=lines, unresolved=resolution.unresolved, resolution_rate=resolution.resolution_rate
    )


def stat_line_observations(
    rows: Sequence[SeasonStatLine], source: str = STAT_LINE_SOURCE
) -> list[PlayerWeekObservation]:
    """`statLineObservations`: every stat field, zeros included."""
    return [
        PlayerWeekObservation(
            season=row.season,
            week=row.week,
            player_id=row.player_id,
            source=source,
            metric=stat_metric_name(field),
            value=row.values[field],
            as_of=row.as_of,
        )
        for row in rows
        for field in STAT_FIELDS
    ]
