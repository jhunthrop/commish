"""ONE SEASON'S BOARDS, BUILT: the raw model board and (with the market) the blended ones.

Ported from `research-ts/src/projections/preseason/persist.ts` (`buildBoard`, the league shape)
and `market/blend.ts` (`shippedPreseasonBoardInputs`'s raw arm, `gated`).
"""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Final

from sqlalchemy import Connection

from research.model.decide.value import LeagueShape
from research.model.domain import BENCH_SLOT, PPR_SCORING, STANDARD_ROSTER_SLOTS, RosterSlotConfig
from research.model.market.blend import (
    BlendConstants,
    assert_live_market_coverage,
    blend_board,
    blend_context,
    blend_priors,
    parse_blend_constants,
    with_props_anchor,
)
from research.model.market.curve import (
    ADP_SOURCES,
    BOARD_FORMATS,
    DEFAULT_BOARD_FORMAT,
    FORMAT_RULES,
    BoardFormat,
    market_board,
    market_tail_at_exchange_rate,
    parse_market_curve,
)
from research.model.market.props_anchor import props_anchor_for_season
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


@dataclass(frozen=True, slots=True)
class BlendEvidence:
    """What every blended leg of one season shares: the merged constants and the props anchor."""

    constants: BlendConstants
    props_anchor: Mapping[str, float]


def blend_evidence(conn: Connection, inputs: PreseasonInputs, artifacts: ModelArtifacts) -> BlendEvidence:
    """`persistSeason`'s props anchor (read once, against the PPR market) and merged constants."""
    base = parse_blend_constants(artifacts.raw["market/blend-constants"])
    ppr_market, _ = market_board(
        conn, inputs.season, inputs.moment, parse_market_curve(artifacts.raw["market/curve-ppr"]), ADP_SOURCES["ppr"]
    )
    anchor = props_anchor_for_season(
        conn,
        inputs.season,
        inputs.positions,
        {entry.player_id: entry.market_points for entry in ppr_market},
        base.implied_games_by_position,
    )
    return BlendEvidence(with_props_anchor(base, artifacts.raw["market/props-anchor-weight"]), anchor)


def blended_board(
    conn: Connection,
    inputs: PreseasonInputs,
    artifacts: ModelArtifacts,
    board_format: BoardFormat,
    evidence: BlendEvidence,
) -> BuiltBoard:
    """One blended leg (`shippedPreseasonBoardInputs` with a format), valued under that format."""
    curves = {name: parse_market_curve(artifacts.raw[f"market/curve-{name}"]) for name in BOARD_FORMATS}
    constants = evidence.constants
    if board_format != DEFAULT_BOARD_FORMAT:
        constants = replace(
            constants,
            market_tail_by_position=market_tail_at_exchange_rate(
                constants.market_tail_by_position, curves["ppr"], curves[board_format]
            ),
        )
    built = gated(conn, inputs, artifacts, blend_priors(artifacts.preseason, constants))
    market, _ = market_board(conn, inputs.season, inputs.moment, curves[board_format], ADP_SOURCES[board_format])
    assert_live_market_coverage(inputs.season, inputs.moment, inputs.moment_kind, built.candidates, market)
    rules = FORMAT_RULES[board_format]
    context = blend_context(
        artifacts.laws,
        constants,
        evidence.props_anchor,
        rules,
        artifacts.preseason.rookie_curve,
        artifacts.rookie_history.games_rate,
        artifacts.rookie_history.curve_evidence,
    )
    blended = blend_board(market, built.candidates, context, inputs.season)
    return BuiltBoard(
        preseason_board(blended, rules, BOARD_SHAPE, artifacts.game_variance), built.exclusions, built.sweep
    )
