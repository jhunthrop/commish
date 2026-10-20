"""THE PAGE'S CELLS, the only figures a week read may quote (Lane 100, B17).

The read sits under his player card, whose cells already print his numbers: the week's published
projection (the week tile) and its change (Δ Proj), the opponent's rank against his position (Opp rank), his
points a game and the games behind it (Avg), each game's points (the game log), his rest-of-season points
(Rest of season), and the game's expected score and kickoff weather under his name. A figure the read
states is one of those, as the cell prints it (`page_figures`: the tenth; the weather rounded to a whole
degree and mph, the chance of rain or snow only from the share the cell names it at). A figure the page
draws in no cell (a full-season preseason figure, a range, his touchdowns, points allowed a game) refuses
the read, so a reader never meets a number he cannot find on the page.
"""

import re
from typing import Final

from research.capsules.page_figures import page_tenth
from research.capsules.week.sheet import Weather, WeekSheet
from research.model.jsmath import js_round

# The chance of rain or snow the weather cell names (`PRECIPITATION_NAMED_FROM`, web/src/lib/format/
# game-facts.ts): a lower one is not on the page.
PRECIPITATION_NAMED_FROM: Final = 20
# The weather cell prints no figure for a roof (indoors, a retractable roof).
_ROOFED: Final = frozenset({"dome", "retractable"})


def named_chance(w: Weather) -> float | None:
    """The chance of rain or snow as the weather cell names it (`Math.round`), None below the share it
    names one at or with none forecast: the sheet prints no other (Lane 100 review M2)."""
    chance = w.precipitation_chance
    if chance is None or w.precipitation_kind in (None, "none") or chance < PRECIPITATION_NAMED_FROM:
        return None
    return js_round(chance)


def _projection_cells(sheet: WeekSheet) -> set[float]:
    p = sheet.projection
    if p is None or sheet.bye:
        return set()
    change = sheet.projection_change
    return {page_tenth(p.points), *(() if change is None else (page_tenth(abs(change)),))}


def _game_cells(sheet: WeekSheet) -> set[float]:
    """The expected score and the weather under his name, while he has a game this week."""
    if sheet.game is None or sheet.bye:
        return set()
    out: set[float] = set()
    if sheet.expected is not None:
        out |= {page_tenth(sheet.expected.club_points), page_tenth(sheet.expected.opponent_points)}
    w = sheet.weather
    if w is not None and w.roof not in _ROOFED:
        out |= {js_round(v) for v in (w.temperature_f, w.wind_mph) if v is not None}
        chance = named_chance(w)
        if chance is not None:
            out.add(chance)
    return out


def _season_cells(sheet: WeekSheet) -> set[float]:
    """His games' points, his points a game and how many games it is over, his rest-of-season points."""
    out = {page_tenth(g.points) for g in sheet.last_games}
    if sheet.points_per_game is not None:
        out |= {page_tenth(sheet.points_per_game), float(sheet.games_played)}
    b = sheet.board
    if b is not None and b.rest_of_season and b.points is not None:
        out.add(page_tenth(b.points))
    return out


def cell_figures(sheet: WeekSheet) -> frozenset[float]:
    """Every figure the page draws as a cell for `sheet`'s player and week, as the cell prints it."""
    return frozenset(_projection_cells(sheet) | _game_cells(sheet) | _season_cells(sheet))


# A figure's name right after it (Lane 100 review M1): a rate a game is his Avg's, a figure for the rest of
# the season is the Rest of season tile's. The published projection's naming is the projection rule's.
_A_GAME: Final = re.compile(r"^\s*(?:(?:half-)?ppr\s+)?(?:fantasy\s+)?(?:points?\s+)?(?:a|per)\s+game\b", re.IGNORECASE)
_REST: Final = re.compile(
    r"^\s*(?:(?:half-)?ppr\s+)?(?:fantasy\s+)?points?\s+(?:for\s+|over\s+)?(?:the\s+)?rest\b|^\s*(?:ppr\s+)?"
    r"rest-of-season\b",
    re.IGNORECASE,
)


def misnamed(after: str, value: float, sheet: WeekSheet) -> str | None:
    """The cell a figure is named as, when that cell prints another figure (`after` is the text right after
    the figure); None when its name and its cell agree or it names none of them."""
    if _A_GAME.match(after) and (sheet.points_per_game is None or page_tenth(sheet.points_per_game) != value):
        return "his points a game (Avg)"
    b = sheet.board
    rest = None if b is None or not b.rest_of_season or b.points is None else page_tenth(b.points)
    if _REST.match(after) and rest != value:
        return "his rest-of-season points"
    return None
