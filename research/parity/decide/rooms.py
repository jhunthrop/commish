"""THE RECORDED ROOM STATES THE ADVISOR CASE ASKS BOTH SIDES ABOUT.

Two inputs, recorded once into `parity/fixtures/advisor-rooms-2026/`:
- the 26 mock rooms of `api/testdata/mocks/logs.json` (the Go engine's own replay fixture): their
  roster rules, draft order and every pick, in order;
- the board the Go rooms read for PPR (`api/internal/boards/source.go`'s `boardQuery`, run read only
  against the dev copy's `research` schema): every provider player in ADP order with the stored
  board's points through the crosswalk.

A room state is a room's first n picks, in the order they were made, with the team that made the
next one on the clock, sent exactly as `api/internal/advisor/http.go` builds its request: each
pick's own number from the draft state, each seat and the seat on the clock by `seatOf`, the board
in its order, every drafted player, the first 400 undrafted, a player with no ADP placed at 1000
plus his board index.

A room whose turns leave the snake is sent as it is. In `slow2_10t_standard` pick 8's clock ran out
and the pick was owed, so the state after seven picks has seat 9 on the clock (the oracle refuses
it, 422: pick 8 belongs to seat 8) and every later state numbers its eighth pick 9 (refused, 400:
picks must be numbered 1..n). The oracle answers only snake rooms; the Go rooms fall back to the
engine's card for the rest of such a draft. One state per
round per room, its slot in the round stepping through the seats, plus each room's last pick: every
roster shape the mocks carry (standard, superflex, two flex, no kicker with a deep bench), every
team count, the bench filling, the late kicker and defense calls and the last pick of a draft.
"""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from research.parity.model.outcome import source_rows

_REPO: Final = Path(__file__).resolve().parents[3]
FIXTURE: Final = _REPO / "research" / "parity" / "fixtures" / "advisor-rooms-2026"
_MOCK_LOGS: Final = _REPO / "api" / "testdata" / "mocks" / "logs.json"
# What the Go client sends (`http.go`): its depth into the undrafted pool, the shortlist it asks
# for, and where an unpriced player is queued.
UNDRAFTED_SENT: Final = 400
SHORTLIST_SIZE: Final = 5
UNPRICED_ADP_FROM: Final = 1000
_ROUND_STEP: Final = 7
BOARD_SOURCE: Final = "commish_board_v9_ppr_12"
BOARD_SEASON: Final = 2026

# `boardQuery` in api/internal/boards/source.go, schema `research`, verbatim but for the schema.
_BOARD_QUERY: Final = """with latest as (
  select max(as_of) as as_of from research.preseason_projections where season = %s and source = %s
), proj as (
  select c.provider_player_id, p.projected_points
  from research.preseason_projections p
  join latest l on p.as_of = l.as_of
  join research.player_crosswalk c on c.player_id = p.player_id
  where p.season = %s and p.source = %s
)
select pp.id, pp.position, pp.adp, proj.projected_points, (select as_of from latest) as as_of
from research.provider_players pp left join proj on proj.provider_player_id = pp.id
order by pp.adp asc nulls last, pp.id collate "C\""""

_POSITIONS: Final = frozenset({"QB", "RB", "WR", "TE", "K", "DEF"})


def record() -> Path:
    """Reads the mock rooms and the dev board; writes the fixture with its manifest."""
    logs = json.loads(_MOCK_LOGS.read_text())
    rooms = [
        {
            "name": room["name"],
            "slotConfig": room["config"]["slotConfig"],
            "draftOrder": room["finalState"]["draftOrder"],
            "picks": [
                {"pickNumber": p["pickNumber"], "teamId": p["teamId"], "playerId": p["playerId"]}
                for p in room["finalState"]["picks"]
            ],
        }
        for room in logs["rooms"]
    ]
    rows = source_rows(_BOARD_QUERY, (BOARD_SEASON, BOARD_SOURCE, BOARD_SEASON, BOARD_SOURCE))
    board = [
        {"id": r["id"], "position": r["position"], "adp": r["adp"], "points": r["projected_points"]}
        for r in rows
        if r["position"] in _POSITIONS
    ]
    FIXTURE.mkdir(parents=True, exist_ok=True)
    (FIXTURE / "rooms.json").write_text(json.dumps(rooms, separators=(",", ":")) + "\n")
    (FIXTURE / "board.json").write_text(json.dumps(board, separators=(",", ":")) + "\n")
    manifest = {
        "rooms": f"api/testdata/mocks/logs.json ({logs['source']}): {len(rooms)} rooms, final picks in order",
        "board": f"api/internal/boards/source.go boardQuery on the dev copy, schema research, season {BOARD_SEASON}, source {BOARD_SOURCE}, as of {rows[0]['as_of'].isoformat() if rows else None}: {len(board)} players",
    }
    (FIXTURE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return FIXTURE


@dataclass(frozen=True, slots=True)
class RoomState:
    label: str
    shape: str
    request: dict[str, Any]


def _go_request(room: dict[str, Any], board: list[dict[str, Any]], made: int) -> dict[str, Any]:
    """`HTTP.request` in api/internal/advisor/http.go, for the room after `made` picks, with the
    team that made the next pick on the clock."""
    order: list[str] = room["draftOrder"]
    picks = room["picks"][:made]
    drafted = {pick["playerId"] for pick in picks}
    pool: list[dict[str, Any]] = []
    undrafted = 0
    for index, player in enumerate(board):
        if player["id"] not in drafted:
            if undrafted >= UNDRAFTED_SENT:
                continue
            undrafted += 1
        adp = player["adp"] if player["adp"] is not None and player["adp"] > 0 else float(UNPRICED_ADP_FROM + index)
        pool.append(
            {"id": player["id"], "position": player["position"], "adp": adp, "projectedPoints": player["points"]}
        )
    return {
        "teamCount": len(order),
        "rosterSlots": room["slotConfig"],
        "pool": pool,
        "picks": [
            {"pickNumber": p["pickNumber"], "playerId": p["playerId"], "seat": order.index(p["teamId"]) + 1}
            for p in picks
        ],
        "seatOnClock": order.index(room["picks"][made]["teamId"]) + 1,
        "shortlistSize": SHORTLIST_SIZE,
    }


def _made_counts(teams: int, total: int) -> Iterator[int]:
    rounds = -(-total // teams)
    for round_number in range(1, rounds + 1):
        made = (round_number - 1) * teams + (round_number * _ROUND_STEP) % teams
        if made < total:
            yield made
    yield total - 1


def room_states() -> list[RoomState]:
    """Every recorded state, in room order."""
    rooms = json.loads((FIXTURE / "rooms.json").read_text())
    board = json.loads((FIXTURE / "board.json").read_text())
    states: list[RoomState] = []
    for room in rooms:
        shape = room["name"].split("_", 2)[2]
        for made in dict.fromkeys(_made_counts(len(room["draftOrder"]), len(room["picks"]))):
            states.append(RoomState(f"{room['name']}@{made + 1}", shape, _go_request(room, board, made)))
    return states
