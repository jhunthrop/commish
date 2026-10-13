"""THE ROOM STATE `POST /advise` TAKES, validated at the boundary.

The contract is the Go rooms' (`api/internal/advisor/http.go`, `wireRequest`), which is the shape
`research-ts/src/advisor/request.ts` validates: the pool with what we project and where drafters
take each man, the picks so far, the seat on the clock and the league's roster rules. Every issue
is named by its path, as the oracle names it.
"""

import math
from typing import Annotated, Final

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from research.model.domain import Position, RosterSlotConfig, RosterSlotType

MAX_TEAMS: Final = 32
MAX_SHORTLIST: Final = 20

_STRICT = ConfigDict(frozen=True, extra="ignore", populate_by_name=True)


class PoolEntry(BaseModel):
    """One player in the room's pool, drafted or not. `projected_points` is None for a position the
    board ships in market order, which then has survival odds but no value."""

    model_config = _STRICT
    id: Annotated[str, Field(min_length=1)]
    position: Position
    adp: Annotated[float, Field(gt=0, allow_inf_nan=False)]
    projected_points: Annotated[float | None, Field(alias="projectedPoints", allow_inf_nan=False)]


class Pick(BaseModel):
    model_config = _STRICT
    pick_number: Annotated[int, Field(alias="pickNumber", gt=0)]
    player_id: Annotated[str, Field(alias="playerId", min_length=1)]
    seat: Annotated[int, Field(gt=0)]


class RosterSlot(BaseModel):
    model_config = _STRICT
    slot: RosterSlotType
    count: Annotated[int, Field(gt=0)]
    eligible_positions: Annotated[tuple[Position, ...], Field(alias="eligiblePositions", min_length=1)]

    def config(self) -> RosterSlotConfig:
        return RosterSlotConfig(self.slot, self.count, self.eligible_positions)


class AdviseRequest(BaseModel):
    model_config = _STRICT
    team_count: Annotated[int, Field(alias="teamCount", ge=2, le=MAX_TEAMS)]
    roster_slots: Annotated[tuple[RosterSlot, ...], Field(alias="rosterSlots", min_length=1)]
    pool: Annotated[tuple[PoolEntry, ...], Field(min_length=1)]
    picks: tuple[Pick, ...]
    seat_on_clock: Annotated[int, Field(alias="seatOnClock", gt=0)]
    shortlist_size: Annotated[int | None, Field(alias="shortlistSize", ge=1, le=MAX_SHORTLIST)] = None

    def slot_configs(self) -> tuple[RosterSlotConfig, ...]:
        return tuple(slot.config() for slot in self.roster_slots)


class RequestError(ValueError):
    """A body that is not a room state: every issue, joined, as the 400's error."""


def _consistency_issues(request: AdviseRequest) -> list[str]:
    """The oracle's `superRefine`: unique pool ids, picks numbered in order from the pool, seats in range."""
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


def parse_request(body: object) -> AdviseRequest:
    """The validated room state, or `RequestError` naming each issue by its path."""
    try:
        request = AdviseRequest.model_validate(body)
    except ValidationError as error:
        issues = [
            f"{'.'.join(str(part) for part in issue['loc']) or 'body'}: {issue['msg']}" for issue in error.errors()
        ]
        raise RequestError("; ".join(issues)) from None
    issues = _consistency_issues(request)
    if issues:
        raise RequestError("; ".join(issues))
    for entry in request.pool:
        if entry.projected_points is not None and not math.isfinite(entry.projected_points):
            raise RequestError(f"pool: {entry.id} has a projection that is not finite")
    return request
