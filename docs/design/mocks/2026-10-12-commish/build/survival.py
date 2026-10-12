"""Survival odds: the product's own model, src/projections/decide/survival.ts with normal.ts,
ported line for line by the Broadcast build (broadcast-build/common.py) and reused here unchanged.

A player's place in the queue of upcoming picks is a bell curve centred on where he sits in ADP
order among the players still undrafted, conditioned on his not having gone yet. Closed form,
monotone, the same answer twice. No room tendency is applied: a mock against bots has no history.
"""
import math

# The same two constants as survival.ts. Honest guesses there, so honest guesses here.
DRAFT_NOISE_FLOOR_PICKS = 1
DRAFT_NOISE_SLOPE = 0.25


def normal_cdf(z):
    """Abramowitz and Stegun 26.2.17, as in normal.ts."""
    sign = -1 if z < 0 else 1
    x = abs(z) / math.sqrt(2)
    t = 1 / (1 + 0.3275911 * x)
    poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
    erf = 1 - poly * math.exp(-x * x)
    return 0.5 * (1 + sign * erf)


def _survival_of(queue_place, intervening):
    if intervening <= 0:
        return 1.0
    spread = DRAFT_NOISE_FLOOR_PICKS + DRAFT_NOISE_SLOPE * queue_place
    already_here = normal_cdf(queue_place / spread)
    still_here = 1 - normal_cdf((intervening - queue_place) / spread)
    return still_here / already_here


def survival_probabilities(pool, from_pick, to_pick, adp_of):
    """Every undrafted player's chance of lasting from from_pick (the pick on the clock) to to_pick.
    adp_of(player) returns the ADP the queue is ordered by. Returns player id -> probability."""
    if not isinstance(from_pick, int) or from_pick < 1:
        raise ValueError(f"A survival question starts at a whole pick number; got {from_pick}.")
    if not isinstance(to_pick, int) or to_pick <= from_pick:
        raise ValueError(f"Your next turn must come after pick {from_pick}; got {to_pick}.")
    intervening = to_pick - from_pick - 1
    order = sorted(pool, key=lambda p: (max(0.5, adp_of(p)), p["id"]))
    return {p["id"]: _survival_of(i + 1, intervening) for i, p in enumerate(order)}
