"""THE ADVISOR'S LOAD TOOL: whole drafts against a running service, p50/p90/p99 measured.

    uv run python -m research.advisor.bench --url http://localhost:8080 [--drafts 3] [--rooms 1] [--teams 12] [--pool 486]

Each draft is a 12-team standard snake over a pool of the board's first `--pool` priced players
(ADP order, kickers and defenses in market order with no projection, as the Go rooms send them),
every seat taking the advisor's own call, so every one of the 180 calls a draft makes is a legal
room state the rooms would send. Two numbers per call: the service's own `server-timing` (the
spec's 50 ms is the advisor's own time) and the round trip on this connection. A room asks once per
turn, so each draft's calls are sequential; `--rooms` runs that many drafts at once, each on its own
connection, the load of that many rooms on the clock together.

The board is the recorded fixture the parity case uses (`parity/fixtures/advisor-rooms-2026`, the
Go rooms' board query on the dev copy); the tool reads no database.
"""

import argparse
import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Final

import httpx

from research.model.domain import STANDARD_ROSTER_SLOTS

_DEFAULT_BOARD: Final = (
    Path(__file__).resolve().parents[1] / "parity" / "fixtures" / "advisor-rooms-2026" / "board.json"
)
_PERCENTILES: Final = (50, 90, 99)


def _pool(board_path: Path, size: int) -> list[dict[str, Any]]:
    board = json.loads(board_path.read_text())
    priced = [p for p in board if p["adp"] is not None and p["adp"] > 0][:size]
    if len(priced) < size:
        raise SystemExit(f"bench: the board has {len(priced)} priced players, fewer than --pool {size}")
    return [{"id": p["id"], "position": p["position"], "adp": p["adp"], "projectedPoints": p["points"]} for p in priced]


def _seat(teams: int, pick_number: int) -> int:
    round_number = -(-pick_number // teams)
    in_round = (pick_number - 1) % teams
    return in_round + 1 if round_number % 2 == 1 else teams - in_round


def _percentiles(values: list[float]) -> dict[int, float]:
    cuts = statistics.quantiles(values, n=100, method="inclusive")
    return {p: cuts[p - 1] for p in _PERCENTILES}


def _draft(client: httpx.Client, pool: list[dict[str, Any]], teams: int) -> tuple[list[float], list[float]]:
    slots = [
        {"slot": c.slot, "count": c.count, "eligiblePositions": list(c.eligible_positions)}
        for c in STANDARD_ROSTER_SLOTS
    ]
    rounds = sum(c.count for c in STANDARD_ROSTER_SLOTS)
    picks: list[dict[str, Any]] = []
    server: list[float] = []
    round_trip: list[float] = []
    for pick_number in range(1, teams * rounds + 1):
        seat = _seat(teams, pick_number)
        body = {
            "teamCount": teams,
            "rosterSlots": slots,
            "pool": pool,
            "picks": picks,
            "seatOnClock": seat,
            "shortlistSize": 5,
        }
        started = time.perf_counter()
        response = client.post("/advise", json=body)
        round_trip.append((time.perf_counter() - started) * 1000)
        envelope = response.json()
        if response.status_code != httpx.codes.OK or not envelope["ok"]:
            raise SystemExit(f"bench: pick {pick_number} answered {response.status_code}: {envelope.get('error')}")
        server.append(float(response.headers["server-timing"].split("dur=")[1]))
        call = envelope["data"]["shortlist"][0]["playerId"]
        picks = [*picks, {"pickNumber": pick_number, "playerId": call, "seat": seat}]
    return server, round_trip


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="research.advisor.bench", description=__doc__.splitlines()[0] if __doc__ else None
    )
    parser.add_argument("--url", default="http://localhost:8080")
    parser.add_argument("--drafts", type=int, default=3)
    parser.add_argument("--teams", type=int, default=12)
    parser.add_argument("--pool", type=int, default=486)
    parser.add_argument("--board", type=Path, default=_DEFAULT_BOARD)
    parser.add_argument("--rooms", type=int, default=1)
    args = parser.parse_args(argv)
    pool = _pool(args.board, args.pool)
    with httpx.Client(base_url=args.url, timeout=10.0) as client:
        if client.get("/readyz").status_code != httpx.codes.OK:
            raise SystemExit("bench: the service is not ready")

    def one_room(_: int) -> tuple[list[float], list[float]]:
        server: list[float] = []
        round_trip: list[float] = []
        with httpx.Client(base_url=args.url, timeout=10.0) as client:
            for _draft_number in range(args.drafts):
                s, r = _draft(client, pool, args.teams)
                server.extend(s)
                round_trip.extend(r)
        return server, round_trip

    with ThreadPoolExecutor(max_workers=args.rooms) as rooms:
        results = list(rooms.map(one_room, range(args.rooms)))
    server = [value for s, _ in results for value in s]
    round_trip = [value for _, r in results for value in r]
    sys.stdout.write(
        f"{args.rooms} room(s) at once, {args.drafts} draft(s) each, {args.teams} teams, a {args.pool}-player pool\n"
    )
    for label, values in (("server-timing", server), ("round trip", round_trip)):
        cuts = _percentiles(values)
        line = ", ".join(f"p{p} {cuts[p]:.1f} ms" for p in _PERCENTILES)
        sys.stdout.write(f"{label}: {len(values)} calls, {line}, max {max(values):.1f} ms\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
