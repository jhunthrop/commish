"""THE WHY (design 5.7; Amendment 7 item 4): exact Shapley values of the analytic point over four factor
groups and their 16 coalitions.

(1) `game`: the game's expected points and margin (the opponent's for a defense, the club's for a kicker);
(2) `matchup`: the opponent's sacks allowed and giveaway rates against the defense's own, the kicker's
accuracy over expected and his club's habits (every shrunk rate of the row, and the team model's tempo
and pressure terms); (3) `weather`: weather and roof (and the venue's altitude and surface); (4)
`home_rest`: home field and rest.

Neutral values are round 4's (`weekly4.groups.neutralise`, section 2.7): the league's mean implied points
and a margin of 0, every rate at its prior, indoor weather, a week of rest, and home field averaged (the
point at home 0 and at home 1, averaged). v(S) is the point with the groups of S at their actual values
and the others neutral; the values sum to the point less the neutral point.
"""

from collections.abc import Callable, Iterator, Mapping, Sequence
from itertools import combinations
from math import factorial
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.groups import neutralise
from research.model.weekly_kdef.features import GAME_RATES, LeaguePriors

GROUPS: Final = ("game", "matchup", "weather", "home_rest")
# The play terms' neutral values: the fit rows' means (yards per play: the league's of the row).
PLAY_MEANS: Final = ("passer_int_rate", "fourth_down_go_rate")
Points = tuple[np.ndarray, np.ndarray]  # (defense, kicker) per row
PointFunction = Callable[[pd.DataFrame], Points]


def subsets(items: Sequence[str]) -> Iterator[frozenset[str]]:
    for size in range(len(items) + 1):
        for chosen in combinations(items, size):
            yield frozenset(chosen)


def _matchup(frame: pd.DataFrame, priors: LeaguePriors, means: Mapping[str, float]) -> pd.DataFrame:
    rates = {name: priors.games[name].mean if kind != "zero" else 0.0 for name, _, _, _, kind in GAME_RATES}
    t = priors.trials
    trials = {
        "off_fg_share": t["fg_share"].rate,
        "def_fg_share_allowed": t["fg_share"].rate,
        "off_two_point_rate": t["two_point_rate"].rate,
        "kicker_accuracy_over_expected": 0.0,
        "kicker_long_share": t["kicker_long_share"].rate,
        "kicker_xp_rate": t["kicker_xp_rate"].rate,
        **{name: means.get(name, float("nan")) for name in PLAY_MEANS},
    }
    found = frame.assign(**{k: v for k, v in {**rates, **trials}.items() if k in frame})
    if "league_yards_per_play" in found:
        found = found.assign(
            off_yards_per_play=found["league_yards_per_play"], def_yards_per_play_allowed=found["league_yards_per_play"]
        )
    return found


def neutral_frame(
    frame: pd.DataFrame, groups: frozenset[str], means: Mapping[str, float], priors: LeaguePriors, home: float | None
) -> pd.DataFrame:
    """The rows with each named group neutral (a new frame)."""
    found = neutralise(frame, groups, means, home)
    if "matchup" in groups:
        found = _matchup(found, priors, means)
    if "weather" in groups:
        found = found.assign(denver=0.0, grass=0.0)
    return found


def coalition_points(
    frame: pd.DataFrame, point: PointFunction, means: Mapping[str, float], priors: LeaguePriors
) -> dict[frozenset[str], Points]:
    """v(S) for every coalition S of present groups."""
    found: dict[frozenset[str], Points] = {}
    for neutral in subsets(GROUPS):
        homes = (0.0, 1.0) if "home_rest" in neutral else (None,)
        values = [point(neutral_frame(frame, neutral, means, priors, h)) for h in homes]
        found[frozenset(GROUPS) - neutral] = (
            np.mean([v[0] for v in values], axis=0),
            np.mean([v[1] for v in values], axis=0),
        )
    return found


def shapley(values: Mapping[frozenset[str], Points]) -> dict[str, Points]:
    """Each group's exact Shapley value per row, for each position."""
    n = len(GROUPS)
    found: dict[str, Points] = {}
    for g in GROUPS:
        others = [x for x in GROUPS if x != g]
        totals = [np.zeros_like(values[frozenset()][0]), np.zeros_like(values[frozenset()][1])]
        for coalition in subsets(others):
            weight = factorial(len(coalition)) * factorial(n - len(coalition) - 1) / factorial(n)
            for p in (0, 1):
                totals[p] = totals[p] + weight * (values[coalition | {g}][p] - values[coalition][p])
        found[g] = (totals[0], totals[1])
    return found
