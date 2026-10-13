"""THE ROOM STATE `POST /advise` TAKES, validated at the boundary.

The contract is the Go rooms' (`api/internal/advisor/http.go`, `wireRequest`), which is the shape
`research-ts/src/advisor/request.ts` validates: the pool with what we project and where drafters
take each man, the picks so far, the seat on the clock and the league's roster rules.

The checks are the oracle's zod schema, in its order and in its words (`checks.py`): strict, so a
string is never read as a number nor a number as a string, and a refused body names each issue
exactly as the oracle's 400 does. Its `superRefine` (unique ids, picks numbered 1..n from the pool,
seats in range) runs when no issue aborted, as zod runs it.

Past the oracle, the service bounds what one call may ask for, so no body under the 1 MB cap holds
a worker for long: the Go rooms send at most 400 undrafted players plus the drafted ones, and their
formats seat at most 14 teams with 17 rostered.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Final, cast, get_args

from research.advisor.checks import (
    MISSING,
    NOT_JSON,
    Bound,
    Issue,
    NotJsonError,
    Path,
    array,
    number,
    obj,
    option,
    parse_body,
    string,
)
from research.model.domain import POSITIONS, Position, RosterSlotConfig, RosterSlotType

MAX_TEAMS: Final = 32
MAX_SHORTLIST: Final = 20
MAX_POOL: Final = 1_000
MAX_SLOT_COUNT: Final = 12
MAX_ROSTER_SIZE: Final = 30
_SLOT_TYPES: Final[tuple[RosterSlotType, ...]] = get_args(RosterSlotType)
_POSITIVE: Final = (Bound(">", 0),)
_TEAM_BOUNDS: Final = (Bound(">=", 2), Bound("<=", MAX_TEAMS))
_SHORTLIST_BOUNDS: Final = (Bound(">=", 1), Bound("<=", MAX_SHORTLIST))

__all__ = ["NOT_JSON", "AdviseRequest", "Pick", "PoolEntry", "RequestError", "parse_request"]

type Check = Callable[[object, Path], list[Issue]]


@dataclass(frozen=True, slots=True)
class PoolEntry:
    """One player in the room's pool, drafted or not. `projected_points` is None for a position the
    board ships in market order, which then has survival odds but no value."""

    id: str
    position: Position
    adp: float
    projected_points: float | None


@dataclass(frozen=True, slots=True)
class Pick:
    pick_number: int
    player_id: str
    seat: int


@dataclass(frozen=True, slots=True)
class AdviseRequest:
    team_count: int
    roster_slots: tuple[RosterSlotConfig, ...]
    pool: tuple[PoolEntry, ...]
    picks: tuple[Pick, ...]
    seat_on_clock: int
    shortlist_size: int | None

    def slot_configs(self) -> tuple[RosterSlotConfig, ...]:
        return self.roster_slots


class RequestError(ValueError):
    """A body that is not a room state: every issue, joined, as the 400's error."""


def _fields(value: object, path: Path, checks: tuple[tuple[str, Check], ...]) -> list[Issue]:
    """An object's own type, then each field's check in the shape's order (unknown keys ignored)."""
    if not isinstance(value, dict):
        return obj(value, path)
    return [issue for key, check in checks for issue in check(value.get(key, MISSING), (*path, key))]


def _positions(value: object, path: Path) -> list[Issue]:
    return array(value, path, lambda item, at: option(item, at, POSITIONS), non_empty=True)


def _whole_positive(value: object, path: Path) -> list[Issue]:
    return number(value, path, _POSITIVE, integer=True)


