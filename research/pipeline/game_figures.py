"""THE GAME'S FIGURES, ONE DERIVATION: a club's implied points from the game's total and its spread.

The store's sign: a club's spread is positive when it is favoured (nflverse's `spread_line` for the
home club). Both the closing figure (`nflverse.schedule`) and the live capture (`tank01.lines`)
derive the club's implied points here, so the two can never disagree on the arithmetic.
"""


def implied_points(total: float, spread: float) -> float:
    """The club's share of the expected total: half the total plus half its own spread."""
    return total / 2 + spread / 2
