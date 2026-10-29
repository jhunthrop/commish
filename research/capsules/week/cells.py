"""THE PAGE'S CELLS, the only figures a week read may quote (Lane 100, B17).

The read sits under his player card, whose cells already print his numbers: the week's published
projection (the week tile) and its change (Δ Proj), the opponent's rank against his position (Opp rank), his
points a game and the games behind it (Avg), each game's points (the game log), his rest-of-season points
(Rest of season), and the game's expected score and kickoff weather under his name. A figure the read
states is one of those, as the cell prints it (`page_figures`: the tenth; the weather rounded to a whole
degree and mph, the chance of rain or snow only from the share the cell names it at). A figure the page
draws in no cell (a full-season preseason figure, a range, his touchdowns, points allowed a game) refuses
the read, so a reader never meets a number he cannot find on the page. The published projection and its
change are cells the read never quotes (Lane 275, `quotable_figures`): the Wk cell carries them, and the read
stands when they move.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

from research.capsules.page_figures import page_tenth
from research.capsules.week.sheet import Weather, WeekSheet
from research.model.jsmath import js_round

# The chance of rain or snow the weather cell names (`PRECIPITATION_NAMED_FROM`, web/src/lib/format/
# game-facts.ts): a lower one is not on the page.
PRECIPITATION_NAMED_FROM: Final = 20
# The weather cell prints no figure for a roof (indoors, a retractable roof).
ROOFED: Final = frozenset({"dome", "retractable"})


def named_chance(w: Weather) -> float | None:
    """The chance of rain or snow as the weather cell names it (`Math.round`), None below the share it
    names one at or with none forecast: the sheet prints no other (Lane 100 review M2)."""
    chance = w.precipitation_chance
    if chance is None or w.precipitation_kind in (None, "none") or chance < PRECIPITATION_NAMED_FROM:
        return None
    return js_round(chance)


# The smallest change the Proj change tile prints (Lane 139, C21, the web's `SHOWN_CHANGE_FROM`): a move under
# it is noise beside a whole tile, so the tile shows none and a read may not quote one.
SHOWN_CHANGE_FROM: Final = 0.5


def shown_change(change: float | None) -> float | None:
    """The change as the tile prints it, None for none or a move under `SHOWN_CHANGE_FROM`."""
    return None if change is None or abs(change) < SHOWN_CHANGE_FROM else change


def _projection_cells(sheet: WeekSheet) -> set[float]:
    p = sheet.projection
    if p is None or sheet.bye:
        return set()
    change = shown_change(sheet.projection_change)
    return {page_tenth(p.points), *(() if change is None else (page_tenth(abs(change)),))}


def _game_cells(sheet: WeekSheet) -> set[float]:
    """The expected score and the weather under his name, while he has a game this week."""
    if sheet.game is None or sheet.bye:
        return set()
    out: set[float] = set()
    if sheet.expected is not None:
        out |= {page_tenth(sheet.expected.club_points), page_tenth(sheet.expected.opponent_points)}
    w = sheet.weather
    if w is not None and w.roof not in ROOFED:
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
    return frozenset(_projection_cells(sheet) | quotable_figures(sheet))


def quotable_figures(sheet: WeekSheet) -> frozenset[float]:
    """The cells' figures a read may quote: every cell but the published projection and its change, which the
    card's Wk cell carries alone (Lane 275)."""
    return frozenset(_game_cells(sheet) | _season_cells(sheet))