_POOL_ENTRY: Final[tuple[tuple[str, Check], ...]] = (
    ("id", string),
    ("position", lambda v, p: option(v, p, POSITIONS)),
    ("adp", lambda v, p: number(v, p, _POSITIVE)),
    ("projectedPoints", lambda v, p: [] if v is None else number(v, p)),
)
_PICK: Final[tuple[tuple[str, Check], ...]] = (
    ("pickNumber", _whole_positive),
    ("playerId", string),
    ("seat", _whole_positive),
)
_SLOT: Final[tuple[tuple[str, Check], ...]] = (
    ("slot", lambda v, p: option(v, p, _SLOT_TYPES)),
    ("count", _whole_positive),
    ("eligiblePositions", _positions),
)
_REQUEST: Final[tuple[tuple[str, Check], ...]] = (
    ("teamCount", lambda v, p: number(v, p, _TEAM_BOUNDS, integer=True)),
    ("rosterSlots", lambda v, p: array(v, p, lambda i, a: _fields(i, a, _SLOT), non_empty=True)),
    ("pool", lambda v, p: array(v, p, lambda i, a: _fields(i, a, _POOL_ENTRY), non_empty=True)),
    ("picks", lambda v, p: array(v, p, lambda i, a: _fields(i, a, _PICK), non_empty=False)),
    ("seatOnClock", _whole_positive),
    ("shortlistSize", lambda v, p: [] if v is MISSING else number(v, p, _SHORTLIST_BOUNDS, integer=True)),
)


def _build(body: Mapping[str, Any]) -> AdviseRequest:
    """The typed room state from a body whose every value has its type (bounds may be broken)."""
    shortlist = body.get("shortlistSize")
    return AdviseRequest(
        team_count=int(body["teamCount"]),
        roster_slots=tuple(
            RosterSlotConfig(s["slot"], int(s["count"]), tuple(s["eligiblePositions"])) for s in body["rosterSlots"]
        ),
        pool=tuple(PoolEntry(e["id"], e["position"], e["adp"], e["projectedPoints"]) for e in body["pool"]),
        picks=tuple(Pick(int(p["pickNumber"]), p["playerId"], int(p["seat"])) for p in body["picks"]),
        seat_on_clock=int(body["seatOnClock"]),
        shortlist_size=None if shortlist is None else int(shortlist),
    )


def _refine_issues(request: AdviseRequest) -> list[str]:
    """The oracle's `superRefine`, word for word."""
    issues: list[str] = []
    ids = {entry.id for entry in request.pool}
    if len(ids) != len(request.pool):
        issues.append("body: pool ids must be unique")
    for index, pick in enumerate(request.picks):
        if pick.pick_number != index + 1:
            issues.append(f"picks.{index}.pickNumber: picks must be numbered 1..n in order; expected {index + 1}")
        if pick.player_id not in ids:
            issues.append(f'picks.{index}.playerId: "{pick.player_id}" is not in the pool')
        if pick.seat > request.team_count:
            issues.append(f"picks.{index}.seat: seat is past the team count")
    if len({pick.player_id for pick in request.picks}) != len(request.picks):
        issues.append("picks: a player was picked twice")
    if request.seat_on_clock > request.team_count:
        issues.append("seatOnClock: seat is past the team count")
    return issues


def _bound_issues(request: AdviseRequest) -> list[str]:
    """The service's own bounds, past the oracle's schema."""
    issues: list[str] = []
    if len(request.pool) > MAX_POOL:
        issues.append(f"pool: {len(request.pool)} players is over the bound of {MAX_POOL}")
    for index, slot in enumerate(request.roster_slots):
        if slot.count > MAX_SLOT_COUNT:
            issues.append(f"rosterSlots.{index}.count: {slot.count} is over the bound of {MAX_SLOT_COUNT}")
    roster_size = sum(slot.count for slot in request.roster_slots)
    if roster_size > MAX_ROSTER_SIZE:
        issues.append(f"rosterSlots: {roster_size} roster spots is over the bound of {MAX_ROSTER_SIZE}")
    return issues


def parse_request(raw: str | bytes) -> AdviseRequest:
    """The validated room state from the raw body, or `RequestError` with the oracle's 400 text
    (`NOT_JSON` when the body does not parse), or the service's bound text."""
    try:
        body = parse_body(raw)
    except NotJsonError:
        raise RequestError(NOT_JSON) from None
    shape = _fields(body, (), _REQUEST)
    texts = [issue.text() for issue in shape]
    if any(issue.aborts for issue in shape):
        raise RequestError("; ".join(texts))
    request = _build(cast("Mapping[str, Any]", body))
    texts += _refine_issues(request)
    if texts:
        raise RequestError("; ".join(texts))
    if bounds := _bound_issues(request):
        raise RequestError("; ".join(bounds))
    return request
