"""THE LAW REGISTRY AND THE REASONS IT GIVES A BOARD.

Ported from `research-ts/src/projections/laws/{registry,board-reasons,clusters,pricing}.ts`. The
measured tribal laws and the discovered laws are fitted artifacts (`laws/measured`,
`laws/discovered` in the artifact store); every entry's stored verdict is re-derived from its
own measurement before it is believed, exactly as the TypeScript refuses a drifted file.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final

from research.model.domain import Position
from research.model.laws.discovery import QUANTITY_BY_ID, CandidateLaw, primary_quantity_id_of
from research.model.laws.discovery_facts import DiscoveryFacts
from research.model.laws.harness import LawMeasurement, Verdict, verdict_for
from research.model.laws.tribal import LAW_ENTRIES, LawConditionFacts, magnitude_for_law

MIN_REPLICATION_PAIRS: Final = 40
MIN_OUT_OF_TRAIN_FOLD_PAIRS: Final = 5
DISCOVERY_TRAIN_THROUGH: Final = 2021


class RegistryDriftError(ValueError):
    """A stored law disagrees with its own measurement, or with the code that reads it."""


@dataclass(frozen=True, slots=True)
class FoldEffect:
    season: int
    pairs: int
    effect: float | None


@dataclass(frozen=True, slots=True)
class Law:
    id: str
    position: str
    claim: str
    measured: LawMeasurement
    train_effect: float
    verdict: Verdict
    model_path: str | None
    origin: str
    has_fold_evidence: bool
    primary_quantity_id: str | None
    primary_quantity_noun: str | None
    primary_quantity_unit: str | None


def _sign(value: float) -> int:
    return (value > 0) - (value < 0)


def verdict_for_full_window(measurement: LawMeasurement, expected_sign: int, folds: Sequence[FoldEffect]) -> Verdict:
    """`verdictForFullWindow`."""
    full = verdict_for(measurement, expected_sign)
    if full != "confirmed":
        return full
    with_pairs = [fold for fold in folds if fold.effect is not None]
    if not with_pairs or not all(_sign(fold.effect or 0.0) == expected_sign for fold in with_pairs):
        return "weak"
    return "confirmed" if measurement.sample >= MIN_REPLICATION_PAIRS else "weak"


def verdict_for_discovered_law(measurement: LawMeasurement, expected_sign: int, folds: Sequence[FoldEffect]) -> Verdict:
    """`verdictForDiscoveredLaw`: the full window, plus one out-of-train fold with enough pairs."""
    base = verdict_for_full_window(measurement, expected_sign, folds)
    if base != "confirmed":
        return base
    replicated = any(
        fold.season > DISCOVERY_TRAIN_THROUGH and fold.effect is not None and fold.pairs >= MIN_OUT_OF_TRAIN_FOLD_PAIRS
        for fold in folds
    )
    return "confirmed" if replicated else "weak"


def _measurement(entry: Mapping[str, Any]) -> LawMeasurement:
    low, high = entry["ci"]
    return LawMeasurement(
        float(entry["effect"]), (float(low), float(high)), int(entry["sample"]), str(entry["seasons"])
    )


def _folds(entry: Mapping[str, Any]) -> list[FoldEffect]:
    return [
        FoldEffect(int(fold["season"]), int(fold["pairs"]), None if fold["effect"] is None else float(fold["effect"]))
        for fold in entry["foldEffects"]
    ]


def registry_from(measured: Mapping[str, Mapping[str, Any]]) -> list[Law]:
    """`registryFrom(LAW_SPECS, measured)`: the tribal laws, in their declared order."""
    known = {entry.id for entry in LAW_ENTRIES}
    unknown = [law_id for law_id in measured if law_id not in known]
    if unknown:
        raise RegistryDriftError(f"measured laws {unknown} have no spec in the code")
    laws: list[Law] = []
    for spec in LAW_ENTRIES:
        entry = measured.get(spec.id)
        if entry is None:
            raise RegistryDriftError(f"law {spec.id} has no measurement")
        measurement = _measurement(entry)
        folds = _folds(entry)
        expected = verdict_for_full_window(measurement, spec.expected_sign, folds)
        if entry["verdict"] != expected:
            raise RegistryDriftError(
                f"{spec.id}: stored verdict {entry['verdict']} but its measurement says {expected}"
            )
        laws.append(
            Law(
                spec.id,
                spec.position,
                spec.claim,
                measurement,
                float(entry["trainEffect"]),
                expected,
                spec.model_path,
                "tribal",
                any(fold.effect is not None for fold in folds),
                None,
                None,
                None,
            )
        )
    return laws


def discovered_laws_from(discovered: Mapping[str, Any], candidate_ids: set[str]) -> list[Law]:
    """`discoveredLawsFrom`: every discovered law, in the artifact's order."""
    entries: Mapping[str, Mapping[str, Any]] = discovered["laws"]
    laws: list[Law] = []
    # The registry's order is the published file's, which `discover-laws` writes in id order; a
    # jsonb payload does not keep key order, so the order is restated rather than inherited.
    for law_id in sorted(entries):
        entry = entries[law_id]
        if law_id not in candidate_ids:
            raise RegistryDriftError(f"discovered law {law_id} is not a candidate the templates generate")
        measurement = _measurement(entry)
        folds = _folds(entry)
        expected = verdict_for_discovered_law(measurement, int(entry["expectedSign"]), folds)
        if entry["verdict"] != expected:
            raise RegistryDriftError(f"{law_id}: stored verdict {entry['verdict']} but its measurement says {expected}")
        laws.append(
            Law(
                law_id,
                str(entry["position"]),
                str(entry["claim"]),
                measurement,
                float(entry["trainEffect"]),
                expected,
                None,
                "discovered",
                any(fold.effect is not None for fold in folds),
                str(entry["primaryQuantityId"]),
                str(entry["primaryQuantityNoun"]),
                str(entry["primaryQuantityUnit"]),
            )
        )
    return laws


