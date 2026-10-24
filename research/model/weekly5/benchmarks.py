"""THE BENCHMARKS BESIDE ROUND 3'S (preregistration 3.1): last-three form and the two spreadsheets.

ADP, the rounds' recent form and round 3's number come from round 3's own read and fit. Last-three form
and the preregistered spreadsheet, form x A x (T / T-own), are round 4's functions term for term
(`weekly4.benchmarks`); the damped spreadsheet is form x (A x T / T-own)^(1/2) on the same A, T and T-own
(D:86). A row placed on no club reads A and T / T-own at 1 for both sheets, counted.
"""

from collections.abc import Mapping, Sequence
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly2.statistics import JudgedRow
from research.model.weekly4.benchmarks import Points, baseline, last_three, points_allowed
from research.model.weekly4.play_model import FORMAT_NAMES

Values = dict[tuple[int, str], dict[str, Mapping[str, float] | None]]
WITHOUT_A_CLUB: Final = "sheets_without_a_club"


def damped(form: Points | None, allowed: float, implied: float, own_mean: float) -> dict[str, float] | None:
    """form x (A x T / T-own)^(1/2) in each format; no opinion without form."""
    if form is None:
        return None
    game = implied / own_mean if np.isfinite(implied) and own_mean > 0 else 1.0
    factor = float(np.sqrt(max(allowed * game, 0.0)))
    return {name: float(form[name]) * factor for name in FORMAT_NAMES}


def benchmark_values(
    r3_rows: Sequence[JudgedRow],
    board: pd.DataFrame,
    lines: pd.DataFrame,
    teams: pd.DataFrame,
    positions: Mapping[str, str],
) -> tuple[Values, dict[str, int]]:
    """Round 4's `judgment.benchmark_values` term for term, with the damped sheet beside the preregistered one:
    last-three form and both spreadsheets for every population row of the judged season (`lines` and
    `teams` that season's), and the rows read without a club."""
    pairing = teams[["week", "club", "opponent"]]
    implied = teams.set_index(["week", "club"])["implied_points"].to_dict()
    placed = (
        board.drop_duplicates(["week", "player_id"])
        .set_index(["week", "player_id"])[["club", "opponent"]]
        .to_dict("index")
    )
    found: Values = {}
    counts = {WITHOUT_A_CLUB: 0}
    for week in sorted({r.week for r in r3_rows}):
        three = last_three(lines, week)
        allowed = points_allowed(lines, pairing, positions, week)
        before = teams[teams["week"] < week]
        own = before.groupby("club")["implied_points"].mean().to_dict()
        league = float(before["implied_points"].mean()) if not before.empty else float("nan")
        for r in (r for r in r3_rows if r.week == week):
            spot = placed.get((week, r.player_id))
            if spot is None:
                counts[WITHOUT_A_CLUB] += 1
                terms = (1.0, float("nan"), 1.0)
            else:
                club, opponent = str(spot["club"]), str(spot["opponent"])
                terms = (
                    allowed.get((opponent, r.position), 1.0),
                    float(implied.get((week, club), np.nan)),
                    float(own.get(club, league)),
                )
            found[(week, r.player_id)] = {
                "last_three": three.get(r.player_id),
                "sheet": baseline(r.form, *terms),
                "damped": damped(r.form, *terms),
            }
    return found, counts
