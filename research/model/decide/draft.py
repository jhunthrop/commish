"""THE RECOMMENDATION: value now plus the best man expected to survive to your next turn.

Ported from `research-ts/src/projections/decide/draft.ts` (`recommendPick`, `landingSlot`,
`rosterSlotsOf`). The score is an expected value over two turns: take him now (his MARGINAL value
to the lineup this roster can field, plus a little insurance for a bench body), then the best man
who survives to the next pick. A candidate who would push his position past its ceiling, or a
backup asked for while a starter is still open, is held back exactly as the oracle holds him.

THE SAME NUMBERS, FASTER (the oracle's 62 ms p90 was this function):
- every lineup total is answered by `marginal.LineupBase`, bit for bit, from one solve per roster;
- the best-survivor expectation needs only the men it actually reaches: the oracle sorts every
  survivor by value and stops once the chance that nobody better survived is under 1e-9.
  `survivors.expected_best_survivor` values men best-first by an upper bound and stops at the same
  place, so it adds the same terms in the same order (see that module for the proof).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from research.model.decide.reasons import PickReason, PositionPools, Turn, reasons_for
from research.model.decide.roster import AUTOPICK_ROSTER_CEILINGS, RosterCeilingPolicy
from research.model.decide.roster_view import Fit, LeagueRules, RosteredPlayer, RosterView
from research.model.decide.slots import id_key
from research.model.decide.survival import BoardEntry, SurvivalCurve
from research.model.decide.survivors import expected_best_survivor
from research.model.decide.value import LeagueShape
from research.model.domain import Position
from research.pipeline.jscompat import CollationKey

DEFAULT_SHORTLIST: Final = 5


@dataclass(frozen=True, slots=True)
class DraftCandidate:
    """`DraftCandidate`: a valued board entry and where drafters take him."""

    player_id: str
    position: Position
    projected_points: float
    value_over_replacement: float
    position_rank: int
    replacement_level: float
    average_draft_position: float


@dataclass(frozen=True, slots=True)
class Recommendation:
    player_id: str
    position: Position
    expected_value_added: float
    value_over_replacement: float
    roster_adjusted_value: float
    survival_probability: float
    reasons: tuple[PickReason, ...]


@dataclass(frozen=True, slots=True)
class RecommendationQuery:
    board: Sequence[DraftCandidate]
    roster: Sequence[RosteredPlayer]
    shape: LeagueShape
    pick_number: int
    next_pick_number: int | None
    shortlist_size: int = DEFAULT_SHORTLIST
    ceilings: RosterCeilingPolicy = AUTOPICK_ROSTER_CEILINGS


@dataclass(frozen=True, slots=True)
class _Considered:
    candidate: DraftCandidate
    fit: Fit


def _rank_key(entry: _Considered) -> tuple[float, float, float, CollationKey]:
    """`b.fit.value - a.fit.value || b.vor - a.vor || a.adp - b.adp || a.id.localeCompare(b.id)`:
    ties defer to the market, never to the player id, unless the market ties too."""
    candidate = entry.candidate
    return (
        -entry.fit.value,
        -candidate.value_over_replacement,
        candidate.average_draft_position,
        id_key(candidate.player_id),
    )


def _survival(query: RecommendationQuery, curve: SurvivalCurve) -> dict[str, float]:
    if query.next_pick_number is None:
        return {}
    board = [BoardEntry(c.player_id, c.position, c.average_draft_position) for c in query.board]
    return curve.probabilities(board, query.pick_number, query.next_pick_number)


def _score(
    query: RecommendationQuery,
    view: RosterView,
    pools: PositionPools,
    considered: _Considered,
    survival: dict[str, float],
) -> tuple[Recommendation, int, float]:
    candidate, fit = considered.candidate, considered.fit
    survives = survival.get(candidate.player_id, 0.0)
    expected = fit.value
    if query.next_pick_number is not None:
        after = view.with_player(
            RosteredPlayer(candidate.player_id, candidate.position, candidate.value_over_replacement)
        )
        expected += expected_best_survivor(query.board, candidate.player_id, after, survival, query.ceilings)
    recommendation = Recommendation(
        candidate.player_id,
        candidate.position,
        expected,
        candidate.value_over_replacement,
        fit.value,
        survives,
        reasons_for(candidate, fit, survives, Turn(query.pick_number, query.next_pick_number), pools),
    )
    return recommendation, fit.already_benched, candidate.average_draft_position


def recommend_pick(query: RecommendationQuery, curve: SurvivalCurve) -> list[Recommendation]:
    """`recommendPick`: a ranked shortlist for one turn, each entry carrying its reasons."""
    if query.pick_number < 1:
        raise ValueError(f"A recommendation is made at a whole pick number; got {query.pick_number}.")
    survival = _survival(query, curve)
    view = RosterView(query.roster, LeagueRules(tuple(query.shape.roster_slots), query.ceilings))
    pools = PositionPools(query.board)
    placeable = [
        _Considered(candidate, fit)
        for candidate in query.board
        if (fit := view.fit_for(candidate.player_id, candidate.position, candidate.value_over_replacement)).slot
        is not None
    ]
    waits_not = [entry for entry in placeable if not entry.fit.waits_for_starters]
    eligible = waits_not if waits_not else placeable
    considered = sorted(eligible, key=_rank_key)[: max(query.shortlist_size * 3, DEFAULT_SHORTLIST * 3)]
    scored = [_score(query, view, pools, entry, survival) for entry in considered]
    scored.sort(key=lambda row: (-row[0].expected_value_added, row[1], row[2], id_key(row[0].player_id)))
    return [row[0] for row in scored[: query.shortlist_size]]
