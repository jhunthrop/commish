"""THIS WEEK'S OPPONENT: c_W = bounded(D_pass ^ e_pass,p x D_rush ^ e_rush,p), and its fit.

Preregistration section 2, item 2 and "Fitted in this round". D_pass and D_rush are the opponent's
ratings as stored on his club's week-W row (`commish_opponent_adjustment`); a missing rating takes 1.
The cap is round 1's `bounded`, [0.8, 1.25]. The two elasticities per position are found by grid
search over {0, 0.1, ..., 1.0} squared (121 cells), minimising the sum of (actual PPR points minus
m_ppr x c_W) squared over the fit population, ties to the smaller e_pass then e_rush (the grid's
earlier cell), and used in all three formats.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.model.weekly.scheme import bounded


@dataclass(frozen=True, slots=True)
class Elasticity:
    passing: float
    rushing: float


def opponent_factor(d_pass: float | None, d_rush: float | None, elasticity: Elasticity) -> float:
    """The capped opponent multiplier; a missing rating takes 1."""
    pass_rating = 1.0 if d_pass is None else d_pass
    rush_rating = 1.0 if d_rush is None else d_rush
    return bounded(pass_rating**elasticity.passing * rush_rating**elasticity.rushing)


@dataclass(frozen=True, slots=True)
class FactorRow:
    """One fit-population player-week: his position, PPR rate, PPR outcome and the two ratings."""

    position: str
    rate: float
    actual: float
    d_pass: float | None
    d_rush: float | None


def _loss(rows: Sequence[FactorRow], elasticity: Elasticity) -> float:
    return sum((row.actual - row.rate * opponent_factor(row.d_pass, row.d_rush, elasticity)) ** 2 for row in rows)


def fit_elasticities(rows: Sequence[FactorRow], grid: Sequence[float]) -> Mapping[str, Elasticity]:
    """Each position's (e_pass, e_rush) by grid search; a strictly smaller loss replaces the best, so
    a tie keeps the earlier cell (smaller e_pass, then smaller e_rush)."""
    found: dict[str, Elasticity] = {}
    cells = [Elasticity(e_pass, e_rush) for e_pass in grid for e_rush in grid]
    for position in SKILL_POSITIONS:
        kept = [row for row in rows if row.position == position]
        if not kept:
            raise ValueError(f"no fit-population rows to fit the {position} elasticities on")
        best, best_loss = cells[0], _loss(kept, cells[0])
        for cell in cells[1:]:
            loss = _loss(kept, cell)
            if loss < best_loss:
                best, best_loss = cell, loss
        found[position] = best
    return MappingProxyType(found)
