"""THE WEEK READ'S CALL, DECIDED IN CODE (Lane 302, B304): start, sit or hold from his status and his place among
his position this week, before the writer is asked. The writer argues the call and never picks it.

Lane 300 found the call was the writer's own one word: between two runs of the same writer on the same sheets it
moved for 26 to 27% of players. The coordinator's ruling (2026-10-30): the call is decided before the writer.

HIS PLACE THIS WEEK (fix round 1, the coordinator's ruling). He is ranked among the board players at his position by
the week's published projection's points (`sheet.PublishedProjection`, the provider's weekly projection the card
prints, the newest snapshot at the read; `week_ranks`, read into `WeekSheet.week_rank` by `collect`), so this
week's matchup is in it. With no published projection for him this week, the call reads his place in our
rest-of-season order (`sheet.BoardPlace`, or before one is published the preseason order) and its sentence says
so. Never ADP. The read never names the projection or its figure (Lane 275): the writer is told only his place,
"he ranks 18th among running backs this week".

THE CALL. Against his position's starter line (`STARTER_LINE`):
- He may not be started at all (his bye, Out, on injured reserve, suspended, on the PUP or NFI list): sit.
- Past the line: sit, whatever his status.
- Inside the line, Questionable before his game's status report: hold (a player designated to return this week is
  Questionable too, `model.designations`). Inside the line and Questionable on or after the report: start.
- Inside the line and Doubtful: hold.
- Inside the line otherwise: start.
- No place at all (no projection and no order place, or a position with no line): hold for a Questionable or
  Doubtful player, else none, no lineup call (the API's fourth value).

The call's inputs are his status, the report's issue for a Questionable player, and his place against the line, so
two passes on the same sheet give the same call (`cadence.CALL_CHANGED` rewrites a read when it moves).
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, cast

from research.capsules.render_words import POSITION_PLURAL, ordinal
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


@dataclass(frozen=True, slots=True)
class _Place:
    """His place at his position against the line, and the words that say where it comes from."""

    inside: bool
    words: str


def week_ranks(points: Iterable[tuple[str, str, float]]) -> dict[str, int]:
    """Each player's place among his position by the week's points, 1 the most; equal points share a place.
    `points` is (player, position, points) for every board player with a published projection this week."""
    by_position: dict[str, list[float]] = {}
    rows = list(points)
    for _, position, value in rows:
        by_position.setdefault(position, []).append(value)
    return {player: 1 + sum(v > value for v in by_position[position]) for player, position, value in rows}


def _plural(sheet: WeekSheet) -> str:
    return POSITION_PLURAL.get(cast("Position", sheet.position), sheet.position)


def _place(sheet: WeekSheet) -> _Place | None:
    """His place this week, else his place in our order, against his position's line; None with neither."""
    line = STARTER_LINE.get(sheet.position)
    if line is None:
        return None
    plural = _plural(sheet)
    if sheet.week_rank is not None:
        return _Place(sheet.week_rank <= line, f"he ranks {ordinal(sheet.week_rank)} among {plural} this week")
    board = sheet.board
    if board is None:
        return None
    return _Place(
        board.position_rank <= line,
        f"with no ranking for him this week, the call reads {board.order_words}, where he is "
        f"{sheet.position}{board.position_rank}",
    )


def _status_words(status: str) -> str:
    said = STATUS_WORDS.get(status, status)
    return said if said.startswith("on ") or said == "suspended" else f"listed {said}"


def _after_report(sheet: WeekSheet) -> bool:
    """Whether his status was seen on or after his game's status report (False with no game or no read of it)."""
    seen = sheet.status.seen_at(sheet.written_at)
    return sheet.game is not None and seen is not None and seen >= status_report_issued(sheet.game.kickoff)


def _not_playing(sheet: WeekSheet) -> WeekCall | None:
    """Sit for his bye or a status that keeps him off the field, else None."""
    if sheet.bye:
        return WeekCall(SIT, f"The call is sit: his club is on its bye in week {sheet.week}, so he does not play.")
    status = sheet.status.status
    if status in CANNOT_PLAY:
        return WeekCall(
            SIT, f"The call is sit: he is {_status_words(status)}, so he does not play in week {sheet.week}."
        )
    return None


def _held(sheet: WeekSheet, place: str | None) -> WeekCall | None:
    """Hold for a Questionable player before the report or a Doubtful one, inside the line or with no place."""
    status, week = sheet.status.status, f"week {sheet.week}"
    where = "" if place is None else f"{place}, but "
    if status == QUESTIONABLE and not _after_report(sheet):
        return WeekCall(HOLD, f"The call is hold: {where}he is Questionable before {week}'s game status report.")
    if status == DOUBTFUL:
        return WeekCall(HOLD, f"The call is hold: {where}he is Doubtful for his {week} game.")
    return None


def week_call(sheet: WeekSheet) -> WeekCall:
    """`sheet`'s call: sit when he cannot play, else his place this week against his position's starter line,
    held for a Questionable (before the report) or Doubtful player inside it."""
    out = _not_playing(sheet)
    if out is not None:
        return out
    place = _place(sheet)
    if place is None:
        return _held(sheet, None) or WeekCall(NONE, "There is no lineup call: he has no place at his position.")
    if not place.inside:
        return WeekCall(SIT, f"The call is sit: {place.words}, past the {_plural(sheet)} a lineup starts.")
    return _held(sheet, place.words) or WeekCall(START, f"The call is start: {place.words}, so he belongs in a lineup.")
