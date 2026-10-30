"""THE WEEK READ'S CALL, DECIDED IN CODE (Lane 302, B304): start, sit or hold from his status and his place in our
order, before the writer is asked. The writer argues the call and never picks it.

Lane 300 found the call was the writer's own one word: between two runs of the same writer on the same sheets it
moved for 26 to 27% of players. The coordinator's ruling (2026-10-30): the call is decided before the writer.

- He may not be started at all (his bye, Out, on injured reserve, suspended, on the PUP or NFI list): sit.
- Questionable (a player designated to return this week is Questionable too, `model.designations`): hold. His game
  is not settled until the inactives, so the read waits on it with him.
- Doubtful before the week's game status report: hold. On or after that report: sit, as Doubtful is never "start"
  (`sheet.NO_START`) and the report is the club's word that he is not likely to play.
- Otherwise his place at his position in the one order of ours the sheet carries (`sheet.BoardPlace`): the published
  rest-of-season order from the board week (its basis `rest_of_season`), or before one is published the preseason
  order. Never ADP, and never the published projection, which is not ours (`sheet.PROJECTION_BASIS`). Inside his
  position's starter line (`STARTER_LINE`): start; past it: sit.
- No place in our order, or a position with no line: none, no lineup call (the API's fourth value).

The call's inputs are his status, the report's issue for a Doubtful player, and his position rank against the
line, so two passes on the same sheet give the same call (`cadence.CALL_CHANGED` rewrites a read when it moves).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, cast

from research.capsules.render_words import POSITION_PLURAL
from research.capsules.week.report_day import status_report_issued
from research.capsules.week.sheet import CANNOT_PLAY, STATUS_WORDS, WeekSheet
from research.model.domain import Position

START: Final = "start"
SIT: Final = "sit"
HOLD: Final = "hold"
NONE: Final = "none"
QUESTIONABLE: Final = "questionable"
DOUBTFUL: Final = "doubtful"

# THE STARTER LINE: the last place at his position a 12-team, one-quarterback league with one flex starts, so a
# player at or inside it is a start and one past it a sit.
TEAMS: Final = 12
# The flex's twelve slots by position: a PPR flex goes to a receiver about half the time, a running back most of the
# rest, a tight end rarely (one in twelve).
FLEX_SHARE: Final[Mapping[str, int]] = MappingProxyType({"RB": 5, "WR": 6, "TE": 1})
# Each position's own starting slots a team: one quarterback (no superflex), two running backs, two receivers,
# one tight end, one kicker, one defense.
SLOTS: Final[Mapping[str, int]] = MappingProxyType({"QB": 1, "RB": 2, "WR": 2, "TE": 1, "K": 1, "DEF": 1})
# QB 12, RB 29, WR 30, TE 13, K 12, DEF 12.
STARTER_LINE: Final[Mapping[str, int]] = MappingProxyType(
    {position: TEAMS * slots + FLEX_SHARE.get(position, 0) for position, slots in SLOTS.items()}
)


@dataclass(frozen=True, slots=True)
class WeekCall:
    """The decided call and the one sentence the writer is given for it (`words`)."""

    call: str
    words: str


def _status_words(status: str) -> str:
    said = STATUS_WORDS.get(status, status)
    return said if said.startswith("on ") or said == "suspended" else f"listed {said}"


def _after_report(sheet: WeekSheet) -> bool:
    """Whether his status was seen on or after his game's status report (False with no game or no read of it)."""
    seen = sheet.status.seen_at(sheet.written_at)
    return sheet.game is not None and seen is not None and seen >= status_report_issued(sheet.game.kickoff)


def _status_call(sheet: WeekSheet) -> WeekCall | None:
    """The call his bye or his status decides, or None when it leaves the call to his place in our order."""
    week = f"week {sheet.week}"
    if sheet.bye:
        return WeekCall(SIT, f"The call is sit: his club is on its bye in {week}, so he does not play.")
    status = sheet.status.status
    if status in CANNOT_PLAY:
        return WeekCall(SIT, f"The call is sit: he is {_status_words(status)}, so he does not play in {week}.")
    if status == QUESTIONABLE:
        return WeekCall(
            HOLD, f"The call is hold: he is Questionable, so his {week} game is not settled before kickoff."
        )
    if status == DOUBTFUL and _after_report(sheet):
        return WeekCall(SIT, f"The call is sit: he is Doubtful on {week}'s game status report.")
    if status == DOUBTFUL:
        return WeekCall(HOLD, f"The call is hold: he is Doubtful, and {week}'s game status report is still to come.")
    return None


def _order_call(sheet: WeekSheet) -> WeekCall:
    """The call his place at his position in our order decides against the position's starter line."""
    board, line = sheet.board, STARTER_LINE.get(sheet.position)
    if board is None or line is None:
        return WeekCall(NONE, "There is no lineup call: he has no place in our order at his position.")
    place = f"{sheet.position}{board.position_rank} in {board.order_words}"
    plural = POSITION_PLURAL.get(cast("Position", sheet.position), sheet.position)
    if board.position_rank <= line:
        return WeekCall(START, f"The call is start: he is {place}, among the {plural} a lineup starts.")
    return WeekCall(SIT, f"The call is sit: he is {place}, past the {plural} a lineup starts.")


def week_call(sheet: WeekSheet) -> WeekCall:
    """`sheet`'s call: his bye or status first, then his place in our order against his position's starter line."""
    return _status_call(sheet) or _order_call(sheet)
