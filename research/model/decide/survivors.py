"""THE VALUE OF THE BEST MAN STILL THERE AT YOUR NEXT TURN (`expectedBestSurvivor`), valuing only
the men the expectation reaches.

The oracle values every survivor against the roster with the candidate taken, sorts them by value
(a stable sort, so equal values keep board order), and walks the sorted list adding
`value * survival * nobodyBetterSurvived`, stopping once `nobodyBetterSurvived` falls under 1e-9.

THE SAME SUM, FROM FEWER FITS. A man's value is his marginal lineup value plus insurance, and
neither part can exceed his own surplus over replacement (adding one man to a lineup raises its
best total by at most his score, on a laminar slot family where the narrowest-first fill is the
best lineup; the cover is the same bound on a smaller roster). So `1.08 * surplus`, padded for the
float sums, bounds his value from above. Men are valued in order of that bound; once every man left
is bounded below a value already in hand, the men above it are in their final order and the walk
can take them. A man with no surplus is worth exactly zero (`marginal.py`), so he is never valued.
The walk adds the oracle's terms in the oracle's order and stops where it stops, so the sum is the
same to the bit, whatever is skipped. A slot family that is not laminar values everyone.
"""

from collections.abc import Sequence
from typing import Final, Protocol

from research.model.decide.roster import RosterCeilingPolicy
from research.model.decide.roster_view import BENCH_INSURANCE_SHARE, RosterView, surplus
from research.model.domain import Position

_NOBODY_BETTER_FLOOR: Final = 1e-9
# Padding on the bound for the rounding of two lineup folds of a few hundred points each.
_BOUND_PADDING: Final = 1e-6
_FIRST_BATCH: Final = 16


class Candidate(Protocol):
    @property
    def player_id(self) -> str: ...

    @property
    def position(self) -> Position: ...

    @property
    def value_over_replacement(self) -> float: ...


def is_laminar(view: RosterView) -> bool:
    """Every two starting spots' eligibility sets are nested or disjoint."""
    sets = [frozenset(spot.eligible_positions) for spot in view.rules.spots]
    return all(a <= b or b <= a or not (a & b) for a in sets for b in sets)


def _walk(ordered: Sequence[tuple[float, int]], survival: Sequence[float], state: list[float]) -> bool:
    """Adds the terms for `ordered` (value, board index) to `state` = [expected, nobodyBetter];
    True once the walk has stopped."""
    expected, nobody_better = state
    for value, index in ordered:
        if nobody_better < _NOBODY_BETTER_FLOOR:
            state[0], state[1] = expected, nobody_better
            return True
        chance = survival[index]
        expected += value * chance * nobody_better
        nobody_better *= 1 - chance
    state[0], state[1] = expected, nobody_better
    return False


def expected_best_survivor(
    board: Sequence[Candidate],
    candidate_id: str,
    after: RosterView,
    survival_by_id: dict[str, float],
    ceilings: RosterCeilingPolicy,
) -> float:
    """`expectedBestSurvivor` over `board` without the candidate, valued against `after`."""
    del ceilings  # carried by `after.rules`; the parameter keeps the oracle's call shape readable
    indices = [index for index, entry in enumerate(board) if entry.player_id != candidate_id]
    survival = [survival_by_id.get(entry.player_id, 0.0) for entry in board]
    scores = {index: surplus(board[index].value_over_replacement) for index in indices}
    positive = sorted((index for index in indices if scores[index] > 0), key=lambda index: -scores[index])
    zeros = [index for index in indices if scores[index] == 0]
    if not is_laminar(after):
        positive_values = [(_value(board[index], after), index) for index in positive]
        state = [0.0, 1.0]
        _walk(sorted(positive_values + [(0.0, index) for index in zeros], key=_order), survival, state)
        return state[0]

    def bound(index: int) -> float:
        return (1 + BENCH_INSURANCE_SHARE) * scores[index] + _BOUND_PADDING

    state = [0.0, 1.0]
    pending: list[tuple[float, int]] = []
    valued = 0
    batch = _FIRST_BATCH
    while valued < len(positive):
        for index in positive[valued : valued + batch]:
            pending.append((_value(board[index], after), index))
        valued = min(len(positive), valued + batch)
        batch *= 2
        if valued == len(positive):
            break
        threshold = bound(positive[valued])
        ready = sorted((row for row in pending if row[0] > threshold), key=_order)
        pending = [row for row in pending if row[0] <= threshold]
        if _walk(ready, survival, state):
            return state[0]
    _walk(sorted(pending + [(0.0, index) for index in zeros], key=_order), survival, state)
    return state[0]


def _order(row: tuple[float, int]) -> tuple[float, int]:
    """Best value first; equal values in board order (the oracle's stable sort)."""
    return (-row[0], row[1])


def _value(entry: Candidate, after: RosterView) -> float:
    return after.fit_for(entry.player_id, entry.position, entry.value_over_replacement).value
