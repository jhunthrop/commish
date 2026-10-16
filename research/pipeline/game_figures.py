"""THE GAME'S FIGURES, ONE DERIVATION: a club's implied points from the game's total and its spread.

The store's sign: a club's spread is positive when it is favoured (nflverse's `spread_line` for the
home club). The closing figure (`nflverse.schedule`), the live capture (`tank01.lines`) and the game
table's weekly read (`nflverse.games`) derive the club's implied points here, so none can disagree
on the arithmetic, and each writes the same three metrics from the club's side.
"""

from typing import Final


class FigureMetric:
    POINT_SPREAD: Final = "point_spread"
    GAME_TOTAL: Final = "game_total"
    IMPLIED_TEAM_TOTAL: Final = "implied_team_total"


def implied_points(total: float, spread: float) -> float:
    """The club's share of the expected total: half the total plus half its own spread."""
    return total / 2 + spread / 2


def club_figures(total: float, spread: float) -> tuple[tuple[str, float], ...]:
    """A club's three figure metrics, its own spread (positive when favoured) and the game's total."""
    return (
        (FigureMetric.POINT_SPREAD, spread),
        (FigureMetric.GAME_TOTAL, total),
        (FigureMetric.IMPLIED_TEAM_TOTAL, implied_points(total, spread)),
    )