def chip_eligible_laws(laws: Sequence[Law]) -> list[Law]:
    """`chipEligibleLaws`."""
    return [
        law for law in laws if law.origin == "tribal" or (law.origin == "discovered" and law.verdict == "confirmed")
    ]


# The pricing gate's ruling (`laws/pricing.ts`): confirmed laws refused admission to pricing.
SUSPECT_LAW_IDS: Final = frozenset(
    (
        "threshold:RB:snapShare:q20",
        "and:WR:threshold:WR:incomingCoachTenureSeasons:q70+threshold:WR:touchdownPointsShare:q70",
        "delta:RB:pointsPerGame:q30:rose_into",
        "delta:RB:pointsPerGame:q70:fell_out_of",
        "delta:TE:pointsPerGame:q80:fell_out_of",
        "delta:WR:pointsPerGame:q20:fell_out_of",
        "delta:WR:pointsPerGame:q70:rose_into",
        "delta:WR:pointsPerGame:q80:fell_out_of",
        "delta:WR:pointsPerGame:q90:fell_out_of",
    )
)


def pricing_eligible_law_ids(laws: Sequence[Law]) -> frozenset[str]:
    """`pricingEligibleLawIds`."""
    return frozenset(law.id for law in chip_eligible_laws(laws) if law.id not in SUSPECT_LAW_IDS)


_CLUSTER_FAMILY_BY_QUANTITY: Final = MappingProxyType(
    {
        "touchdownPointsShare": "goal_line",
        "insideTenTouchShare": "goal_line",
        "redZoneTouchShare": "goal_line",
        "age": "age_experience",
        "experienceYear": "age_experience",
    }
)
_TRIBAL_CLUSTER_FAMILY: Final = MappingProxyType(
    {
        "td_regression": "goal_line",
        "rb_age_curve": "age_experience",
        "rb_workload_cliff": "touches",
        "target_share_persistence": "targetShare",
        "wr_target_competition": "bestTeammateTargetShare",
        "play_caller_fingerprint": "incomingCoachPriorPassRateOverExpected",
    }
)
_THRESHOLD_PARTS: Final = 4
_DELTA_PARTS: Final = 5
_AND_MIN_PARTS: Final = 2


