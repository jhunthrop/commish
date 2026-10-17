"""THE BENCHMARKS OF 3.1 BESIDE ROUND 3'S (ADP, the rounds' recent form and round 3's number come from
round 3's own read and fit).

- **Recent form, last three**: mean points over his last three games played before W (the brief's
  wording), a game played being a week-W line; fewer than three, the mean of those he has; none, no
  opinion.
- **The expert's three-fact spreadsheet**: form x A x (T / T-own), no fitted number. Form is the
  rounds' recent form. A is the opponent's PPR points allowed to the position per game in its games of
  weeks before W, over the league mean of PPR points allowed to the position per team-game over the
  same weeks, shrunk toward 1 with 6 games of prior (the store's constant). T is the club's implied
  points at t_g; T-own the club's own mean implied points over its games of weeks before W in the same
  season (the league mean when it has none).

Lines are read through round 3's outcome reader; only weeks before W enter either benchmark.
"""

from collections.abc import Mapping
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly3.allowance import ALLOWANCE_PRIOR_GAMES
from research.model.weekly4.play_model import FORMAT_NAMES

LAST_GAMES: Final = 3
Points = Mapping[str, float]


def last_three(lines: pd.DataFrame, week: int) -> dict[str, dict[str, float]]:
    """Each player's mean points over his last three games played before `week`."""
    before = lines[lines["week"] < week].sort_values(["player_id", "week"])
    latest = before.groupby("player_id").tail(LAST_GAMES)
    means = latest.groupby("player_id")[list(FORMAT_NAMES)].mean()
    return {str(pid): {name: float(row[name]) for name in FORMAT_NAMES} for pid, row in means.iterrows()}


def points_allowed(
    lines: pd.DataFrame, pairing: pd.DataFrame, positions: Mapping[str, str], week: int
) -> dict[tuple[str, str], float]:
    """A per (defence, position): its PPR points allowed per game against the league mean per
    team-game, over weeks before `week`, shrunk toward 1 with 6 games."""
    games = pairing[pairing["week"] < week][["week", "club", "opponent"]]
    scored = lines[lines["week"] < week].assign(position=lines["player_id"].map(positions))
    by_offence = scored.groupby(["week", "club", "position"])["ppr"].sum()
    found: dict[tuple[str, str], float] = {}
    for position in sorted({str(p) for p in positions.values()}):
        offence = np.array(
            [float(by_offence.get((w, c, position), 0.0)) for w, c in zip(games["week"], games["club"], strict=True)]
        )
        if len(offence) == 0:
            continue
        league = float(np.mean(offence))
        allowed = pd.DataFrame({"defence": games["opponent"].to_numpy(), "points": offence})
        for defence, group in allowed.groupby("defence"):
            n = len(group)
            ratio = float(group["points"].mean()) / league if league > 0 else 1.0
            found[(str(defence), position)] = (n * ratio + ALLOWANCE_PRIOR_GAMES) / (n + ALLOWANCE_PRIOR_GAMES)
    return found


def baseline(form: Points | None, allowed: float, implied: float, own_mean: float) -> dict[str, float] | None:
    """form x A x (T / T-own) in each format; no opinion without form."""
    if form is None:
        return None
    game = implied / own_mean if np.isfinite(implied) and own_mean > 0 else 1.0
    return {name: float(form[name]) * allowed * game for name in FORMAT_NAMES}
