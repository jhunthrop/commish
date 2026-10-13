"""START AND SIT: FLOOR WHEN YOU ARE AHEAD, CEILING WHEN YOU ARE BEHIND.

Ported from `research-ts/src/projections/decide/lineup.ts`. Every starter is chosen to maximise
`P(our total clears theirs)`; with a lead a smaller spread raises it, from behind a larger one does,
and that is the arithmetic, not a branch. Two passes: a baseline lineup on expected points, then
each spot re-chosen against it.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from research.model.arithmetic import Arithmetic
from research.model.decide.normal import chance_of_clearing
from research.model.decide.outlook import ProjectionDistribution, standard_deviation_of
from research.model.decide.slots import StartingSpot, assign_starters, id_key, starting_spots
from research.model.domain import Position, RosterSlotConfig, RosterSlotType
from research.model.jsmath import js_pow

LineupCode = Literal[
    "highest_expected_points",
    "floor_protects_a_lead",
    "ceiling_chases_a_deficit",
    "only_eligible_player",
    "no_eligible_player",
]


@dataclass(frozen=True, slots=True)
class LineupCandidate:
    player_id: str
    position: Position
    outlook: ProjectionDistribution


@dataclass(frozen=True, slots=True)
class MatchupContext:
    projected_margin: float
    opponent_standard_deviation: float


@dataclass(frozen=True, slots=True)
class LineupReason:
    """One `LineupReason`: its code and the numbers that code carries (None where it carries none)."""

    code: LineupCode
    expected_points: float | None = None
    projected_margin: float | None = None
    standard_deviation: float | None = None
    expected_points_forgone: float | None = None
    slot: RosterSlotType | None = None


@dataclass(frozen=True, slots=True)
class StartDecision:
    slot: RosterSlotType
    slot_index: int
    player_id: str | None
    expected_points: float | None
    floor: float | None
    ceiling: float | None
    reasons: tuple[LineupReason, ...]


@dataclass(frozen=True, slots=True)
class LineupDecision:
    starters: tuple[StartDecision, ...]
    bench: tuple[str, ...]
    win_probability: float


def _spread(candidate: LineupCandidate) -> float:
    return standard_deviation_of(candidate.outlook)


def _median(candidate: LineupCandidate) -> float:
    return candidate.outlook.median


class _Matchup:
    """The baseline lineup and the win chance of any one swap against it."""

    def __init__(
        self,
        spots: Sequence[StartingSpot],
        candidates: Sequence[LineupCandidate],
        matchup: MatchupContext,
        arithmetic: Arithmetic,
    ) -> None:
        self.baseline = assign_starters(spots, candidates, _median)
        self.matchup = matchup
        self.arithmetic = arithmetic
        variance = 0.0
        for player in self.baseline.values():
            variance = variance + (0 if player is None else js_pow(_spread(player), 2))
        self.variance = js_pow(matchup.opponent_standard_deviation, 2) + variance

    def win_if_started(self, spot: StartingSpot, candidate: LineupCandidate) -> float:
        incumbent = self.baseline.get(spot.key)
        incumbent_points = 0.0 if incumbent is None else incumbent.outlook.median
        incumbent_variance = 0.0 if incumbent is None else js_pow(_spread(incumbent), 2)
        variance = self.variance - incumbent_variance + js_pow(_spread(candidate), 2)
        margin = self.matchup.projected_margin + candidate.outlook.median - incumbent_points
        return chance_of_clearing(margin, math.sqrt(variance), 0, self.arithmetic)


def _reason(
    chosen: LineupCandidate, eligible: Sequence[LineupCandidate], spot: StartingSpot, margin: float
) -> LineupReason:
    others = sorted(
        (c for c in eligible if c.player_id != chosen.player_id), key=lambda c: (-c.outlook.median, id_key(c.player_id))
    )
    if not others:
        return LineupReason("only_eligible_player", slot=spot.slot)
    passed_over = others[0]
    if chosen.outlook.median > passed_over.outlook.median and _spread(chosen) <= _spread(passed_over):
        return LineupReason("highest_expected_points", expected_points=chosen.outlook.median)
    forgone = passed_over.outlook.median - chosen.outlook.median
    spread = _spread(chosen)
    code: LineupCode = "floor_protects_a_lead" if spread < _spread(passed_over) else "ceiling_chases_a_deficit"
    return LineupReason(code, projected_margin=margin, standard_deviation=spread, expected_points_forgone=forgone)


def start_sit(
    candidates: Sequence[LineupCandidate],
    roster_slots: Sequence[RosterSlotConfig],
    matchup: MatchupContext,
    arithmetic: Arithmetic,
) -> LineupDecision:
    """`startSit`: the lineup that maximises the chance of clearing the opponent."""
    if not matchup.opponent_standard_deviation > 0:
        raise ValueError(
            f"A matchup needs a positive opponent spread; got {matchup.opponent_standard_deviation}. Certainty is not on offer."
        )
    spots = starting_spots(roster_slots)
    game = _Matchup(spots, candidates, matchup, arithmetic)
    taken: set[str] = set()
    starters: list[StartDecision] = []
    for spot in spots:
        eligible = [c for c in candidates if c.player_id not in taken and c.position in spot.eligible_positions]
        if not eligible:
            reason = LineupReason("no_eligible_player", slot=spot.slot)
            starters.append(StartDecision(spot.slot, spot.slot_index, None, None, None, None, (reason,)))
            continue
        chosen = sorted(eligible, key=lambda c: (-game.win_if_started(spot, c), id_key(c.player_id)))[0]
        taken.add(chosen.player_id)
        reason = _reason(chosen, eligible, spot, matchup.projected_margin)
        outlook = chosen.outlook
        starters.append(
            StartDecision(
                spot.slot, spot.slot_index, chosen.player_id, outlook.median, outlook.floor, outlook.ceiling, (reason,)
            )
        )
    chosen_players = [c for c in candidates if c.player_id in taken]
    chosen_points = 0.0
    chosen_variance = 0.0
    for player in chosen_players:
        chosen_points = chosen_points + player.outlook.median
        chosen_variance = chosen_variance + js_pow(_spread(player), 2)
    baseline_points = 0.0
    for incumbent in game.baseline.values():
        baseline_points = baseline_points + (0 if incumbent is None else incumbent.outlook.median)
    variance = js_pow(matchup.opponent_standard_deviation, 2) + chosen_variance
    win = chance_of_clearing(
        matchup.projected_margin + chosen_points - baseline_points, math.sqrt(variance), 0, arithmetic
    )
    bench = tuple(sorted(c.player_id for c in candidates if c.player_id not in taken))
    return LineupDecision(tuple(starters), bench, win)
