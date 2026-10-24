# ruff: noqa: PLR2004 - hand-computed rates
"""Round 5's value and efficiency windows (Lane 168; preregistration 2.4): the age weights, the effective count,
the posterior and its n_eff = 0 case, the conversions' expected-touchdown units, the (d, k) choice and its tie
rule, the quarterback's unpooled yards per carry, the season anchors, and the input rule's guards (2: a week-W
line raises; 4: a row outside the window, or of 2025 or 2026, is refused)."""

import numpy as np
import pandas as pd
import pytest

from research.model.weekly3.ledger import InputRuleError
from research.model.weekly5 import shrinkage
from research.model.weekly5.anchors import anchors, anchors_at
from research.model.weekly5.shrinkage import (
    QB_CARRY,
    WindowError,
    check_window,
    fit_shrinkage,
    posterior,
    rate_column,
    rate_inputs,
    shrunk_rates,
    weighted_sums,
)

ZEROS = dict.fromkeys(
    (
        "targets", "receptions", "receiving_yards", "receiving_touchdowns", "designed", "designed_yards",
        "designed_touchdowns", "dropbacks", "sacks", "scrambles", "scramble_yards", "scramble_touchdowns",
        "pass_attempts", "passing_yards", "interceptions", "passing_touchdowns", "xfp_target", "fp_target",
        "xfp_carry", "fp_carry", "carries", "rushing_yards", "rushing_touchdowns", "u_rush", "u_receiving",
        "u_passing", "fumbles_lost",
    ),
    0.0,
)  # fmt: skip


def game(week: int, player: str = "wr", position: str = "WR", season: int = 2021, **values: float) -> dict[str, object]:
    return {
        "season": season,
        "week": week,
        "player_id": player,
        "position": position,
        "club": "KC",
        "games": 1.0,
        **ZEROS,
        **values,
    }


def frame(*rows: dict[str, object]) -> pd.DataFrame:
    return pd.DataFrame(list(rows))


def test_ages_count_his_lined_games_back_from_the_latest() -> None:
    games = frame(game(1, targets=4, receptions=2), game(2, targets=2, receptions=2), game(4, targets=6, receptions=3))
    sums = weighted_sums(games, 2021, 5, 0.5, [("receptions", "targets")])
    # Ages 2, 1, 0 for weeks 1, 2, 4: weights 0.25, 0.5, 1.
    assert sums.loc["wr", "receptions|num"] == pytest.approx(0.25 * 2 + 0.5 * 2 + 3)
    assert sums.loc["wr", "targets|w"] == pytest.approx(0.25 * 4 + 0.5 * 2 + 6)
    assert sums.loc["wr", "targets|w2"] == pytest.approx(0.0625 * 4 + 0.25 * 2 + 6)


def test_the_posterior_shrinks_by_the_effective_count() -> None:
    num, w, w2 = np.array([6.0]), np.array([10.0]), np.array([10.0])  # d = 1: n_eff = 10 opportunities
    assert posterior(num, w, w2, 10.0, 0.4)[0] == pytest.approx(0.5 * 0.6 + 0.5 * 0.4)
    assert posterior(num, w, w2, 0.0, 0.4)[0] == pytest.approx(0.6)
    decayed = posterior(np.array([3.0]), np.array([5.0]), np.array([2.5]), 10.0, 0.4)[0]  # n_eff = 25 / 2.5 = 10
    assert decayed == pytest.approx(0.5 * 0.6 + 0.5 * 0.4)


def test_with_no_opportunity_the_posterior_is_the_position_rate() -> None:
    assert posterior(np.array([0.0]), np.array([0.0]), np.array([0.0]), 40.0, 0.62)[0] == pytest.approx(0.62)
    assert posterior(np.array([2.0]), np.array([0.0]), np.array([0.0]), 40.0, 0.62)[0] == pytest.approx(0.62)


def test_a_conversion_counts_expected_touchdown_units() -> None:
    games = frame(game(1, rushing_touchdowns=1, u_rush=0.5), game(2, rushing_touchdowns=0, u_rush=1.5))
    sums = weighted_sums(games, 2021, 3, 1.0, [("rushing_touchdowns", "u_rush")])
    assert sums.loc["wr", "u_rush|w"] == pytest.approx(2.0)  # at d = 1, n_eff is his expected touchdowns
    w, w2 = sums["u_rush|w"].to_numpy(dtype=float)[0], sums["u_rush|w2"].to_numpy(dtype=float)[0]
    assert w**2 / w2 == pytest.approx(2.0)


def test_a_touchdown_with_no_weight_counts_in_the_numerator() -> None:
    games = frame(game(1, rushing_touchdowns=1, u_rush=0.0), game(2, rushing_touchdowns=0, u_rush=1.0))
    sums = weighted_sums(games, 2021, 3, 1.0, [("rushing_touchdowns", "u_rush")])
    assert sums.loc["wr", "rushing_touchdowns|num"] == 1.0 and sums.loc["wr", "u_rush|w"] == 1.0


