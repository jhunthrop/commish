"""THE CUSTOM BOARD REQUEST, validated at the boundary: `{season, rules, shape}`.

`rules` is ScoringRules, exactly its 21 snake_case keys (`research.model.domain`), every one a
finite number: an unknown key or a missing one is refused by name, so no rule is silently read as
zero. `shape` is the league: `teams` and the roster's `slots` in the Go rooms' wire shape
(`draft.SlotConfig`: slot, count, eligiblePositions). The board values only the scored positions,
so kickers and defences are taken off the shape here (`scored_slots`), as every stored board is.
"""

import hashlib
import json
import math
from dataclasses import astuple, dataclass, fields
from typing import Any, Final, cast, get_args

from research.model.decide.value import LeagueShape
from research.model.domain import POSITIONS, Position, RosterSlotConfig, RosterSlotType, ScoringRules
from research.model.preseason.build import scored_slots

RULE_KEYS: Final = tuple(field.name for field in fields(ScoringRules))
MAX_RULE_POINTS: Final = 100.0
MIN_SEASON: Final = 2000
MAX_SEASON: Final = 2100
MIN_TEAMS: Final = 2
MAX_TEAMS: Final = 32
MAX_SLOTS: Final = 12
MAX_SLOT_COUNT: Final = 12
_SLOT_TYPES: Final[tuple[str, ...]] = get_args(RosterSlotType)


class RequestError(ValueError):
    """A body that is not a custom board request; the message names the field."""


@dataclass(frozen=True, slots=True)
class CustomRequest:
    season: int
    rules: ScoringRules
    shape: LeagueShape

    @property
    def rules_hash(self) -> str:
        return digest(dict(zip(RULE_KEYS, astuple(self.rules), strict=True)))

    @property
    def shape_hash(self) -> str:
        return digest(shape_json(self.shape))


def digest(value: object) -> str:
    """A stable hash of a JSON value: sorted keys, floats as the shortest round-trip decimal."""
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def shape_json(shape: LeagueShape) -> dict[str, Any]:
    return {
        "teams": shape.team_count,
        "slots": [
            {"slot": slot.slot, "count": slot.count, "eligiblePositions": list(slot.eligible_positions)}
            for slot in shape.roster_slots
        ],
    }


def _number(value: object, where: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise RequestError(f"{where} must be a finite number")
    return float(value)


def _whole(value: object, where: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise RequestError(f"{where} must be a whole number from {low} to {high}")
    return value


def _object(value: object, where: str, keys: tuple[str, ...]) -> dict[str, object]:
    if not isinstance(value, dict):
        raise RequestError(f"{where} must be an object")
    unknown = sorted(set(value) - set(keys))
    if unknown:
        raise RequestError(f"{where}.{unknown[0]} is not a field")
    missing = [key for key in keys if key not in value]
    if missing:
        raise RequestError(f"{where}.{missing[0]} is required")
    return cast(dict[str, object], value)


def parse_rules(value: object) -> ScoringRules:
    raw = _object(value, "rules", RULE_KEYS)
    figures: dict[str, float] = {}
    for key in RULE_KEYS:
        figure = _number(raw[key], f"rules.{key}")
        if abs(figure) > MAX_RULE_POINTS:
            raise RequestError(f"rules.{key} must stay within {MAX_RULE_POINTS:g} points either way")
        figures[key] = figure
    return ScoringRules(**figures)


def _slot(value: object, where: str) -> RosterSlotConfig:
    raw = _object(value, where, ("slot", "count", "eligiblePositions"))
    slot = raw["slot"]
    if slot not in _SLOT_TYPES:
        raise RequestError(f"{where}.slot must be one of {', '.join(_SLOT_TYPES)}")
    positions = raw["eligiblePositions"]
    if not isinstance(positions, list) or not positions or any(p not in POSITIONS for p in positions):
        raise RequestError(f"{where}.eligiblePositions must list positions from {', '.join(POSITIONS)}")
    count = _whole(raw["count"], f"{where}.count", 1, MAX_SLOT_COUNT)
    return RosterSlotConfig(cast(RosterSlotType, slot), count, tuple(cast(list[Position], positions)))


def parse_shape(value: object) -> LeagueShape:
    raw = _object(value, "shape", ("teams", "slots"))
    teams = _whole(raw["teams"], "shape.teams", MIN_TEAMS, MAX_TEAMS)
    slots = raw["slots"]
    if not isinstance(slots, list) or not 1 <= len(slots) <= MAX_SLOTS:
        raise RequestError(f"shape.slots must list 1 to {MAX_SLOTS} slots")
    return LeagueShape(teams, scored_slots([_slot(slot, f"shape.slots.{i}") for i, slot in enumerate(slots)]))


def parse_request(body: bytes) -> CustomRequest:
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RequestError("the body is not JSON") from error
    raw = _object(value, "body", ("season", "rules", "shape"))
    season = _whole(raw["season"], "season", MIN_SEASON, MAX_SEASON)
    return CustomRequest(season, parse_rules(raw["rules"]), parse_shape(raw["shape"]))
