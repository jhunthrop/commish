"""ONE ROSTER'S BEST LINEUP, AND THAT LINEUP WITH ONE MORE MAN, EXACTLY AND QUICKLY.

`recommendPick` asks `bestStartingTotal(roster + [him], ...)` for every man on the board, once per
roster it weighs: thousands of lineup solves a call. The oracle solves each from nothing. This
module answers the same number, to the bit, from a solve it keeps.

THE ARGUMENT. The lineup is filled spot by spot (`slots.assign_starters`), each spot taking the
best eligible man left by score and then by id. Adding one man with score `s` changes only the
comparisons that involve him, and those depend only on where `s` falls among the scores already on
the roster. So every `s` strictly between two neighbouring roster scores runs the identical fill:
the same man in every spot, the newcomer in the same spot. The fill is computed once per position
and such interval, recorded as the fold the oracle performs (the sum of the spots before his, then
his score, then each spot after his in order), and replayed with his own `s`: the same IEEE 754
additions, in the same order, as the oracle's `reduce`.

Two cases skip the record:
- `s` equal to a roster score: the tie is broken by id, so it is solved in full, as the oracle does;
- `s` of zero (every man at or below replacement): he can displace only another zero, and adding a
  zero to the fold is the identity, so the total is the roster's own, exactly.
"""

import bisect
from collections.abc import Sequence
from dataclasses import dataclass

from research.model.decide.slots import StartingSpot, best_in_spot
from research.model.domain import Position


@dataclass(frozen=True, slots=True)
class Scored:
    """A man as the lineup reads him: his id, his position and his score (surplus over replacement)."""

    player_id: str
    position: Position
    score: float


def _score(player: Scored) -> float:
    return player.score


def _fill(spots: Sequence[StartingSpot], players: Sequence[Scored]) -> list[Scored | None]:
    taken: set[str] = set()
    chosen: list[Scored | None] = []
    for spot in spots:
        best = best_in_spot(spot, players, taken, _score)
        if best is not None:
            taken.add(best.player_id)
        chosen.append(best)
    return chosen


def _fold(chosen: Sequence[Scored | None]) -> float:
    total = 0.0
    for player in chosen:
        total = total + (0 if player is None else player.score)
    return total


@dataclass(frozen=True, slots=True)
class _Replay:
    """One interval's fill: the fold before his spot and the scores after it, or None (he sits)."""

    before: float
    after: tuple[float, ...]
    starts: bool
    total_without_him: float

    def total(self, score: float) -> float:
        if not self.starts:
            return self.total_without_him
        total = self.before + score
        for value in self.after:
            total = total + value
        return total


class LineupBase:
    """A roster's best lineup total, and the total with any one man added (`with_one`)."""

    def __init__(self, spots: Sequence[StartingSpot], players: Sequence[Scored]) -> None:
        self._spots = tuple(spots)
        self._players = tuple(players)
        self.total = _fold(_fill(self._spots, self._players))
        positive = {player.score for player in self._players if player.score > 0}
        self._scores = sorted(positive)
        self._score_set = frozenset(positive)
        self._replays: dict[tuple[Position, int], _Replay] = {}

    def _solve(self, newcomer: Scored) -> list[Scored | None]:
        return _fill(self._spots, (*self._players, newcomer))

    def _replay_for(self, newcomer: Scored, interval: int) -> _Replay:
        key = (newcomer.position, interval)
        known = self._replays.get(key)
        if known is not None:
            return known
        chosen = self._solve(newcomer)
        spot = next((index for index, player in enumerate(chosen) if player is newcomer), None)
        if spot is None:
            replay = _Replay(0.0, (), False, _fold(chosen))
        else:
            before = _fold(chosen[:spot])
            after = tuple(0.0 if player is None else player.score for player in chosen[spot + 1 :])
            replay = _Replay(before, after, True, 0.0)
        self._replays[key] = replay
        return replay

    def with_one(self, newcomer: Scored) -> float:
        """`bestStartingTotal([...roster, newcomer])`, bit for bit."""
        score = newcomer.score
        if score == 0:
            return self.total
        if score < 0 or score in self._score_set:
            return _fold(self._solve(newcomer))
        return self._replay_for(newcomer, bisect.bisect_left(self._scores, score)).total(score)