def test_guard_two_a_week_w_line_raises_in_every_read() -> None:
    games = frame(game(1, targets=3), game(5, targets=9))
    with pytest.raises(InputRuleError, match="2021 week 5 line"):
        weighted_sums(games, 2021, 5, 1.0, [("receptions", "targets")])
    with pytest.raises(InputRuleError):
        anchors_at(games, 2021, 5)
    with pytest.raises(InputRuleError, match="2020 week 1"):
        weighted_sums(frame(game(1, season=2020)), 2021, 5, 1.0, [("receptions", "targets")])


def test_the_season_reads_take_only_earlier_weeks() -> None:
    games = frame(
        game(1, targets=3, receptions=1), game(2, targets=5, receptions=5), game(3, targets=100, receptions=100)
    )
    rows = frame(game(3), game(1))
    found = anchors(games, rows)
    assert found.loc[0, "anchor_targets"] == pytest.approx(4.0)  # weeks 1 and 2, never week 3's own
    assert np.isnan(found["anchor_targets"].to_numpy(dtype=float)[1])  # before his first game


def _window(seasons: tuple[int, ...] = (2021, 2022)) -> pd.DataFrame:
    rng = np.random.default_rng(3)
    rows = []
    for season in seasons:
        for week in range(1, 18):
            for player, position in (("wr1", "WR"), ("wr2", "WR"), ("rb", "RB"), ("te", "TE"), ("qb", "QB")):
                targets = float(rng.integers(2, 10)) if position != "QB" else 0.0
                drops = 35.0 if position == "QB" else 0.0
                rows.append(
                    game(
                        week, player, position, season, targets=targets, receptions=targets * 0.6,
                        receiving_yards=targets * 7, designed=8.0, designed_yards=34.0, carries=8.0, rushing_yards=34.0,
                        dropbacks=drops, sacks=drops * 0.07, scrambles=drops * 0.04, pass_attempts=drops * 0.89,
                        passing_yards=drops * 6.5, interceptions=drops * 0.02, passing_touchdowns=1.0,
                        u_passing=1.6, u_rush=0.3, u_receiving=0.4, rushing_touchdowns=float(rng.random() < 0.3),
                        receiving_touchdowns=float(rng.random() < 0.3), xfp_target=targets * 1.5, fp_target=targets * 1.6,
                        xfp_carry=6.0, fp_carry=6.5,
                    )
                )  # fmt: skip
    return frame(*rows)


def test_the_fit_chooses_per_position_and_quantity_on_the_window() -> None:
    fit = fit_shrinkage(_window(), (2021, 2022))
    assert set(fit.cells) == {(p, q) for q, s in shrinkage.QUANTITIES.items() for p in s.positions}
    for (_, quantity), (d, k) in fit.cells.items():
        assert d in shrinkage.DECAYS
        grid = shrinkage.CONVERSION_PRIORS if shrinkage.QUANTITIES[quantity].conversion else shrinkage.COUNT_PRIORS
        assert k in grid
    assert set(fit.losses[("WR", "receptions_per_target")]) == {
        (d, k) for d in shrinkage.DECAYS for k in shrinkage.COUNT_PRIORS
    }
    assert fit.rates[("WR", "receptions_per_target")] == pytest.approx(0.6)
    assert fit.rates[("QB", QB_CARRY)] == pytest.approx(34.0 / 8.0)


def test_the_tie_rule_prefers_more_pooling() -> None:
    assert shrinkage._choose({(0.85, 10.0): 1.0, (1.0, 10.0): 1.0005, (0.95, 20.0): 1.0009}) == (0.95, 20.0)
    assert shrinkage._choose({(0.85, 10.0): 1.0, (1.0, 20.0): 1.002}) == (0.85, 10.0)
    assert shrinkage._choose({(0.85, 40.0): 1.0, (1.0, 40.0): 1.0}) == (1.0, 40.0)


def test_guard_four_the_fit_refuses_rows_outside_its_window() -> None:
    with pytest.raises(WindowError, match="2023"):
        fit_shrinkage(_window((2021, 2022, 2023)), (2021, 2022))
    with pytest.raises(WindowError, match="2025"):
        check_window([2021, 2025], (2021, 2022, 2025), "shrinkage")
    with pytest.raises(WindowError, match="2026"):
        check_window([2026], (2026,), "shrinkage")


def test_shrunk_rates_carry_only_his_positions_quantities() -> None:
    window = _window()
    fit = fit_shrinkage(window, (2021, 2022))
    rows = window[window["week"] == 10].reset_index(drop=True)
    found = shrunk_rates(window, rows, fit)
    wr = found[rows["position"] == "WR"].iloc[0]
    assert np.isfinite(wr[rate_column("receptions_per_target")])
    assert np.isnan(wr[rate_column("passing_yards_per_attempt")])
    qb = found[rows["position"] == "QB"].iloc[0]
    assert qb[rate_column(QB_CARRY)] == pytest.approx(34.0 / 8.0)  # unpooled: his plain rate
    neutral = shrunk_rates(window, rows, fit, neutral=True)
    assert neutral.loc[rows["position"] == "WR", rate_column("receptions_per_target")].iloc[0] == pytest.approx(0.6)
    assert rate_column(QB_CARRY) in rate_inputs("QB") and rate_column(QB_CARRY) not in rate_inputs("WR")
