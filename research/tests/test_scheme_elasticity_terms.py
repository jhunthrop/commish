"""Lane 245's probe: the season window, the term arithmetic and the shrinkage wiring."""

import math

import numpy as np
import pandas as pd
import pytest

from research.explore.scheme_elasticity.fetch import ftn_record, participation_record
from research.explore.scheme_elasticity.seasons import ClosedSeasonReadError, admit_season
from research.explore.scheme_elasticity.terms import (
    CAP_HIGH,
    CAP_LOW,
    FALLBACK,
    before,
    defence_rates,
    history,
    mix_multiplier,
    play_action_multiplier,
    shrink_toward,
    splits,
)


@pytest.mark.parametrize("season", [2024, 2025, 2026, 2020])
def test_a_season_outside_the_window_is_refused(season: int) -> None:
    with pytest.raises(ClosedSeasonReadError):
        admit_season(season)


def test_the_window_admits_the_development_seasons_and_last_seasons_form() -> None:
    assert [admit_season(s) for s in (2021, 2022, 2023)] == [2021, 2022, 2023]
    with pytest.raises(ClosedSeasonReadError):
        admit_season(2021, frozenset({2022, 2023}))


def test_an_ftn_row_of_another_season_is_refused() -> None:
    row = {
        "nflverse_game_id": "2024_01_X_Y", "nflverse_play_id": "5", "season": "2024", "week": "1",
        "n_defense_box": "6", "n_blitzers": "1", "n_pass_rushers": "5", "is_play_action": "TRUE",
        "is_screen_pass": "FALSE",
    }  # fmt: skip
    with pytest.raises(ValueError, match="refused"):
        ftn_record(row, 2023)
    found = ftn_record({**row, "season": "2023"}, 2023)
    assert found["is_play_action"] is True
    assert found["n_blitzers"] == 1.0


def test_a_participation_row_keeps_missing_values_missing() -> None:
    row = {
        "nflverse_game_id": "2022_01_BUF_LA", "play_id": "41", "possession_team": "LA",
        "defenders_in_box": "", "number_of_pass_rushers": "NA", "offense_players": "a;b",
        "was_pressure": "", "defense_man_zone_type": "MAN_COVERAGE", "defense_coverage_type": "",
    }  # fmt: skip
    found = participation_record(row, 2022)
    assert found["defenders_in_box"] is None
    assert found["was_pressure"] is None
    assert found["man_zone"] == "MAN_COVERAGE"


def _frame(rows: list[tuple[int, int, str]]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["season", "week", "player_id"])


def test_history_reads_this_season_before_the_week_and_2022_whole_for_2023() -> None:
    frame = _frame([(2022, 3, "a"), (2022, 17, "a"), (2023, 4, "a"), (2023, 6, "a"), (2023, 9, "a")])
    assert history(frame, 2023, 6)[["season", "week"]].values.tolist() == [[2022, 3], [2022, 17], [2023, 4]]
    assert history(frame, 2022, 6)[["season", "week"]].values.tolist() == [[2022, 3]]
    assert before(frame, 2023, 6)[["season", "week"]].values.tolist() == [[2023, 4]]


def test_the_defence_rate_is_shrunk_with_six_games_toward_the_league() -> None:
    assert shrink_toward(0.5, 6, 0.3) == pytest.approx(0.4)
    window = pd.DataFrame(
        {
            "defteam": ["A", "A", "B", "B"],
            "game_id": ["g1", "g2", "g3", "g3"],
            "condition": [1.0, 1.0, 0.0, np.nan],
        }
    )
    rates = defence_rates(window)
    assert rates.league == pytest.approx(2 / 3)
    assert rates.of("A") == pytest.approx((2 * 1.0 + 6 * 2 / 3) / 8)
    assert rates.of("B") == pytest.approx((1 * 0.0 + 6 * 2 / 3) / 7)
    assert rates.of("nobody") == pytest.approx(2 / 3)


def _opportunities(player: str, condition: float, points: list[float]) -> list[tuple[str, float, float]]:
    return [(player, condition, p) for p in points]


