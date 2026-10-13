"""THE DISCOVERED LAWS' CANDIDATES: every threshold, delta and pairwise conjunction the templates
generate from the fitted quantile table, each with its condition.

Ported from `research-ts/src/projections/laws/discovery/{generate,templates}.ts` (the condition
and identity half; the claim sentences are display text and stay with the record page). A law id
names its clause exactly as the TypeScript spells it, so a discovered law in the artifact store is
matched to its candidate by id.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Final, Literal

from research.model.domain import Position, camel_to_snake
from research.model.laws.discovery_facts import DiscoveryFacts, DiscoveryQuantityValues

LOW_QUANTILE_LEVELS: Final = (0.1, 0.2, 0.3)
HIGH_QUANTILE_LEVELS: Final = (0.7, 0.8, 0.9)
QUANTILE_LEVELS: Final = (*LOW_QUANTILE_LEVELS, *HIGH_QUANTILE_LEVELS)
QUANTILE_TAG: Final = {0.1: "q10", 0.2: "q20", 0.3: "q30", 0.7: "q70", 0.8: "q80", 0.9: "q90"}
CANDIDATE_CAP: Final = 6000
MIN_QUANTILE_SAMPLE: Final = 20
Side = Literal["low", "high"]
_ALL: Final[tuple[Position, ...]] = ("QB", "RB", "WR", "TE")
_RECEIVING: Final[tuple[Position, ...]] = ("RB", "WR", "TE")
_PASS_CATCHERS: Final[tuple[Position, ...]] = ("WR", "TE")


def side_of(level: float) -> Side:
    return "low" if level in LOW_QUANTILE_LEVELS else "high"


@dataclass(frozen=True, slots=True)
class QuantityDef:
    id: str
    positions: tuple[Position, ...]
    supports_year_over_year_delta: bool
    is_match_key_quantity: bool = False
    is_match_key_reliability_quantity: bool = False

    def get(self, values: DiscoveryQuantityValues) -> float | None:
        value: float | None = getattr(values, camel_to_snake(self.id))
        return value

    @property
    def emits_level_conditions(self) -> bool:
        return not self.is_match_key_quantity and not self.is_match_key_reliability_quantity


QUANTITY_DEFS: Final = (
    QuantityDef("touches", ("RB",), True),
    QuantityDef("age", _ALL, True),
    QuantityDef("targetShare", _RECEIVING, True),
    QuantityDef("touchdownPointsShare", _ALL, True),
    QuantityDef("redZoneTouchShare", _RECEIVING, True),
    QuantityDef("targetDepth", _PASS_CATCHERS, True),
    QuantityDef("snapShare", _ALL, True),
    QuantityDef("incomingCoachTenureSeasons", _ALL, True),
    QuantityDef("incomingCoachPriorPassRateOverExpected", _ALL, True),
    QuantityDef("experienceYear", _ALL, True),
    QuantityDef("teamPaceSecondsPerPlay", _ALL, True),
    QuantityDef("incomingTeamWinTotal", _ALL, True),
    QuantityDef("incomingTeamWinTotalDelta", _ALL, False),
    QuantityDef("insideTenTouchShare", _RECEIVING, True),
    QuantityDef("teamAirYardsShare", _RECEIVING, True),
    QuantityDef("gamesPlayed", _ALL, True, is_match_key_reliability_quantity=True),
    QuantityDef("draftPick", _ALL, False),
    QuantityDef("pointsPerGame", _ALL, True, is_match_key_quantity=True),
)
QUANTITY_BY_ID: Final = {definition.id: definition for definition in QUANTITY_DEFS}


@dataclass(frozen=True, slots=True)
class ThresholdClause:
    quantity_id: str
    quantile_level: float


@dataclass(frozen=True, slots=True)
class DeltaClause:
    quantity_id: str
    quantile_level: float
    direction: Literal["rose_into", "fell_out_of"]


@dataclass(frozen=True, slots=True)
class AndClause:
    left: ThresholdClause | DeltaClause
    right: ThresholdClause | DeltaClause


Clause = ThresholdClause | DeltaClause | AndClause
Condition = Callable[[DiscoveryFacts], bool | None]


@dataclass(frozen=True, slots=True)
class CandidateLaw:
    id: str
    position: Position
    template: Literal["threshold", "delta", "and"]
    condition: Condition
    clause: Clause


def id_for(position: Position, clause: Clause) -> str:
    """`idFor`."""
    if isinstance(clause, ThresholdClause):
        return f"threshold:{position}:{clause.quantity_id}:{QUANTILE_TAG[clause.quantile_level]}"
    if isinstance(clause, DeltaClause):
        return f"delta:{position}:{clause.quantity_id}:{QUANTILE_TAG[clause.quantile_level]}:{clause.direction}"
    left = id_for(position, clause.left)
    right = id_for(position, clause.right)
    first, second = (left, right) if left < right else (right, left)
    return f"and:{position}:{first}+{second}"


def primary_quantity_id_of(clause: Clause) -> str:
    """`primaryQuantityIdOf`: an `and`'s left clause names it."""
    return primary_quantity_id_of(clause.left) if isinstance(clause, AndClause) else clause.quantity_id


