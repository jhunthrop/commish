"""THE ROUND'S GATES, AS ONE CONSTANT: `ROUND_THREE`, beside round 2's `ROUND_TWO`.

`docs/research/2026-10-15-weekly-projection-round3-preregistration.md` (the lock, `e58ae444`) is
the authority. Section 5 keeps round 2's population, statistics and thresholds unchanged ("Gates":
G1 to G4 as round 2 wrote them, every number "kept"), so the constant is round 2's `Thresholds`
with every value written out here again, verbatim from section 5, and the gate functions are round
2's (`weekly2.gates`). G5 adds the per-game clause (`isolation_line`). The 26 lines: G1 5, G2 5, G3 2,
G4 13 (12 cells and the chance line), G5 1.
"""

from collections.abc import Mapping, Sequence
from dataclasses import replace
from types import MappingProxyType
from typing import Final

from research.model.ros import gates as ros_gates
from research.model.weekly2 import gates as round_two
from research.model.weekly2.gates import ROUND_TWO, GateLine, Thresholds

FROZEN: Final = MappingProxyType
GATE_LINES: Final = 26  # section 5: "Gate lines: G1 5, G2 5, G3 2, G4 13, G5 1: 26"

ROUND_THREE: Final = Thresholds(
    model_name="commish_weekly_v3",
    # Section 4: fit 2021, 2022, 2023 weeks 6 to 17; judgment 2024 weeks 6 to 17.
    fit_seasons=(2021, 2022, 2023),
    judgment_season=2024,
    weeks=tuple(range(6, 18)),
    # Section 2 item 1: the rate is `commish_ros_v3`'s, refit and equal to its record (section 6).
    rate_round=ros_gates.ROUND_THREE,
    rate_record="2026-10-14-rest-of-season-round3-results.json",
    # Section 5, "Reported, not gated": the rate times round 2's opponent factor, its elasticities
    # refit on this round's fit seasons on round 2's cap and grid (an ablation only).
    factor_low=ROUND_TWO.factor_low,
    factor_high=ROUND_TWO.factor_high,
    elasticity_grid=ROUND_TWO.elasticity_grid,
    # Section 2 item 7: round 2's range: 99 residual percentiles, floor q10, median q50, ceiling q90.
    residual_percentiles=tuple(float(p) for p in range(1, 100)),
    band_percentiles=(10.0, 50.0, 90.0),
    # Section 5, "Population and statistics".
    population=FROZEN({"QB": 36, "RB": 72, "WR": 108, "TE": 36}),
    starters=FROZEN({"QB": 12, "RB": 24, "WR": 24, "TE": 12}),
    min_week_population=8,
    adp_source="ffc_adp_ppr_12",
    adp_seasons=(2023, 2024),  # section 6's preconditions
    # Section 5, "Gates": G1 +0.04, G2 +0.02, each position -0.02, G3 0.25, G4 [0.05, 0.15] with
    # n >= 100, chance bins of 200 pairs within +-0.05 and at least three gated.
    adp_margin=0.04,
    form_margin=0.02,
    position_floor=-0.02,
    places_margin=0.25,
    calibration_low=0.05,
    calibration_high=0.15,
    calibration_min_size=100,
    chance_bins=((0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0)),
    chance_min_pairs=200,
    chance_tolerance=0.05,
    chance_min_bins=3,
    # Section 5, uncertainty and multiple comparisons: 10,000 week-block resamples,
    # `default_rng(42)`, the 2.5th percentile (one-sided 0.05 / 2).
    resamples=10_000,
    seed=42,
    lower_percentile=2.5,
)

# Section 4, "Development check": 2023 weeks 6 to 17, fit on 2021 and 2022, the rate from the round
# 3 development priors, against 2023 ADP and form, the identical code.
DEVELOPMENT_CHECK: Final = replace(
    ROUND_THREE,
    fit_seasons=(2021, 2022),
    judgment_season=2023,
    adp_seasons=(2023,),
    rate_round=ros_gates.ROUND_THREE_CHECK,
    rate_record="2026-10-14-rest-of-season-round3-dev-check.json",
)


def isolation_line(  # noqa: PLR0913, PLR0917 - every clause of G5, named
    fit_served: Sequence[int],
    judged_served: Sequence[int],
    before: Mapping[str, str],
    after: Mapping[str, str],
    per_game: tuple[bool, str],
    t: Thresholds,
) -> GateLine:
    """G5: round 2's clauses (the readers on their seasons, the five tables as they were) and the
    per-game clause (`ledger.per_game_clause`)."""
    readers = round_two.isolation_line(fit_served, judged_served, before, after, t)
    held, detail = per_game
    return GateLine("G5", "isolation", readers.passed and held, f"{readers.detail}; per-game clause: {detail}")


verdict = round_two.verdict