def _single_quantity(law_id: str) -> str | None:
    parts = law_id.split(":")
    if (parts[0] == "threshold" and len(parts) == _THRESHOLD_PARTS) or (
        parts[0] == "delta" and len(parts) == _DELTA_PARTS
    ):
        return parts[2]
    return None


def cluster_key_for(law_id: str) -> str:
    """`clusterKeyFor`: the family a law's reason is priced in."""
    tribal = _TRIBAL_CLUSTER_FAMILY.get(law_id)
    if tribal is not None:
        return tribal
    single = _single_quantity(law_id)
    if single is not None:
        return _CLUSTER_FAMILY_BY_QUANTITY.get(single, single)
    parts = law_id.split(":")
    if parts[0] == "and" and len(parts) > _AND_MIN_PARTS:
        first = ":".join(parts[2:]).split("+")[0]
        quantity = _single_quantity(first)
        if quantity is not None:
            return _CLUSTER_FAMILY_BY_QUANTITY.get(quantity, quantity)
    return law_id


@dataclass(frozen=True, slots=True)
class LawReason:
    """The board's `law` reason."""

    law_id: str
    effect: float
    magnitude: float


def _discovered_reason(
    law: Law, position: Position, facts: DiscoveryFacts, candidates: Mapping[str, CandidateLaw]
) -> LawReason | None:
    candidate = candidates.get(law.id)
    if candidate is None:
        raise RegistryDriftError(
            f'lawReasonsFor: "{law.id}" (discovered) has no matching candidate in generateCandidates()'
        )
    if candidate.position not in ("all", position):
        return None
    primary = primary_quantity_id_of(candidate.clause)
    if law.primary_quantity_id != primary:
        raise RegistryDriftError(
            f'lawReasonsFor: "{law.id}"\'s persisted primaryQuantityId disagrees with the template\'s ("{primary}")'
        )
    if candidate.condition(facts) is not True:
        return None
    magnitude = QUANTITY_BY_ID[primary].get(facts.current)
    if magnitude is None:
        raise RegistryDriftError(f'lawReasonsFor: "{law.id}"\'s condition is true but its primary quantity is unknown')
    return LawReason(law.id, law.measured.effect, magnitude)


def law_reasons_for(
    position: Position,
    facts: LawConditionFacts | None,
    discovery: DiscoveryFacts | None,
    laws: Sequence[Law],
    candidates: Mapping[str, CandidateLaw],
) -> list[LawReason]:
    """`lawReasonsFor`: every confirmed law whose condition held for him, registry order."""
    reasons: list[LawReason] = []
    entries = {entry.id: entry for entry in LAW_ENTRIES}
    for law in laws:
        if law.verdict != "confirmed":
            continue
        if law.origin == "tribal":
            if facts is None:
                continue
            entry = entries.get(law.id)
            if entry is None:
                raise RegistryDriftError(f'lawReasonsFor: "{law.id}" has no condition predicate in LAW_CONDITIONS')
            if not entry.eligible(position) or entry.condition(facts) is not True:
                continue
            magnitude = magnitude_for_law(law.id, facts)
            if magnitude is None:
                raise RegistryDriftError(
                    f'lawReasonsFor: "{law.id}"\'s condition is true but magnitudeForLaw returned null'
                )
            reasons.append(LawReason(law.id, law.measured.effect, magnitude))
            continue
        if discovery is None:
            continue
        reason = _discovered_reason(law, position, discovery, candidates)
        if reason is not None:
            reasons.append(reason)
    return reasons