def _in_band(value: float, threshold: float, side: Side) -> bool:
    return value >= threshold if side == "high" else value <= threshold


def _threshold_condition(definition: QuantityDef, threshold: float, side: Side) -> Condition:
    def condition(facts: DiscoveryFacts) -> bool | None:
        value = definition.get(facts.current)
        return None if value is None else _in_band(value, threshold, side)

    return condition


def _delta_condition(definition: QuantityDef, threshold: float, side: Side, direction: str) -> Condition:
    enters = (side == "high") == (direction == "rose_into")

    def condition(facts: DiscoveryFacts) -> bool | None:
        current = definition.get(facts.current)
        prior = None if facts.prior is None else definition.get(facts.prior)
        if current is None or prior is None:
            return None
        was_in = _in_band(prior, threshold, side)
        is_in = _in_band(current, threshold, side)
        return (not was_in and is_in) if enters else (was_in and not is_in)

    return condition


def _kleene_and(a: bool | None, b: bool | None) -> bool | None:
    if a is False or b is False:
        return False
    if a is None or b is None:
        return None
    return True


def _and_condition(left: Condition, right: Condition) -> Condition:
    def condition(facts: DiscoveryFacts) -> bool | None:
        return _kleene_and(left(facts), right(facts))

    return condition


QuantileTable = Mapping[str, Mapping[str, Mapping[float, float]]]


def generate_candidates_from(quantiles: QuantileTable) -> list[CandidateLaw]:  # noqa: PLR0912 - one branch per template, as the oracle generates them
    """`generateCandidatesFrom`: thresholds, then deltas, then conjunctions of high-side thresholds
    within a position, the whole list sorted by id and capped."""
    thresholds: list[CandidateLaw] = []
    deltas: list[CandidateLaw] = []
    high_singles: dict[Position, list[tuple[QuantityDef, ThresholdClause, Condition]]] = {}
    for definition in QUANTITY_DEFS:
        for position in definition.positions:
            levels = quantiles.get(definition.id, {}).get(position)
            if levels is None:
                continue
            seen: dict[Side, set[float]] = {}
            for level in QUANTILE_LEVELS:
                threshold = levels.get(level)
                if threshold is None:
                    continue
                side = side_of(level)
                if threshold in seen.setdefault(side, set()):
                    continue
                seen[side].add(threshold)
                clause = ThresholdClause(definition.id, level)
                condition = _threshold_condition(definition, threshold, side)
                if definition.emits_level_conditions:
                    thresholds.append(CandidateLaw(id_for(position, clause), position, "threshold", condition, clause))
                    if side == "high":
                        high_singles.setdefault(position, []).append((definition, clause, condition))
                if not definition.supports_year_over_year_delta:
                    continue
                for direction in ("rose_into", "fell_out_of"):
                    delta = DeltaClause(definition.id, level, direction)
                    deltas.append(
                        CandidateLaw(
                            id_for(position, delta),
                            position,
                            "delta",
                            _delta_condition(definition, threshold, side, direction),
                            delta,
                        )
                    )
    conjunctions: list[CandidateLaw] = []
    for position, singles in high_singles.items():
        for i, (left_def, left_clause, left_condition) in enumerate(singles):
            for right_def, right_clause, right_condition in singles[i + 1 :]:
                if left_def.id == right_def.id:
                    continue
                clause_and = AndClause(left_clause, right_clause)
                conjunctions.append(
                    CandidateLaw(
                        id_for(position, clause_and),
                        position,
                        "and",
                        _and_condition(left_condition, right_condition),
                        clause_and,
                    )
                )
    ordered = sorted([*thresholds, *deltas, *conjunctions], key=lambda candidate: candidate.id)
    return ordered[:CANDIDATE_CAP]


def _interpolated_quantile(ascending: list[float], level: float) -> float:
    index = level * (len(ascending) - 1)
    lower = int(index // 1)
    upper = -int(-index // 1)
    if lower == upper:
        return ascending[lower]
    weight = index - lower
    return ascending[lower] * (1 - weight) + ascending[upper] * weight


@dataclass(frozen=True, slots=True)
class QuantityRow:
    season: int
    position: Position
    values: DiscoveryQuantityValues


def compute_quantile_table(rows: list[QuantityRow], train_through: int) -> dict[str, dict[str, dict[float, float]]]:
    """`computeQuantileTable`: interpolated quantiles of each quantity per position, train seasons only."""
    table: dict[str, dict[str, dict[float, float]]] = {}
    for definition in QUANTITY_DEFS:
        for position in definition.positions:
            values = sorted(
                value
                for row in rows
                if row.season <= train_through and row.position == position
                for value in (definition.get(row.values),)
                if value is not None
            )
            if len(values) < MIN_QUANTILE_SAMPLE:
                continue
            table.setdefault(definition.id, {})[position] = {
                level: _interpolated_quantile(values, level) for level in QUANTILE_LEVELS
            }
    return table
