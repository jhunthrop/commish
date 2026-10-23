"""THE TAKEAWAY RATES PER DROPBACK AND PER PLAY (design 5.2, the interceptions and fumble recoveries rows).

- The defense's interceptions per dropback faced: its interceptions over the dropbacks it faced, from the
  plays (this season before W and the season before), shrunk toward the league's rate with a heavy prior of
  two seasons of dropbacks (the league's dropbacks a club-game, times two seasons of games), since
  persistence is weak.
- The defense's fumble recoveries per play faced: its recoveries of each game (the team-defense weeks) over
  the scrimmage plays it faced in that game (the plays), over the games with both, toward the league's rate
  with two seasons of plays.
- The offense's fumbles lost per play: the recoveries its opponents made of each game over the scrimmage
  plays it ran, beta-binomial toward the league's, its tau^2 by the method of moments over the clubs.

The opposing passer's own interceptions per dropback stand beside these (`scrimmage.py`).
"""

from collections import defaultdict
from dataclasses import dataclass
from typing import Final

from research.model.weekly_kdef.rates import (
    SEASON_GAMES,
    TAKEAWAY_SEASONS,
    TrialPrior,
    fixed_trial_rate,
    shrunk_rate,
    trials_prior,
)
from research.model.weekly_kdef.scrimmage import PlayTally
from research.model.weekly_kdef.tallies import Tally

PLAYS: Final = 0
DROPBACKS: Final = 1
INTERCEPTIONS: Final = 2


@dataclass(frozen=True, slots=True)
class ExposureView:
    """One instant's per-club takeaway terms."""

    intercepted: dict[str, list[float]]  # defense -> [interceptions, dropbacks faced]
    recovered: dict[str, list[float]]  # defense -> [recoveries, plays faced] over games with both
    lost: dict[str, list[float]]  # offense -> [fumbles lost, plays run] over games with both
    int_rate: float
    fr_rate: float
    dropback_weight: float
    play_weight: float
    fumbles: TrialPrior

    def of(self, offense: str, defense: str) -> dict[str, float]:
        ints, dropbacks = self.intercepted.get(defense, [0.0, 0.0])
        fr, faced = self.recovered.get(defense, [0.0, 0.0])
        lost, run = self.lost.get(offense, [0.0, 0.0])
        return {
            "def_int_per_dropback": fixed_trial_rate(ints, dropbacks, self.int_rate, self.dropback_weight),
            "def_fr_per_play": fixed_trial_rate(fr, faced, self.fr_rate, self.play_weight),
            "off_fumbles_lost_per_play": shrunk_rate(lost, run, self.fumbles.rate, self.fumbles),
            "league_int_per_dropback": self.int_rate,
            "league_fr_per_play": self.fr_rate,
            "league_fumbles_per_play": self.fumbles.rate,
        }


def _rate(found: dict[str, list[float]]) -> float:
    total = sum(v[1] for v in found.values())
    return sum(v[0] for v in found.values()) / total if total > 0 else 0.0


def exposure_view(tally: Tally, plays: PlayTally) -> ExposureView:
    intercepted: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    recovered: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    lost: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for (offense, defense, season, week), snap in plays.snaps.items():
        intercepted[defense][0] += snap[INTERCEPTIONS]
        intercepted[defense][1] += snap[DROPBACKS]
        d = tally.defense.get(defense)
        fr = None if d is None else d.by_game.get((season, week), {}).get("fr")
        if fr is not None:
            recovered[defense][0] += fr
            recovered[defense][1] += snap[PLAYS]
        o = tally.offense.get(offense)
        fumbles = None if o is None else o.by_game.get((season, week), {}).get("fumbles_lost")
        if fumbles is not None:
            lost[offense][0] += fumbles
            lost[offense][1] += snap[PLAYS]
    games = len(plays.snaps)
    per_game_dropbacks = sum(s[DROPBACKS] for s in plays.snaps.values()) / games if games else 0.0
    per_game_plays = sum(s[PLAYS] for s in plays.snaps.values()) / games if games else 0.0
    seasons = TAKEAWAY_SEASONS * SEASON_GAMES
    return ExposureView(
        dict(intercepted),
        dict(recovered),
        dict(lost),
        _rate(dict(intercepted)),
        _rate(dict(recovered)),
        seasons * per_game_dropbacks,
        seasons * per_game_plays,
        trials_prior([v[0] for v in lost.values()], [v[1] for v in lost.values()]),
    )
