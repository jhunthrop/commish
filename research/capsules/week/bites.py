"""WHEN A GENERIC FACT BITES (Lane 300, ruling 2): the weather, the depth chart and the opponent's rank reach the
writer only past these lines, so the read cannot tour them. His status always reaches it (it can decide the
call). The card's cells still print every one of them; only the sheet the writer reads leaves them off.
"""

from datetime import timedelta
from typing import Final

from research.capsules.week.cells import named_chance
from research.capsules.week.sheet import Allowed, WeekSheet

# Wind from 15 mph moves the passing and kicking game (the brief's own line); under it the forecast is noise.
WIND_BITES_MPH: Final = 15.0
# Rain or thunderstorms bite when likely: the forecast service's "likely" starts at a 60% chance.
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


def depth_bites(sheet: WeekSheet) -> bool:
    """His slot moved on a release of the past week, or another player at his position shares it."""
    d = sheet.depth
    if d is None:
        return False
    if any(slot == d.slot for _, slot in d.around):
        return True
    moved = sheet.depth_moved_from is not None and sheet.depth_moved_from != d.slot
    return moved and d.released_at is not None and sheet.written_at - d.released_at <= DEPTH_MOVE_WINDOW
