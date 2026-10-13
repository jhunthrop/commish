"""THE BODIES `POST /advise` REFUSES: every refusal the oracle's server makes, asked of both sides.

Each body is a recorded room state broken one way or several, or a body that is not JSON; the
status and the whole error text must be equal. They cover every check of the oracle's schema, the
order its issues are named in, which issues stop its `superRefine` (a wrong type, an option that
is not one, a number that is not an int) and which do not (a bound), JavaScript's numbers (an
overflowing literal, past the safe integers, minus zero), and two bodies it answers (a key it does
not know, a key given twice).

The port's own bounds (`MAX_POOL` and the roster bounds) refuse what the oracle answers; they are
pinned by `tests/test_advisor_http.py`, not here.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final

type Body = dict[str, Any]

_TWO_PICKS: Final = 2
_SAFE_INTEGER: Final = 2**53 - 1


@dataclass(frozen=True, slots=True)
class Refusal:
    label: str
    raw: str


def _first_pool(body: Body, **changes: Any) -> Body:
    return {**body, "pool": [{**body["pool"][0], **changes}, *body["pool"][1:]]}


def _first_pick(body: Body, **changes: Any) -> Body:
    return {**body, "picks": [{**body["picks"][0], **changes}, *body["picks"][1:]]}


def _first_slot(body: Body, **changes: Any) -> Body:
    return {**body, "rosterSlots": [{**body["rosterSlots"][0], **changes}, *body["rosterSlots"][1:]]}


def _without(body: Body, key: str) -> Body:
    return {k: v for k, v in body.items() if k != key}


def _twice(body: Body) -> Body:
    return {**body, "pool": [*body["pool"], body["pool"][0]]}


_BROKEN: Final[tuple[tuple[str, Callable[[Body], object]], ...]] = (
    ("a team count as a string", lambda b: {**b, "teamCount": str(b["teamCount"])}),
    ("one team", lambda b: {**b, "teamCount": 1}),
    ("33 teams", lambda b: {**b, "teamCount": 33}),
    ("a team count of 2.5", lambda b: {**b, "teamCount": 2.5}),
    ("a team count of 1e20", lambda b: {**b, "teamCount": 1e20}),
    ("an ADP as a string", lambda b: _first_pool(b, adp=str(b["pool"][0]["adp"]))),
    ("an ADP of zero", lambda b: _first_pool(b, adp=0)),
    ("an ADP below zero and a projection as a string", lambda b: _first_pool(b, adp=-1, projectedPoints="3")),
    ("a projection as true", lambda b: _first_pool(b, projectedPoints=True)),
    ("a position that is not one", lambda b: _first_pool(b, position="XX")),
    ("an empty id", lambda b: _first_pool(b, id="")),
    ("an id as a number", lambda b: _first_pool(b, id=5)),
    ("a pool entry as a string", lambda b: {**b, "pool": ["x", *b["pool"]]}),
    ("a pick number of 1.5", lambda b: _first_pick(b, pickNumber=1.5)),
    ("a pick number of 1.5 and a pool id twice", lambda b: _first_pick(_twice(b), pickNumber=1.5)),
    ("an option that is not one and a pool id twice", lambda b: _first_pool(_twice(b), position="XX")),
    ("a seat of zero", lambda b: _first_pick(b, seat=0)),
    ("a pick with every field wrong", lambda b: {**b, "picks": [{"pickNumber": -1, "playerId": 5, "seat": "a"}]}),
    ("no seat on the clock", lambda b: _without(b, "seatOnClock")),
    ("a seat on the clock past the safe integers", lambda b: {**b, "seatOnClock": _SAFE_INTEGER + 2}),
    ("no pool", lambda b: _without(b, "pool")),
    ("a pool as a string", lambda b: {**b, "pool": "x"}),
    ("an empty pool", lambda b: {**b, "pool": []}),
    ("no roster slots", lambda b: {**b, "rosterSlots": []}),
    ("roster slots as an object", lambda b: {**b, "rosterSlots": {}}),
    ("a slot type that is not one", lambda b: _first_slot(b, slot="IDP")),
    ("a slot with no positions", lambda b: _first_slot(b, eligiblePositions=[])),
    (
        "a slot count of zero and a position that is not one",
        lambda b: _first_slot(b, count=0, eligiblePositions=["QB", "ZZ"]),
    ),
    ("a slot count of 1.5 and a seat of zero", lambda b: _first_pick(_first_slot(b, count=1.5), seat=0)),
    ("a shortlist of 21", lambda b: {**b, "shortlistSize": 21}),
    ("a shortlist of zero", lambda b: {**b, "shortlistSize": 0}),
    ("a shortlist of null", lambda b: {**b, "shortlistSize": None}),
    ("an empty object", lambda b: {}),
    ("an array", lambda b: [b]),
    ("a string", lambda b: "advise me"),
    ("null", lambda b: None),
    ("a pool id twice", _twice),
    ("a pool id twice and a seat past the team count", lambda b: _first_pick(_twice(b), seat=99)),
    ("a pick numbered out of order", lambda b: _first_pick(b, pickNumber=2)),
    ("a pick from outside the pool", lambda b: _first_pick(b, playerId="nobody")),
    ("a pick's seat past the team count", lambda b: _first_pick(b, seat=b["teamCount"] + 1)),
    ("a player picked twice", lambda b: _first_pick(b, playerId=b["picks"][1]["playerId"])),
    ("a seat on the clock past the team count", lambda b: {**b, "seatOnClock": b["teamCount"] + 1}),
    ("the wrong seat on the clock", lambda b: {**b, "seatOnClock": b["seatOnClock"] % b["teamCount"] + 1}),
    ("a key the schema does not know", lambda b: {**b, "unknown": 1}),
)


def _raw_edits(body: str, team_count: int) -> tuple[tuple[str, str], ...]:
    """Bodies only text can say: JavaScript's numbers and a key given twice."""
    teams = f'"teamCount": {team_count}'
    return (
        ("an empty body", ""),
        ("text", "nope"),
        ("NaN", '{"teamCount": NaN}'),
        ("a cut body", '{"pool": ['),
        ("a team count of minus zero", body.replace(teams, '"teamCount": -0', 1)),
        ("an ADP of 1e400", body.replace('"adp": ', '"adp": 1e400, "was": ', 1)),
        ("a projection of -1e400", body.replace('"projectedPoints": ', '"projectedPoints": -1e400, "was": ', 1)),
        ("a team count as a 21-digit literal", body.replace(teams, '"teamCount": 100000000000000000000', 1)),
        ("a key given twice, the last kept", '{"teamCount": "twelve", ' + body[1:]),
    )


def refusals(state: Body) -> list[Refusal]:
    """Every body, built from one recorded room state that has at least two picks."""
    if len(state["picks"]) < _TWO_PICKS:
        raise ValueError("the refusals are built from a room state with at least two picks")
    built = [Refusal(label, json.dumps(build(state))) for label, build in _BROKEN]
    return [*built, *(Refusal(label, raw) for label, raw in _raw_edits(json.dumps(state), state["teamCount"]))]
