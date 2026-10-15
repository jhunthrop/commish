"""THE WEEKLY NUMBER, STAMPED: x for a placed player in each format, or none.

Preregistration section 2 items 5 and 6 and the missing-input table. A player with no game this
week (a bye, or no club) has no number; one whose latest week-W filing at t_g lists him Out or
Doubtful has none (round 2's filter, `weekly2.designation`), Questionable keeps the number and the
flag; one with no game this season before W has x = m_f; every other player has
x = max(0, m_f + O_f(E_g) - O_f(E_n)). `model_version` and `implementation` are stamped on every row.
The reported ablations (round 3 without vacated volume, without the allowances) and the Thursday view
are the same function on changed inputs.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Final

from research.model.domain import Position
from research.model.register.freeze import IMPLEMENTATION
from research.model.ros.model import FORMATS, OpportunityLine, cell
from research.model.weekly2.designation import QUESTIONABLE, WITHHELD
from research.model.weekly3.features import Features
from research.model.weekly3.season import Placed, View
from research.model.weekly3.stage import RedZone, StageOne, game_number

Points = Mapping[str, float]
Variant = Callable[[Features], Features]
FROZEN: Final = MappingProxyType


def _same(features: Features) -> Features:
    return features


@dataclass(frozen=True, slots=True)
class Fitted:
    """Every fitted number x reads: stage 1's lines, the red-zone slopes and the rate's opportunity
    lines (unchanged), keyed `position|format`."""

    stage: StageOne
    red_zone: Mapping[str, RedZone]
    opportunity: Mapping[str, OpportunityLine]


def view_number(placed: Placed, view: View, fitted: Fitted, variant: Variant = _same) -> Points | None:
    """x in each format for the view, or None (no game this week, or withheld)."""
    if placed.moment is None or view.status == WITHHELD:
        return None
    rate = placed.player.rate
    if view.features is None:
        return FROZEN(dict(rate))
    features = variant(view.features)
    position = placed.player.position
    return FROZEN(
        {
            name: game_number(
                rate[name],
                features,
                position,
                fitted.stage,
                fitted.opportunity[cell(position, name)],
                fitted.red_zone[cell(position, name)],
            )
            for name in FORMATS
        }
    )


@dataclass(frozen=True, slots=True)
class WeekNumber:
    """A player's weekly number, stamped as the register stamps its rows."""

    season: int
    week: int
    player_id: str
    position: Position
    club: str | None
    moment: datetime | None
    rate: Points
    number: Points | None  # None: withheld, or no game this week
    questionable: bool
    model_name: str
    model_version: str
    implementation: str = IMPLEMENTATION


def week_number(  # noqa: PLR0913, PLR0917 - the number's every stamp, named
    season: int, week: int, placed: Placed, fitted: Fitted, model_name: str, model_version: str
) -> WeekNumber:
    player = placed.player
    return WeekNumber(
        season,
        week,
        player.player_id,
        player.position,
        placed.club,
        placed.moment,
        player.rate,
        view_number(placed, placed.own, fitted),
        placed.moment is not None and placed.own.status == QUESTIONABLE,
        model_name,
        model_version,
    )
