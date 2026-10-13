"""ONE SEASON'S BOARDS, BUILT: the raw model board and (with the market) the blended ones.

Ported from `research-ts/src/projections/preseason/persist.ts` (`buildBoard`, the league shape)
and `market/blend.ts` (`shippedPreseasonBoardInputs`'s raw arm, `gated`).
"""

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

from sqlalchemy import Connection

from research.model.decide.value import LeagueShape
from research.model.domain import BENCH_SLOT, PPR_SCORING, STANDARD_ROSTER_SLOTS, RosterSlotConfig
from research.model.preseason.board import BoardEntry, preseason_board
from research.model.preseason.candidates import (
    SHIPPED_PRESEASON_FEATURES,
    BoardCandidate,
    PreseasonFeatures,
    PreseasonPriors,
)
from research.model.preseason.emit import ExcludedCandidate, gate_candidates, preseason_candidates
from research.model.preseason.inputs import (
    PreseasonInputs,
    roster_ids,
    sweep_phase_for,
    week_one_roster_stamp_of,
)
from research.model.preseason.roster_status import RosterSweep, current_statuses_as_of
from research.model.priors import ModelArtifacts

_SCORED: Final = ("QB", "RB", "WR", "TE")
TEAM_COUNT: Final = 12


def _scored_slots() -> tuple[RosterSlotConfig, ...]:
    kept = [
        slot
        for slot in STANDARD_ROSTER_SLOTS
        if slot.slot == BENCH_SLOT or all(p in _SCORED for p in slot.eligible_positions)
    ]
    return tuple(
        replace(slot, eligible_positions=tuple(p for p in slot.eligible_positions if p in _SCORED)) for slot in kept
    )


# Twelve teams, no kickers and no defences: the league every stored board is valued in.
BOARD_SHAPE: Final = LeagueShape(TEAM_COUNT, _scored_slots())


@dataclass(frozen=True, slots=True)
class GatedInputs:
    inputs: PreseasonInputs
    candidates: list[BoardCandidate]
    exclusions: list[ExcludedCandidate]
    sweep: RosterSweep | None


def gated(
    conn: Connection,
    inputs: PreseasonInputs,
    artifacts: ModelArtifacts,
    priors: PreseasonPriors | None = None,
    features: PreseasonFeatures = SHIPPED_PRESEASON_FEATURES,
) -> GatedInputs:
    """`gated`: the current status attached, the candidates built, the roster gate applied."""
    read = current_statuses_as_of(
        conn,
        inputs.season,
        inputs.moment,
        roster_ids(inputs.roster),
        week_one_roster_stamp_of(inputs),
        sweep_phase_for(inputs.moment_kind),
    )
    statused = replace(inputs, current_status=read.statuses)
    candidates = preseason_candidates(
        statused, features, priors or artifacts.preseason, artifacts.laws, artifacts.candidates
    )
    kept, excluded = gate_candidates(candidates, read.statuses, inputs.season)
    return GatedInputs(statused, kept, excluded, read.sweep)


@dataclass(frozen=True, slots=True)
class BuiltBoard:
    board: list[BoardEntry]
    exclusions: list[ExcludedCandidate]
    sweep: RosterSweep | None


def raw_board(conn: Connection, inputs: PreseasonInputs, artifacts: ModelArtifacts) -> BuiltBoard:
    """The raw model board (v1): no market, PPR."""
    built = gated(conn, inputs, artifacts)
    board = preseason_board(built.candidates, PPR_SCORING, BOARD_SHAPE, artifacts.game_variance)
    return BuiltBoard(board, built.exclusions, built.sweep)


def moment_of(inputs: PreseasonInputs) -> datetime:
    return inputs.moment
