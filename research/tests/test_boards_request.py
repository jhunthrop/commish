"""The boards service's request boundary against the api's contract: every roster the api accepts
is one the service takes, and a key outside ScoringRules is refused by name."""

import json
import re
from pathlib import Path
from typing import Final

import pytest

from research.boards.request import MAX_ROSTER, MAX_SLOT_COUNT, RequestError, parse_request
from research.model.domain import STANDARD_SCORING

_TEAMS: Final = 14
_API: Final = Path(__file__).resolve().parents[2] / "api"


def _contract_bench_max() -> int:
    text = (_API / "openapi.yaml").read_text()
    found = re.search(r"\n\s+bench: \{ type: integer, minimum: 0, maximum: (\d+) \}", text)
    assert found, "openapi.yaml RosterCounts.bench lost its maximum"
    return int(found.group(1))


def _max_rounds() -> int:
    found = re.search(r"MaxRounds\s*=\s*(\d+)", (_API / "internal" / "leagues" / "settings.go").read_text())
    assert found, "api/internal/leagues lost MaxRounds"
    return int(found.group(1))


def _rules() -> dict[str, float]:
    return {name: getattr(STANDARD_SCORING, name) for name in STANDARD_SCORING.__slots__}


def _body(slots: list[dict[str, object]], rules: dict[str, float] | None = None) -> bytes:
    return json.dumps({"season": 2026, "rules": rules or _rules(), "shape": {"teams": _TEAMS, "slots": slots}}).encode()


def test_bounds_are_the_contracts() -> None:
    assert _contract_bench_max() == MAX_SLOT_COUNT
    assert _max_rounds() == MAX_ROSTER


def test_the_api_s_deepest_roster_is_taken() -> None:
    """A 15-man bench beside ten starters (25 rounds), the deepest the api saves."""
    slots: list[dict[str, object]] = [
        {"slot": "QB", "count": 1, "eligiblePositions": ["QB"]},
        {"slot": "RB", "count": 2, "eligiblePositions": ["RB"]},
        {"slot": "WR", "count": 3, "eligiblePositions": ["WR"]},
        {"slot": "TE", "count": 1, "eligiblePositions": ["TE"]},
        {"slot": "FLEX", "count": 1, "eligiblePositions": ["RB", "WR", "TE"]},
        {"slot": "K", "count": 1, "eligiblePositions": ["K"]},
        {"slot": "DEF", "count": 1, "eligiblePositions": ["DEF"]},
        {"slot": "BENCH", "count": 15, "eligiblePositions": ["QB", "RB", "WR", "TE", "K", "DEF"]},
    ]
    shape = parse_request(_body(slots)).shape
    assert shape.team_count == _TEAMS
    assert sum(slot.count for slot in shape.roster_slots if slot.slot == "BENCH") == MAX_SLOT_COUNT
    with pytest.raises(RequestError, match="at most 25"):
        parse_request(_body([*slots, {"slot": "QB", "count": 1, "eligiblePositions": ["QB"]}]))


def test_an_unknown_rule_is_named() -> None:
    with pytest.raises(RequestError, match=r"rules\.points_per_carry is not a field"):
        parse_request(
            _body([{"slot": "QB", "count": 1, "eligiblePositions": ["QB"]}], {**_rules(), "points_per_carry": 1})
        )
