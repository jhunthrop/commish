"""THE BAR OF PLAN SECTION 7, AND THE ONE RECOMMENDATION IT YIELDS.

1. terms minus sheet, pooled PPR over the 24 weeks, >= +0.030 with its lower bound > 0;
2. the QB or the TE difference positive, and no position below -0.02;
3. the pooled difference positive in each season alone.
Amend round 5: 1 to 3, and a QB or TE difference that satisfies 2 is positive in both seasons. Hold for
round 6: 1 to 3 otherwise; or the bar fails and one term alone shows, on QB or TE, a difference of at
least +0.030 with its bound > 0 and a positive sign in each season. Drop: otherwise.
"""

from collections.abc import Mapping
from typing import Any, Final

from research.explore.scheme_elasticity.seasons import PROBE_SEASONS
from research.explore.scheme_elasticity.terms import TERM_POSITIONS, TERMS

MARGIN: Final = 0.030
FLOOR: Final = -0.02
FOCUS: Final = ("QB", "TE")
AMEND: Final = "amend round 5 before lock"
HOLD: Final = "hold for round 6"
DROP: Final = "drop"


def _positive(value: float | None) -> bool:
    return value is not None and value > 0


def bar_lines(comparisons: Mapping[str, Any], source: str = "terms") -> dict[str, Any]:
    pooled = comparisons["pooled"]["vs_sheet"][source]
    by = pooled["by_position"]
    first = (pooled["pooled"] or float("-inf")) >= MARGIN and _positive(pooled["lower_bound"])
    focus = [p for p in FOCUS if _positive(by.get(p))]
    floors = all(by.get(p) is not None and by[p] >= FLOOR for p in by)
    seasons = {str(s): comparisons[str(s)]["vs_sheet"][source] for s in PROBE_SEASONS}
    third = all(_positive(v["pooled"]) for v in seasons.values())
    both = [p for p in focus if all(_positive(v["by_position"].get(p)) for v in seasons.values())]
    return {
        "condition_1": first,
        "condition_2": bool(focus) and floors,
        "condition_3": third,
        "focus_positive": focus,
        "focus_positive_both_seasons": both,
    }


def _term_alone(comparisons: Mapping[str, Any], term: str) -> list[str]:
    """The QB or TE positions where `term` alone clears the margin with a bound > 0, both seasons up."""
    found = comparisons["pooled"]["vs_sheet"][f"only_{term}"]
    passing = []
    for position in (p for p in TERM_POSITIONS[term].split(",") if p in FOCUS):
        value = found["by_position"].get(position)
        bound = found["position_lower_bound"].get(position)
        seasons = [comparisons[str(s)]["vs_sheet"][f"only_{term}"]["by_position"].get(position) for s in PROBE_SEASONS]
        if (value or float("-inf")) >= MARGIN and _positive(bound) and all(_positive(v) for v in seasons):
            passing.append(position)
    return passing


def evaluate(comparisons: Mapping[str, Any]) -> dict[str, Any]:
    lines = bar_lines(comparisons)
    passed = lines["condition_1"] and lines["condition_2"] and lines["condition_3"]
    alone = {t: _term_alone(comparisons, t) for t in TERMS}
    if passed:
        recommendation = AMEND if lines["focus_positive_both_seasons"] else HOLD
    else:
        recommendation = HOLD if any(alone.values()) else DROP
    return {**lines, "passed": passed, "terms_alone_clearing": alone, "recommendation": recommendation}
