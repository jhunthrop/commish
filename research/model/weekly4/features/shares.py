"""A PLAYER'S SHARES OF HIS CLUB'S VOLUME, from his games before W (round 4 preregistration, 2.2).

A game is one of his line-weeks (round 3's club edge) with his opportunities and his club's totals in
it, from the play table. A share over a span of games is the ratio of his summed opportunities of the
kind to his club's (the team-volume-weighted mean of his game shares, the weighting the share models'
loss uses, section 2.6); a span in which the club had none of the kind is a share of 0. The decayed
share weights each game by decay^(age in his games), age 0 his latest, as section 2.3's n does. The
grid of decays is section 2.6's, and 1.0 is no decay.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from research.model.weekly3.work import PlayerGame
from research.model.weekly4.features.plays import ZERO_COUNTS, Counts, Tallies

DECAYS: Final = (0.5, 0.7, 0.85, 1.0)
LAST_GAMES: Final = 3


@dataclass(frozen=True, slots=True)
class GameShare:
    """One of his games: the week, the club, his opportunities, the club's, and his snap share."""

    week: int
    club: str
    own: Counts
    team: Counts
    snap_share: float


def history(player_id: str, games: Sequence[PlayerGame], tallies: Tallies) -> tuple[GameShare, ...]:
    """His games before W (his club edges, in week order) with the plays admitted at the instant."""
    found: list[GameShare] = []
    for game in games:
        tally = tallies.players.get((player_id, game.week))
        own = tally.counts if tally is not None and tally.club == game.club else ZERO_COUNTS
        found.append(
            GameShare(
                game.week, game.club, own, tallies.clubs.get((game.club, game.week), ZERO_COUNTS), game.work.snap_share
            )
        )
    return tuple(found)


def weighted_share(games: Sequence[GameShare], kind: str, weights: Sequence[float]) -> float:
    """sum(w x his) / sum(w x club's) over the games; NaN with no game, 0 when the club had none."""
    if not games:
        return math.nan
    team = sum(w * g.team.of(kind) for w, g in zip(weights, games, strict=True))
    if team <= 0:
        return 0.0
    return sum(w * g.own.of(kind) for w, g in zip(weights, games, strict=True)) / team


def season_share(games: Sequence[GameShare], kind: str) -> float:
    return weighted_share(games, kind, [1.0] * len(games))


def last_three_share(games: Sequence[GameShare], kind: str) -> float:
    return season_share(games[-LAST_GAMES:], kind)


def decayed_share(games: Sequence[GameShare], kind: str, decay: float) -> float:
    size = len(games)
    return weighted_share(games, kind, [decay ** (size - 1 - i) for i in range(size)])


def share_vector(games: Sequence[GameShare]) -> Counts:
    """His share of every kind over the games (0 for each with no game)."""
    if not games:
        return ZERO_COUNTS
    return Counts(*(season_share(games, kind) for kind in Counts.__dataclass_fields__))


def mean_share_vector(games: Sequence[GameShare]) -> Counts:
    """The mean of his per-game shares of every kind (a game the club had none of a kind is a share
    of 0); the pre-absence share alone is read this way (2.2, amendment 2 item 9)."""
    if not games:
        return ZERO_COUNTS
    per_game = [share_vector([g]) for g in games]
    return Counts(*(sum(c.of(kind) for c in per_game) / len(per_game) for kind in Counts.__dataclass_fields__))


def snap_mean(games: Sequence[GameShare]) -> float:
    return sum(g.snap_share for g in games) / len(games) if games else math.nan


def prior_shares(
    prior_games: Mapping[str, Sequence[PlayerGame]], prior_tallies: Tallies
) -> dict[str, tuple[GameShare, ...]]:
    """Each player's games of the season before, with that season's plays."""
    return {pid: history(pid, games, prior_tallies) for pid, games in prior_games.items()}
