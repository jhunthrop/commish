"""THE POPULATION AND THE SPREADSHEET OF PLAN SECTIONS 3 AND 4, per (season, week).

Population (R4 3.1, round 3's): the lined players at a position among ADP's top K and the
season-to-date top K (round 2's `population`). Form: mean points a game this season before W, else
last season's. The spreadsheet: round 4's `points_allowed` and `baseline`; the damped sheet of the
round 5 preregistration beside it.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

import numpy as np
import pandas as pd

from research.explore.scheme_elasticity.inputs import SKILL, SeasonInputs
from research.model.weekly2.statistics import population
from research.model.weekly4.benchmarks import baseline, points_allowed
from research.model.weekly4.play_model import FORMAT_NAMES

POPULATION: Final[Mapping[str, int]] = {"QB": 36, "RB": 72, "WR": 108, "TE": 36}
Points = dict[str, float]


@dataclass(frozen=True, slots=True)
class BaseRow:
    """One population row: the outcome, ADP, form, the two sheets, the club and the opponent."""

    season: int
    week: int
    player_id: str
    position: str
    actual: Points
    adp: float | None
    form: Points | None
    sheet: Points | None
    damped: Points | None
    opponent: str | None


def form_of(this: pd.DataFrame, last: pd.DataFrame, week: int) -> dict[str, Points]:
    """Mean points a game over this season's lined weeks before `week`, else over last season's."""
    now = this[this["week"] < week].groupby("player_id")[list(FORMAT_NAMES)].mean()
    then = last.groupby("player_id")[list(FORMAT_NAMES)].mean()
    found = {str(pid): {n: float(r[n]) for n in FORMAT_NAMES} for pid, r in then.iterrows()}
    found.update({str(pid): {n: float(r[n]) for n in FORMAT_NAMES} for pid, r in now.iterrows()})
    return found


def damped(form: Points | None, allowed: float, game: float) -> Points | None:
    """form x (A x T / T-own)^(1/2)."""
    if form is None:
        return None
    return {n: float(form[n]) * float(np.sqrt(max(allowed * game, 0.0))) for n in FORMAT_NAMES}


def week_rows(inputs: SeasonInputs, last_lines: pd.DataFrame, positions: Mapping[str, str], week: int) -> list[BaseRow]:
    lines = inputs.lines
    lined = {str(k): v for k, v in lines[lines["week"] == week].set_index("player_id").to_dict("index").items()}
    sums = lines[lines["week"] < week].groupby("player_id")["ppr"].sum()
    to_date = {str(pid): float(v) for pid, v in sums.items()}
    form = form_of(lines, last_lines, week)
    allowed = points_allowed(lines, inputs.pairing, positions, week)
    earlier = inputs.teams[inputs.teams["week"] < week]
    own = earlier.groupby("club")["implied_points"].mean().to_dict()
    league = float(earlier["implied_points"].mean()) if not earlier.empty else float("nan")
    now = inputs.teams[inputs.teams["week"] == week]
    this_week = {
        str(c): (str(o), float(i)) for c, o, i in zip(now["club"], now["opponent"], now["implied_points"], strict=True)
    }
    rows: list[BaseRow] = []
    for position in SKILL:
        chosen = population(position, set(lined), inputs.adp, to_date, positions, POPULATION[position])
        for pid in sorted(chosen):
            line = lined[pid]
            club = line["club"] if isinstance(line["club"], str) else None
            spot = this_week.get(club) if club is not None else None
            opponent = spot[0] if spot is not None else None
            a = allowed.get((opponent, position), 1.0) if opponent is not None else 1.0
            t = spot[1] if spot is not None else float("nan")
            own_mean = float(own.get(club, league)) if club is not None else 1.0
            game = t / own_mean if np.isfinite(t) and own_mean > 0 else 1.0
            f = form.get(pid)
            rows.append(
                BaseRow(
                    inputs.season,
                    week,
                    pid,
                    position,
                    {n: float(line[n]) for n in FORMAT_NAMES},
                    inputs.adp.get(pid),
                    f,
                    baseline(f, a, t, own_mean),
                    damped(f, a, game),
                    opponent,
                )
            )
    return rows
