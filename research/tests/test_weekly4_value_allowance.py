# ruff: noqa: PLR2004 - hand-made cases
"""The value allowance (2.4): what a defence gave up beyond each opportunity's expected value to a
position, against what the same offences gained in their other games, a difference shrunk toward 0
with six games of prior (amendment 2 item 2's form), from the plays of weeks before W only."""

import pandas as pd
import pytest

from research.model.weekly4.value_allowance import game_values, row_allowances, value_allowances


def _play(week: int, offence: str, defence: str, over: float, kind: str = "target") -> dict[str, object]:
    return {
        "season": 2022,
        "week": week,
        "kind": kind,
        "player_id": "wr",
        "posteam": offence,
        "defteam": defence,
        "h_n": 1.0,
        "h_catch": 0.0,
        "h_xcatch": 0.0,
        "h_yards_over": over * 10.0,  # yards over expected: `over` points
        "h_interceptions": 0.0,
        "h_xinterceptions": 0.0,
    }


def _pairing() -> pd.DataFrame:
    games = [(1, "A", "D"), (2, "A", "E"), (3, "A", "F"), (1, "B", "E"), (2, "B", "D")]
    rows = []
    for week, offence, defence in games:
        rows += [(2022, week, offence, defence), (2022, week, defence, offence)]
    return pd.DataFrame(rows, columns=["season", "week", "club", "opponent"])


def test_a_defence_is_priced_on_its_offences_elsewhere() -> None:
    plays = pd.DataFrame(
        [
            _play(1, "A", "D", 3.0),
            _play(2, "A", "E", 1.0),
            _play(3, "A", "F", 1.0),  # week 3: never history for week 3
            _play(1, "B", "E", 0.0),
            _play(2, "B", "D", 2.0),
        ]
    )
    values = game_values(plays, {"wr": "WR"})
    found = value_allowances(values, _pairing(), 2022, weeks=(3,))
    d = found[(found["defence"] == "D") & (found["kind"] == "target") & (found["format"] == "ppr")]
    # D: against A 3 vs A elsewhere 1 (week 2 only before week 3), against B 2 vs B elsewhere 0
    assert d["value"].iloc[0] == pytest.approx(2 * ((3 - 1) + (2 - 0)) / 2 / (2 + 6))
    assert d["games"].iloc[0] == 2


def test_rows_read_their_opponents_allowance_and_zero_without_a_game() -> None:
    allowances = pd.DataFrame(
        {
            "season": [2022],
            "week": [3],
            "defence": ["D"],
            "position": ["WR"],
            "kind": ["target"],
            "format": ["ppr"],
            "value": [0.5],
            "games": [2],
        }
    )
    rows = pd.DataFrame({"season": [2022, 2022], "week": [3, 3], "opponent": ["D", "Z"], "position": ["WR", "WR"]})
    found = row_allowances(rows, allowances)
    assert list(found["allow_target_ppr"]) == [0.5, 0.0]
    assert list(found["allow_carry_ppr"]) == [0.0, 0.0]
