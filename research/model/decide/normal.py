"""THE NORMAL ARITHMETIC THE DECISION LAYER NEEDS, in one place.

Ported from `research-ts/src/projections/decide/normal.ts`. `normal_cdf` is Abramowitz and Stegun
26.2.17 with the published coefficients, in the oracle's order of operations; its one
transcendental is V8's `Math.exp` (`fdlibm.exp`), computed in the arithmetic the caller names
(`research.model.arithmetic`), so the closed form reproduces the oracle bit for bit.
"""

import math
from typing import Final

from research.model.arithmetic import Arithmetic
from research.model.fdlibm import exp

# The z-score of the 90th percentile: the quantile a projection distribution states as its ceiling.
Z_NINETIETH: Final = 1.2815515655446004
# `Math.SQRT2`.
SQRT2: Final = 1.4142135623730951

_P: Final = 0.3275911
_A1: Final = 0.254829592
_A2: Final = -0.284496736
_A3: Final = 1.421413741
_A4: Final = -1.453152027
_A5: Final = 1.061405429


def normal_cdf(z: float, arithmetic: Arithmetic) -> float:
    """`normalCdf`: accurate to about 7.5e-8 across the whole line."""
    if not math.isfinite(z):
        raise ValueError(f"normalCdf needs a finite z-score; got {z}.")
    sign = -1.0 if z < 0 else 1.0
    x = abs(z) / SQRT2
    t = 1 / (1 + _P * x)
    poly = t * (_A1 + t * (_A2 + t * (_A3 + t * (_A4 + t * _A5))))
    erf = 1 - poly * exp(-x * x, fused=arithmetic.fused_multiply_add)
    return 0.5 * (1 + sign * erf)


def chance_of_clearing(mean: float, standard_deviation: float, target: float, arithmetic: Arithmetic) -> float:
    """`chanceOfClearing`: the chance a total drawn as mean +/- spread clears `target`."""
    if standard_deviation <= 0:
        raise ValueError(f"A chance of clearing needs a positive spread; got {standard_deviation}.")
    return normal_cdf((mean - target) / standard_deviation, arithmetic)
