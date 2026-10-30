"""WHEN A GENERIC FACT BITES (Lane 300): the lines past which the weather, the depth chart, the opponent's rank and
the expected score decide a week. Since fix round 2 (the founder: "dump in all of the information we have") every
one reaches the writer, and these lines are the words that say whether it bites ("wind of 15 mph or more, it
bites"; "ordinary football weather, it does not bite"), so the writer leaves the ordinary out.
"""

from datetime import timedelta
from typing import Final

from research.capsules.week.cells import named_chance
from research.capsules.week.sheet import Allowed, WeekSheet

# Wind from 15 mph moves the passing and kicking game (the brief's own line); under it the forecast is noise.
WIND_BITES_MPH: Final = 15.0
# Rain or thunderstorms bite when likely: the forecast service's "likely" starts at a 60% chance. The brief asks
# for heavy rain likely; the forecast carries no intensity, so a likely chance of rain or storms stands in (review L4).
RAIN_BITES_CHANCE: Final = 60.0
# Snow or ice bites at a lower chance: any real chance of either changes footing and the ball.
SNOW_BITES_CHANCE: Final = 30.0
_RAIN: Final = frozenset({"rain", "thunderstorms"})
_SNOW: Final = frozenset({"snow", "ice"})
_ROOFED: Final = frozenset({"dome", "retractable"})
# The opponent's rank bites at the four clubs either end (the coordinator's fix round 1, from six): at six it
# bit on about a third of sheets and the writer used it nearly every time, over the quarter the founder's ask sets.
RANK_EDGE: Final = 4
# A depth-chart move is this week's news only when its release came out within the week before the write.
DEPTH_MOVE_WINDOW: Final = timedelta(days=8)


def weather_bites(sheet: WeekSheet) -> bool:
    """Wind of `WIND_BITES_MPH` or more, rain likely, or a chance of snow; never under a roof."""
    w = sheet.weather
    if w is None or sheet.bye or w.roof in _ROOFED:
        return False
    if w.wind_mph is not None and w.wind_mph >= WIND_BITES_MPH:
        return True
    chance = named_chance(w)
    if chance is None:
        return False
    return (w.precipitation_kind in _RAIN and chance >= RAIN_BITES_CHANCE) or (
        w.precipitation_kind in _SNOW and chance >= SNOW_BITES_CHANCE
    )


def rank_bites(allowed: Allowed | None) -> bool:
    """The opponent's rank against his position in the top or bottom `RANK_EDGE`."""
    return allowed is not None and (allowed.rank <= RANK_EDGE or allowed.rank > allowed.of - RANK_EDGE)


def weather_words(sheet: WeekSheet) -> str:
    """Whether the forecast bites, in words for the sheet."""
    w = sheet.weather
    if w is not None and w.roof in _ROOFED:
        return "Under a roof, the weather does not bite."
    if not weather_bites(sheet):
        return "Ordinary football weather: it does not bite."
    if w is not None and w.wind_mph is not None and w.wind_mph >= WIND_BITES_MPH:
        return f"Wind of {WIND_BITES_MPH:g} mph or more: it bites."
    return "Rain or snow likely: it bites."


def rank_bite_words(allowed: Allowed | None) -> str:
    """Whether the opponent's rank bites, in words for the sheet."""
    if rank_bites(allowed):
        return f"Within {RANK_EDGE} of either end of the league: it bites."
    return "In the middle of the league: an ordinary matchup, it does not bite. Never state this rank in the read."


def depth_words(sheet: WeekSheet) -> str:
    """Whether his place on the chart bites, in words for the sheet."""
    d = sheet.depth
    if d is not None and any(slot == d.slot for _, slot in d.around):
        return "He shares his spot: it bites."
    if depth_bites(sheet):
        return "His place moved: it bites."
    return "Unchanged: ordinary, it does not bite."


def expected_words(sheet: WeekSheet) -> str:
    """Whether the club's expected score bites: its place when it is among the week's three highest or lowest (the
    expected-score fact on his sheet), else ordinary."""
    place = next((f"{w} {g}" for a in sheet.angles if a.key == "expected" for w, g in a.places), None)
    if place is not None:
        return f"It is {place}: it bites."
    return "Neither among the week's highest nor its lowest: ordinary, it does not bite."


def depth_bites(sheet: WeekSheet) -> bool:
    """His slot moved on a release of the past week, or another player at his position shares it."""
    d = sheet.depth
    if d is None:
        return False
    if any(slot == d.slot for _, slot in d.around):
        return True
    moved = sheet.depth_moved_from is not None and sheet.depth_moved_from != d.slot
    return moved and d.released_at is not None and sheet.written_at - d.released_at <= DEPTH_MOVE_WINDOW