# A figure's name, right after it or right before it (Lane 100 review M1, Lane 117 B80): every cell the card
# draws by a name a read may give one of its figures. A figure named as a cell is that cell's figure, or the
# read is refused: his Avg's points a game, the Rest of season tile's points, his Last game's points, this
# week's points (none on a bye), his next game's points (on a bye the week after's Proj, which the sheet
# does not carry; else the week's published projection or its expected score).
_POINTS: Final = r"(?:(?:half-)?ppr\s+)?(?:fantasy\s+)?points?"
_A_GAME: Final = re.compile(r"^\s*(?:(?:half-)?ppr\s+)?(?:fantasy\s+)?(?:points?\s+)?(?:a|per)\s+game\b", re.IGNORECASE)
_AVG_BEFORE: Final = re.compile(r"\b(?:averag(?:e|es|ed|ing)|avg)(?:\s+(?:of|is|was))?\s*$", re.IGNORECASE)
_REST: Final = re.compile(
    rf"^\s*{_POINTS}\s+(?:for\s+|over\s+)?(?:the\s+)?rest\b|^\s*(?:ppr\s+)?rest-of-season\b",
    re.IGNORECASE,
)
_REST_BEFORE: Final = re.compile(
    r"\brest[- ]of[- ]season(?:\s+(?:figure|points))?(?:\s+(?:of|is|at))?\s*$", re.IGNORECASE
)
_LAST_GAME: Final = r"(?:his\s+)?(?:last|latest|most\s+recent)\s+(?:game|week|outing|time\s+out)"
_LAST: Final = re.compile(
    rf"^\s*{_POINTS}\s+(?:(?:in|from|during)\s+{_LAST_GAME}|last\s+(?:week|game|time))\b", re.IGNORECASE
)
_LAST_BEFORE: Final = re.compile(
    rf"\b{_LAST_GAME}(?:'s)?(?:\s*,)?(?:\s+(?:he|was|of|brought))?(?:\s+(?:scored|posted|put\s+up|had))?\s*$",
    re.IGNORECASE,
)
_THIS_WEEK: Final = re.compile(rf"^\s*{_POINTS}\s+this\s+week\b", re.IGNORECASE)
# His next game is this week's for a player who plays (review M3); next week, or the week after a bye, is a
# week the sheet carries no figure for.
_NEXT_GAME: Final = re.compile(rf"^\s*{_POINTS}\s+(?:in|for|from)\s+(?:his|the)\s+next\s+game\b", re.IGNORECASE)
_NEXT_BEFORE: Final = re.compile(r"\bnext\s+game(?:'s)?(?:\s+(?:of|is|at))?\s*$", re.IGNORECASE)
_NEXT_WEEK: Final = re.compile(
    rf"^\s*{_POINTS}\s+(?:(?:in|for|from)\s+(?:his|the)\s+next\s+week|next\s+week|after\s+the\s+bye)\b",
    re.IGNORECASE,
)
_NEXT_WEEK_BEFORE: Final = re.compile(r"\bnext\s+week(?:'s)?(?:\s+(?:of|is|at))?\s*$", re.IGNORECASE)
# A rank against his position (the Opp rank cell): "26th of 32", "9th against running backs".
_RANK: Final = re.compile(
    r"\b(\d+)(?:st|nd|rd|th)\b(?=\s+(?:of\s+(\d+)|against\b|in\s+(?:ppr\s+)?points\s+allowed\b))(?!\s+in\s+our\b)",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class NamedCell:
    """A cell by the names a read gives its figure, and the figures it prints for a sheet."""

    name: str
    after: re.Pattern[str]
    before: re.Pattern[str] | None
    figures: Callable[[WeekSheet], frozenset[float]]


def _avg(sheet: WeekSheet) -> frozenset[float]:
    return frozenset(() if sheet.points_per_game is None else (page_tenth(sheet.points_per_game),))


def _rest(sheet: WeekSheet) -> frozenset[float]:
    b = sheet.board
    return frozenset(() if b is None or not b.rest_of_season or b.points is None else (page_tenth(b.points),))


def _last(sheet: WeekSheet) -> frozenset[float]:
    # last_games is newest first (`collect.last_games`): the Last tile is the newest.
    return frozenset(() if not sheet.last_games else (page_tenth(sheet.last_games[0].points),))


def _none(sheet: WeekSheet) -> frozenset[float]:
    del sheet
    return frozenset()


def _this_week(sheet: WeekSheet) -> frozenset[float]:
    """The week tile: no figure on a bye, else the published projection and the game's expected score."""
    return frozenset() if sheet.bye else frozenset(_projection_cells(sheet) | _game_cells(sheet))


NAMED_CELLS: Final = (
    NamedCell("his points a game (Avg)", _A_GAME, _AVG_BEFORE, _avg),
    NamedCell("his rest-of-season points", _REST, _REST_BEFORE, _rest),
    NamedCell("his last game's points (Last)", _LAST, _LAST_BEFORE, _last),
    NamedCell("this week's points, on a week the card shows his bye", _THIS_WEEK, None, _this_week),
    NamedCell("his next game's points", _NEXT_GAME, _NEXT_BEFORE, _this_week),
    NamedCell("next week's points, a week the sheet carries no figure for", _NEXT_WEEK, _NEXT_WEEK_BEFORE, _none),
)


def misnamed(before: str, after: str, value: float, sheet: WeekSheet) -> str | None:
    """The cell a figure is named as, when that cell prints another figure (`before` and `after` are the text
    either side of the figure); None when its name and its cell agree or it names none of them."""
    for cell in NAMED_CELLS:
        named = cell.after.match(after) or (cell.before is not None and cell.before.search(before))
        if named and value not in cell.figures(sheet):
            return cell.name
    return None


def misranked(sentence: str, sheet: WeekSheet) -> list[str]:
    """Each rank against his position the sentence states that is not the Opp rank cell's, as written: on a
    bye the sheet carries no opponent's rank, so any one is refused."""
    a = sheet.allowed
    shown = None if a is None or sheet.bye else (a.rank, a.of)
    out = []
    for match in _RANK.finditer(sentence):
        rank, of = int(match.group(1)), match.group(2)
        if shown is None or rank != shown[0] or (of is not None and int(of) != shown[1]):
            out.append(match.group(0))
    return out
