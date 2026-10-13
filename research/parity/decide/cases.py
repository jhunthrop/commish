"""THE DECIDE CASES: the advisor on recorded room states, start/sit, and the closed form's numerics,
oracle against port, every comparison exact (tolerance 0, every bit, every word).

    uv run python -m research.parity decide <case>|all
    uv run python -m research.parity decide record      re-record the room fixture (reads the dev copy)
"""

import collections
import json
import subprocess
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from research.advisor.advise import RoomStateError, advise
from research.advisor.request import RequestError, parse_request
from research.advisor.wire import advice_json
from research.model.arithmetic import ARM64_BOARDS
from research.model.decide.survival import SurvivalCurve
from research.parity.decide.inputs import lineup_queries, normal_inputs, port_lineup, port_normal
from research.parity.decide.rooms import RoomState, room_states
from research.parity.model.compare import Diff, diff_rows
from research.parity.model.outcome import CaseResult, Claim

_REPO: Final = Path(__file__).resolve().parents[3]
_DRIVER: Final = _REPO / "research" / "parity" / "ts" / "decide.ts"
_TIMEOUT_SECONDS: Final = 1800
_MINIMUM_STATES: Final = 200
_OK: Final = 200


def run_oracle(command: str, inputs: object) -> list[Any]:
    """`ts/decide.ts <command>` on `inputs`: its JSON lines."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=True) as handle:
        json.dump(inputs, handle)
        handle.flush()
        completed = subprocess.run(
            ["npx", "tsx", str(_DRIVER), command, handle.name],
            cwd=_REPO,
            capture_output=True,
            text=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
        )
    if completed.returncode != 0:
        raise RuntimeError(f"the oracle's decide {command} failed: {completed.stderr.strip()[-2000:]}")
    return [json.loads(line) for line in completed.stdout.splitlines() if line.startswith("{")]


def _port_advise(request: dict[str, Any], curve: SurvivalCurve) -> dict[str, Any]:
    try:
        return {"status": 200, "data": advice_json(advise(parse_request(request), curve))}
    except RequestError as error:
        return {"status": 400, "error": str(error)}
    except RoomStateError as error:
        return {"status": 422, "error": str(error)}


def _rows(label: str, answer: Mapping[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    """One answer as keyed rows per section: the card, the shortlist, the survival, the tiers."""
    sections: dict[str, dict[str, dict[str, Any]]] = collections.defaultdict(dict)
    if answer["status"] != _OK:
        sections["refusal"][label] = {"status": answer["status"], "error": answer["error"]}
        return sections
    data = answer["data"]
    sections["card"][label] = {k: data[k] for k in ("pickNumber", "nextPickNumber", "basis")}
    for index, candidate in enumerate(data["shortlist"]):
        sections["shortlist"][f"{label} #{index + 1}"] = dict(candidate)
    for player_id, chance in data["survival"].items():
        sections["survival"][f"{label} {player_id}"] = {"survival": chance}
    for position, tiers in data["tiers"].items():
        for tier in tiers:
            sections["tiers"][f"{label} {position} {tier['tier']}"] = dict(tier)
    return sections


def _shape_counts(states: Sequence[RoomState], oracle: Sequence[Mapping[str, Any]]) -> list[str]:
    fallback = must = last = 0
    for answer in oracle:
        if answer["status"] != _OK:
            continue
        shortlist = answer["data"]["shortlist"]
        if all(c["position"] in {"K", "DEF"} and c["expectedValueAdded"] == 0 for c in shortlist):
            fallback += 1
        if any(c["why"].startswith("Your next pick must be") for c in shortlist):
            must += 1
        if answer["data"]["nextPickNumber"] is None:
            last += 1
    shapes = collections.Counter(state.shape for state in states)
    return [
        "states by roster shape: " + ", ".join(f"{shape} {count}" for shape, count in sorted(shapes.items())),
        f"{fallback} states answered by the late kicker and defense rule, {must} with the must-pick line, {last} at a seat's last pick",
    ]


def advise_rooms() -> CaseResult:
    states = room_states()
    oracle = run_oracle("advise", [state.request for state in states])
    curve = SurvivalCurve(ARM64_BOARDS)
    port = [_port_advise(state.request, curve) for state in states]
    left: dict[str, dict[str, dict[str, Any]]] = collections.defaultdict(dict)
    right: dict[str, dict[str, dict[str, Any]]] = collections.defaultdict(dict)
    for state, ours, theirs in zip(states, port, oracle, strict=True):
        for section, rows in _rows(state.label, theirs).items():
            left[section].update(rows)
        for section, rows in _rows(state.label, ours).items():
            right[section].update(rows)
    sections = ("card", "shortlist", "survival", "tiers", "refusal")
    diffs = [
        diff_rows(f"advise {section}", left[section], right[section], may_be_empty=section == "refusal")
        for section in sections
    ]
    refusals = [
        f"{state.label}: {answer['error']}"
        for state, answer in zip(states, oracle, strict=True)
        if answer["status"] != _OK
    ]
    answered = len(states) - len(refusals)
    claims = [
        Claim(
            f"{len(states)} recorded room states, {answered} answered, at least {_MINIMUM_STATES}",
            answered >= _MINIMUM_STATES,
        ),
    ]
    notes = [
        *_shape_counts(states, oracle),
        *(f"refused alike (a room whose turns left the snake): {line}" for line in refusals),
    ]
    return CaseResult("advise-rooms", diffs, notes, claims=claims)


def lineup_random() -> CaseResult:
    queries = lineup_queries()
    oracle = run_oracle("lineup", queries)
    port = [port_lineup(query) for query in queries]
    left = {f"query {n}": _flat(answer) for n, answer in enumerate(oracle)}
    right = {f"query {n}": _flat(answer) for n, answer in enumerate(port)}
    return CaseResult("lineup", [diff_rows("startSit decisions", left, right)])


def normal_numerics() -> CaseResult:
    inputs = normal_inputs()
    oracle = run_oracle("normal", inputs)
    port = port_normal(inputs)
    diffs: list[Diff] = []
    for line, mine in zip(oracle, port, strict=True):
        (name, theirs), (_, ours) = next(iter(line.items())), next(iter(mine.items()))
        left, right = _numeric_rows(name, theirs), _numeric_rows(name, ours)
        diffs.append(diff_rows(name, left, right))
    return CaseResult("normal", diffs)


def _numeric_rows(name: str, values: Sequence[Any]) -> dict[str, dict[str, Any]]:
    """One row per value; a survival query's answer one row per player in queue order."""
    if name != "survival":
        return {f"{name} {n}": {"value": value} for n, value in enumerate(values)}
    return {
        f"survival {n} {rank} {player_id}": {"value": chance}
        for n, query in enumerate(values)
        for rank, (player_id, chance) in enumerate(query)
    }


def _flat(answer: Mapping[str, Any]) -> dict[str, Any]:
    """Compared whole by `==`: every float exactly, an int and a float of the same value alike (JSON
    prints the oracle's 0 as 0)."""
    return {"answer": answer}


@dataclass(frozen=True, slots=True)
class DecideCase:
    name: str
    summary: str
    run: Callable[[], CaseResult]


DECIDE_CASES: Final = (
    DecideCase(
        "advise-rooms", "POST /advise on every recorded room state: card, shortlist, why, survival, tiers", advise_rooms
    ),
    DecideCase(
        "lineup", "startSit on generated rosters and matchups, every starter, reason and the win chance", lineup_random
    ),
    DecideCase(
        "normal",
        "normalCdf, chanceOfClearing, the survival curve and the outlook band on generated inputs",
        normal_numerics,
    ),
)
