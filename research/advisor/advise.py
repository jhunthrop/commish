"""THE ADVICE FOR ONE ROOM STATE: survival, the shortlist, the why for each, and the tiers.

Ported from `research-ts/src/advisor/advise.ts`. Pure: the same state returns the same advice. The
closed-form survival of every undrafted man to the seat's next turn, the shortlist
(`recommend_pick`), each man's why, and each position's tiers. When the valued board has nothing
legal (the late rounds, only a kicker or defense slot open), the legal market-order players by
where drafters take them, each with zero value and the slot he fills as his reason.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final

from research.advisor.contrast import contrasts
from research.advisor.request import AdviseRequest, PoolEntry
from research.advisor.why import HimFacts, him_sentence, survival_sentence
from research.model.decide.draft import (
    DEFAULT_SHORTLIST,
    DraftCandidate,
    Recommendation,
    RecommendationQuery,
    recommend_pick,
)
from research.model.decide.reasons import FillsStartingSlot, PickReason
from research.model.decide.roster import next_turn, restricted_positions, snake_seat, total_roster_slots
from research.model.decide.roster_view import LeagueRules, RosteredPlayer, RosterView
from research.model.decide.slots import id_key
from research.model.decide.survival import BoardEntry, SurvivalCurve
from research.model.decide.tiers import tiers_of
from research.model.decide.value import LeagueShape, SeasonProjection, ValuedPlayer, value_board
from research.model.domain import Position, RosterSlotType

_BASIS: Final = (
    "Value over replacement for a {teams}-team league on these roster rules, survival from where drafters "
    "take each player and how far they stray from it."
)


class RoomStateError(ValueError):
    """Well-formed JSON whose draft cannot be where it says it is (a 422)."""


@dataclass(frozen=True, slots=True)
class AdvisedCandidate:
    recommendation: Recommendation
    why: str
    # The row's why as its contrast to the call (`contrast.py`), None for the call itself.
    contrast: str | None = None


@dataclass(frozen=True, slots=True)
class PositionTier:
    tier: int
    player_ids: tuple[str, ...]
    drop_to_next_tier: float


@dataclass(frozen=True, slots=True)
class Advice:
    pick_number: int
    next_pick_number: int | None
    shortlist: tuple[AdvisedCandidate, ...]
    survival: dict[str, float]
    tiers: dict[Position, tuple[PositionTier, ...]]
    basis: str


def _market_order_fallback(
    undrafted: Sequence[PoolEntry], view: RosterView, survival: dict[str, float], shortlist_size: int
) -> list[Recommendation]:
    """The legal market-order men by ADP (ties by id), zero value, the slot each fills as his reason."""
    legal = [
        (entry, slot)
        for entry in undrafted
        if entry.projected_points is None and (slot := view.landing_slot(entry.position)) is not None
    ]
    legal.sort(key=lambda row: (row[0].adp, id_key(row[0].id)))
    return [
        Recommendation(entry.id, entry.position, 0.0, 0.0, 0.0, survival.get(entry.id, 0.0), (FillsStartingSlot(slot),))
        for entry, slot in legal[:shortlist_size]
    ]


def _market_order_rank(player_id: str, position: Position, undrafted: Sequence[PoolEntry]) -> int:
    at_position = sorted((e for e in undrafted if e.position == position), key=lambda e: (e.adp, id_key(e.id)))
    return next((index + 1 for index, entry in enumerate(at_position) if entry.id == player_id), 0)


def _fills_slot(reasons: Sequence[PickReason], view: RosterView, position: Position) -> RosterSlotType | None:
    fills = next((reason for reason in reasons if isinstance(reason, FillsStartingSlot)), None)
    return fills.slot if fills is not None else view.landing_slot(position)


def _position_tiers(players: Sequence[ValuedPlayer]) -> tuple[PositionTier, ...]:
    ordered = sorted(players, key=lambda p: (-p.projected_points, id_key(p.player_id)))
    points = [player.projected_points for player in ordered]
    tier_at = tiers_of(points)
    out: list[PositionTier] = []
    for tier in dict.fromkeys(tier_at):
        first = tier_at.index(tier)
        last = len(tier_at) - 1 - tier_at[::-1].index(tier)
        drop = 0.0 if last + 1 >= len(ordered) else points[last] - points[last + 1]
        out.append(PositionTier(tier, tuple(p.player_id for p in ordered[first : last + 1]), drop))
    return tuple(out)


def _tiers_by_position(
    board: Sequence[DraftCandidate], valued: dict[str, ValuedPlayer]
) -> dict[Position, tuple[PositionTier, ...]]:
    positions = list(dict.fromkeys(candidate.position for candidate in board))
    players = [valued[candidate.player_id] for candidate in board]
    return {position: _position_tiers([p for p in players if p.position == position]) for position in positions}


def _turn(request: AdviseRequest, total_picks: int) -> tuple[int, int | None]:
    pick_number = len(request.picks) + 1
    if pick_number > total_picks:
        raise RoomStateError(f"the draft is over: {len(request.picks)} picks of {total_picks} are in.")
    on_clock = snake_seat(request.team_count, pick_number)
    if on_clock != request.seat_on_clock:
        raise RoomStateError(
            f"pick {pick_number} belongs to seat {on_clock} in a snake draft, not seat {request.seat_on_clock}."
        )
    return pick_number, next_turn(request.team_count, request.seat_on_clock, pick_number, total_picks)


def advise(request: AdviseRequest, curve: SurvivalCurve) -> Advice:
    """`advise`: the whole card for the seat on the clock."""
    slots = request.slot_configs()
    shape = LeagueShape(request.team_count, slots)
    pick_number, next_pick = _turn(request, request.team_count * total_roster_slots(slots))
    projections = [
        SeasonProjection(e.id, e.position, e.projected_points) for e in request.pool if e.projected_points is not None
    ]
    valued = {player.player_id: player for player in value_board(projections, shape)}
    drafted = {pick.player_id for pick in request.picks}
    by_id = {entry.id: entry for entry in request.pool}
    undrafted = [entry for entry in request.pool if entry.id not in drafted]
    roster = [
        RosteredPlayer(pick.player_id, by_id[pick.player_id].position, _vor(valued, pick.player_id))
        for pick in request.picks
        if pick.seat == request.seat_on_clock
    ]
    if next_pick is None:
        survival = {entry.id: 0.0 for entry in undrafted}
    else:
        entries = [BoardEntry(entry.id, entry.position, entry.adp) for entry in undrafted]
        survival = curve.probabilities(entries, pick_number, next_pick)
    board = [_candidate(valued[e.id], e.adp) for e in undrafted if e.id in valued]
    size = request.shortlist_size if request.shortlist_size is not None else DEFAULT_SHORTLIST
    query = RecommendationQuery(board, roster, shape, pick_number, next_pick, size)
    view = RosterView(roster, LeagueRules(slots, query.ceilings))
    recommendations = recommend_pick(query, curve) or _market_order_fallback(undrafted, view, survival, size)
    if not recommendations:
        raise RoomStateError(
            f"no player left in the pool can fill seat {request.seat_on_clock}'s open slots at pick {pick_number}; "
            "the pool is missing a position the roster rules start."
        )
    card = _Card(valued, undrafted, view, restricted_positions(slots, view.filled), pick_number, next_pick)
    against = contrasts(recommendations, pick_number, next_pick is not None)
    shortlist = tuple(
        replace(card.advised(recommendation), contrast=contrast)
        for recommendation, contrast in zip(recommendations, against, strict=True)
    )
    return Advice(
        pick_number,
        next_pick,
        shortlist,
        survival,
        _tiers_by_position(board, valued),
        _BASIS.format(teams=request.team_count),
    )


def _vor(valued: dict[str, ValuedPlayer], player_id: str) -> float:
    """A market-order man on the roster sits at replacement by construction (the kdef decision)."""
    player = valued.get(player_id)
    return 0.0 if player is None else player.value_over_replacement


def _candidate(player: ValuedPlayer, adp: float) -> DraftCandidate:
    return DraftCandidate(
        player.player_id,
        player.position,
        player.projected_points,
        player.value_over_replacement,
        player.position_rank,
        player.replacement_level,
        adp,
    )


@dataclass(frozen=True, slots=True)
class _Card:
    """What every why on one card reads beside its own recommendation."""

    valued: dict[str, ValuedPlayer]
    undrafted: Sequence[PoolEntry]
    view: RosterView
    must_pick: Sequence[Position] | None
    pick_number: int
    next_pick: int | None

    def advised(self, recommendation: Recommendation) -> AdvisedCandidate:
        player = self.valued.get(recommendation.player_id)
        rank = (
            player.position_rank
            if player is not None
            else _market_order_rank(recommendation.player_id, recommendation.position, self.undrafted)
        )
        facts = HimFacts(
            recommendation.position,
            rank,
            _fills_slot(recommendation.reasons, self.view, recommendation.position),
            recommendation.reasons,
            self.must_pick,
        )
        him = him_sentence(facts, self.pick_number)
        room = survival_sentence(self.pick_number, self.next_pick, recommendation.survival_probability)
        return AdvisedCandidate(recommendation, f"{him.text} {room}")
