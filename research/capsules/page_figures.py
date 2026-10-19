"""THE PAGE'S FIGURES AS THE PAGE PRINTS THEM (Lane 66v): the writers' sheets, and the guard on their prose.

Every figure a screen shows is rounded once, by the site's tenth rule (`nightly.build.tenth`, the API's
`tenth.Round`), and the web prints it as given. The writers' sheets print the same figures the same way,
so a read quotes the page's own: a week's points, his points a game, an allowance and a board's points to
the tenth (`page_tenth`); the week's published projection as the API's player week serves it, the cents
then the tenth (`projection_tenth`, `api/internal/inseason/player.go`); the game's expected score in half
points, the opponent's the half-point total less the club's (`expected_score`,
`api/internal/inseason/gamefacts.go` and the web's `expectedWords`).

THE GUARD (`figure_violations`). The page never prints a figure to two decimals unless the sheet does (a
time to throw), so a figure the prose carries to two or more decimals that the sheet does not print is
refused for every read. A week read's sheet is the card's figures alone, so it is held to every decimal
figure (`exact`): each must be one the sheet prints, its sign aside. A whole number is left to the
grounding rule (`capsules.grounding`). Each refusal names the figure and the sheet's nearest, so the
correction and the nightly's fallback line say what the page prints.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.grounding import extract_numbers, prompt_numbers
from research.model.jsmath import js_round
from research.nightly.build.tenth import tenth
from research.pipeline.jscompat import js_string

FIGURE_OFF_PAGE: Final = "The text quotes a figure the page does not print"
_CENTS: Final = 100
_DECIMALS: Final = re.compile(r"\.(\d+)")


def page_tenth(points: float) -> float:
    """A figure as the page prints it: the site's one rule, to the tenth."""
    return tenth(points)


def page_tenth_text(points: float) -> str:
    """A figure as the sheet prints it: the page's tenth, written as JavaScript's `String` writes it."""
    return js_string(page_tenth(points))


def projection_tenth(points: float) -> float:
    """The week's published projection as the API serves the card: the cents, then the tenth."""
    return page_tenth(js_round(points * _CENTS) / _CENTS)


def half_points(points: float) -> float:
    """A game figure as the card says it: to the nearest half point (the API's `halfPoints`)."""
    return js_round(points * 2) / 2


def expected_score(club_points: float, game_total: float) -> tuple[float, float]:
    """The club's and the opponent's expected points as the card prints them ("29.5 to 24")."""
    club = half_points(club_points)
    return club, half_points(game_total) - club


def _nearest(value: float, printed: Sequence[float]) -> str:
    if not printed:
        return "the sheet prints no figure"
    near = min(printed, key=lambda figure: (abs(figure - value), figure))
    return f"the sheet prints {js_string(near)}"


@dataclass(frozen=True, slots=True)
class FigureRefusal:
    """A figure the guard refused: as the prose wrote it, and the violation handed back to the writer."""

    raw: str
    message: str


def figure_violations(text: str, sheet: str, *, exact: bool) -> tuple[FigureRefusal, ...]:
    """Each figure in `text` the page does not print: one to two or more decimals the sheet does not
    print, and, `exact`, any decimal figure the sheet does not print."""
    printed = sorted({abs(value) for value in prompt_numbers(sheet)})
    held = set(printed)
    refused: list[FigureRefusal] = []
    for raw, value in extract_numbers(text):
        places = _DECIMALS.search(raw)
        if places is None or abs(value) in held:
            continue
        if exact:
            message = f'{FIGURE_OFF_PAGE}: "{raw}", where {_nearest(abs(value), printed)}.'
        elif len(places.group(1)) > 1:
            message = (
                f'{FIGURE_OFF_PAGE}: "{raw}" carries more decimals than the page prints, where '
                f"{_nearest(abs(value), printed)}."
            )
        else:
            continue
        refused.append(FigureRefusal(raw, f"{message} Quote each figure exactly as the sheet prints it."))
    return tuple(refused)


def fallback_violation(violations: Sequence[str]) -> str:
    """The violation a read that fell is said to have fallen for: the figure guard's whenever the last draft
    carried one (what the page would have misprinted), else its first (the band leads, Lane 52)."""
    if not violations:
        raise ValueError("a read that failed validation carries at least one violation")
    return next((v for v in violations if v.startswith(FIGURE_OFF_PAGE)), violations[0])
