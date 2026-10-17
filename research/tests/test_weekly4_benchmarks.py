"""The benchmarks of 3.1 beside round 3's: recent form over the last three games played, and the
expert's three-fact spreadsheet, form x A x (T / T-own)."""

import pandas as pd
import pytest

from research.model.weekly4.benchmarks import baseline, last_three, points_allowed


def _lines() -> pd.DataFrame:
    rows = [
        (1, "p", "AAA", 10.0),
        (2, "p", "AAA", 20.0),
        (4, "p", "AAA", 30.0),
        (5, "p", "AAA", 40.0),
        (6, "p", "AAA", 99.0),  # week W: not before it
        (1, "q", "BBB", 8.0),
        (2, "q", "BBB", 4.0),
    ]
    return pd.DataFrame(
        [{"week": w, "player_id": p, "club": c, "ppr": v, "half": v - 1, "std": v - 2} for w, p, c, v in rows]
    )


def test_last_three_is_the_mean_of_his_last_three_games_played_before_w() -> None:
    found = last_three(_lines(), 6)
    assert found["p"]["ppr"] == pytest.approx(30.0)
    assert found["p"]["std"] == pytest.approx(28.0)
    assert found["q"]["ppr"] == pytest.approx(6.0)
    assert "r" not in found


def test_points_allowed_against_the_league_mean_shrunk_with_six_games() -> None:
    lines = _lines()
    pairing = pd.DataFrame(
        {
            "week": [1, 1, 2, 2],
            "club": ["AAA", "DDD", "BBB", "DDD"],
            "opponent": ["DDD", "AAA", "DDD", "BBB"],
        }
    )
    positions = {"p": "WR", "q": "WR"}
    found = points_allowed(lines, pairing, positions, 3)
    # D allowed 10 (week 1) and 4 (week 2): mean 7. League: club-games with WR points, AAA 10 and
    # BBB 4 in their games, DDD's offence 0 twice: (10 + 4 + 0 + 0) / 4 = 3.5 per team-game.
    ratio = 7.0 / 3.5
    assert found[("DDD", "WR")] == pytest.approx((2 * ratio + 6) / 8)


def test_the_baseline_is_form_times_the_matchup_times_the_game_over_the_clubs_own() -> None:
    form = {"ppr": 12.0, "half": 10.0, "std": 8.0}
    found = baseline(form, 1.2, 27.0, 24.0)
    assert found is not None
    assert found["ppr"] == pytest.approx(12.0 * 1.2 * 27 / 24)
    assert baseline(None, 1.2, 27.0, 24.0) is None