def test_a_split_with_no_spread_between_players_pools_fully_to_the_position_split() -> None:
    rows = []
    for player in "abcdef":
        rows += _opportunities(player, 1.0, [0.0, 2.0] * 15)
        rows += _opportunities(player, 0.0, [0.0, 1.0] * 15)
    window = pd.DataFrame(rows, columns=["player_id", "condition", "points"])
    found = splits(window)
    assert found.pooled_fully
    assert found.prior == pytest.approx(0.5)
    assert np.allclose(found.frame["d_post"], 0.5)
    unshrunk = splits(window, shrink=False)
    assert unshrunk.frame.loc["a", "n_c"] == pytest.approx(30)
    assert unshrunk.frame.loc["a", "r"] == pytest.approx(0.5)
    assert unshrunk.frame.loc["a", "mean"] == pytest.approx(0.75)


def test_a_real_spread_keeps_a_player_split_between_his_own_and_the_prior() -> None:
    rows = []
    for player, lift in (("a", 3.0), ("b", -3.0), ("c", 0.0), ("d", 3.0), ("e", -3.0)):
        rows += _opportunities(player, 1.0, [1.0 + lift, 1.0 + lift + 0.1] * 20)
        rows += _opportunities(player, 0.0, [1.0, 1.1] * 20)
    found = splits(pd.DataFrame(rows, columns=["player_id", "condition", "points"]))
    assert not found.pooled_fully
    a = float(found.frame["d_post"].to_numpy()[list(found.frame.index).index("a")])
    own_split = 3.0
    assert found.prior < a < own_split


def _split_row(n_c: float, n_n: float, mean: float, r: float, d_post: float) -> pd.Series:
    return pd.Series({"n_c": n_c, "n_n": n_n, "mean": mean, "r": r, "d_post": d_post})


def test_the_mix_multiplier_scales_his_own_mix_by_the_opponents_rate() -> None:
    row = _split_row(30, 70, 0.5, 0.3, 0.2)
    found = mix_multiplier(row, 1.0, 0.4, 0.3)
    expected = 1 + (min(1.0, 0.3 * 0.4 / 0.3) - 0.3) * 0.2 / 0.5
    assert found.m == pytest.approx(expected)
    assert found.used
    assert not found.capped
    assert mix_multiplier(row, 0.5, 0.4, 0.3).m == pytest.approx(1 + 0.5 * (expected - 1))
    assert mix_multiplier(row, 1.0, 0.3, 0.3).m == pytest.approx(1.0)


def test_too_little_history_or_no_rate_falls_back_to_one() -> None:
    assert mix_multiplier(_split_row(9, 70, 0.5, 0.1, 0.2), 1.0, 0.4, 0.3) == FALLBACK
    assert mix_multiplier(_split_row(30, 70, 0.0, 0.3, 0.2), 1.0, 0.4, 0.3) == FALLBACK
    assert mix_multiplier(_split_row(30, 70, 0.5, 0.3, 0.2), 1.0, math.nan, 0.3) == FALLBACK


def test_the_multiplier_is_capped_and_the_cap_is_counted() -> None:
    high = mix_multiplier(_split_row(50, 50, 0.1, 0.5, 5.0), 1.0, 0.6, 0.3)
    low = mix_multiplier(_split_row(50, 50, 0.1, 0.5, -5.0), 1.0, 0.6, 0.3)
    assert (high.m, high.capped) == (CAP_HIGH, True)
    assert (low.m, low.capped) == (CAP_LOW, True)


def test_the_play_action_term_reweights_the_defences_two_allowances_by_his_rate() -> None:
    row = _split_row(40, 160, 0.5, 0.2, 0.0)
    found = play_action_multiplier(row, 1.0, 0.8, 0.4, 0.25)
    expected = (0.8 * 0.4 + 0.2 * 0.8) / (0.75 * 0.4 + 0.25 * 0.8)
    assert found.m == pytest.approx(expected)
    assert play_action_multiplier(_split_row(40, 160, 0.5, 0.25, 0.0), 1.0, 0.8, 0.4, 0.25).m == pytest.approx(1.0)
    assert play_action_multiplier(_split_row(5, 160, 0.5, 0.2, 0.0), 1.0, 0.8, 0.4, 0.25) == FALLBACK
