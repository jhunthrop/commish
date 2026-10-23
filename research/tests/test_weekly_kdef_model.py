# ruff: noqa: PLR2004 - hand-made cases
"""Lane 157, the model's parts on hand-made rows: the kernel and its tilt, the three bands, the joint's
analytic point against its draws, the seeding rule, the statistics (the fill rule, the week-block bootstrap
with `default_rng(42)`, S2, S3 with ties counted half), the shrinkage forms, the kicker at t_g, and the
why's exact Shapley values."""

import hashlib
import math
from datetime import UTC, datetime

import numpy as np
import pandas as pd
import pytest

from research.model.weekly4.features.plays import PLAY_COLUMNS, Play
from research.model.weekly_kdef import kernel, scrimmage, statistics
from research.model.weekly_kdef.expectations import Expectations
from research.model.weekly_kdef.joint import Calibration, club_game_seed, defense_point, draw_row, kicker_point
from research.model.weekly_kdef.rates import GamePrior, moments_prior, shrunk_per_game, shrunk_rate, trials_prior
from research.model.weekly_kdef.tallies import Tally, add_kicking, club_kicker
from research.model.weekly_kdef.why import GROUPS, shapley, subsets


def test_the_tilt_meets_the_boosted_mean_and_keeps_the_lumps() -> None:
    base = np.array([20.0, 21.0, 22.0, 24.0, 19.0, 23.0])
    scores = np.array([17.0, 20.0, 24.0, 27.0, 13.0, 21.0])
    raw = kernel.kernel(base, scores, np.array([21.5]), 2.0)
    tilted = kernel.tilt(raw, np.array([23.0]))
    assert float((tilted @ kernel.SCORES)[0]) == pytest.approx(23.0, abs=1e-4)
    assert set(np.flatnonzero(tilted[0] > 0)) == set(np.flatnonzero(raw[0] > 0)) == {13, 17, 20, 21, 24, 27}


def test_a_club_game_with_no_game_figure_weighs_every_fit_club_game_alike() -> None:
    base = np.array([20.0, 28.0])
    scores = np.array([14.0, 31.0])
    found = kernel.kernel(base, scores, np.array([np.nan]), 1.0)
    assert found[0, 14] == pytest.approx(0.5) and found[0, 31] == pytest.approx(0.5)


def test_the_bandwidth_is_the_least_forward_chained_log_loss_the_smaller_on_a_tie() -> None:
    implied = np.array([20.0, 20.0, 20.0, 20.0])
    scores = np.array([17.0, 17.0, 17.0, 17.0])
    seasons = np.array([2016, 2017, 2018, 2019])
    found = kernel.choose_bandwidth(implied, scores, seasons, (2016, 2017, 2018, 2019))
    assert found.chosen == 1.0  # every bandwidth gives the same loss: the smaller
    assert set(found.losses) == set(kernel.BANDWIDTHS)


def test_the_three_bands_split_at_the_middle_fifty() -> None:
    dist = np.zeros((1, 61))
    dist[0, [0, 10, 20, 30]] = 0.25
    masses, low, high = kernel.band_masses(dist)
    assert (low[0], high[0]) == (0.0, 20.0)
    assert masses[0] == pytest.approx([0.0, 0.75, 0.25])
    assert list(kernel.band_of(np.array([0, 10, 21]), low, high)) == [1, 1, 2]


def _expectations() -> Expectations:
    dist = np.zeros((1, 61))
    dist[0, [3, 10, 17, 20, 24, 31]] = (0.1, 0.15, 0.25, 0.2, 0.2, 0.1)
    masses, low, high = kernel.band_masses(dist)
    return Expectations(
        dist=dist, masses=masses, low=low, high=high,
        sacks=np.array([2.4]), interceptions=np.array([0.8]), fumble_recoveries=np.array([0.6]),
        td_per_takeaway=np.array([0.08]), return_touchdowns=np.array([0.05]), safeties=np.array([0.02]),
        blocks=np.array([0.05]), yards=np.array([330.0]), attempts=np.array([1.8]),
        bands=np.array([[0.02, 0.28, 0.27, 0.25, 0.16, 0.02]]), makes=np.array([[0.99, 0.97, 0.92, 0.82, 0.66, 0.4]]),
        touchdowns=np.array([2.5]), two_point_rate=np.array([0.07]), extra_point=np.array([0.94]),
    )  # fmt: skip


def _calibration() -> Calibration:
    multipliers = {
        "sacks": (1.2, 1.0, 0.8), "interceptions": (1.3, 1.0, 0.7), "fumble_recoveries": (1.1, 1.0, 0.9),
        "attempts": (0.7, 1.0, 1.3), "touchdowns": (0.5, 1.0, 1.5),
    }  # fmt: skip
    residuals = tuple(np.sort(np.random.default_rng(3).uniform(0.6, 1.4, 50)) for _ in range(3))
    return Calibration(multipliers, 12.0, (300.0, 360.0), (residuals[0], residuals[1], residuals[2]), 0.35)


def test_the_draws_agree_with_the_analytic_point() -> None:
    e, c = _expectations(), _calibration()
    drawn = draw_row(e, 0, c, club_game_seed(2023, 2023, 5, "SEA"), 200_000)
    assert float(drawn.defense.mean()) == pytest.approx(float(defense_point(e, c)[0]), abs=0.05)
    assert float(drawn.kicker.mean()) == pytest.approx(float(kicker_point(e, c)[0]), abs=0.05)


def test_the_seed_is_round_fours_rule_with_kdef_appended() -> None:
    digest = hashlib.sha256(b"2024:2024:7:SEA:kdef").digest()
    assert club_game_seed(2024, 2024, 7, "SEA") == int.from_bytes(digest[:8], "big")


def test_the_fill_rule_ranks_a_source_with_no_number_below_every_row_it_has() -> None:
    values = np.array([3.0, np.nan, 1.0, np.nan])
    actual = np.array([10.0, 1.0, 5.0, 2.0])
    assert statistics.spearman(values, actual) == pytest.approx(0.9486833)
    assert statistics.spearman(np.array([1.0]), np.array([2.0])) is None


def test_the_bootstrap_is_week_blocks_from_default_rng_42() -> None:
    draws = statistics.bootstrap_draws(15, 10_000, 42)
    assert np.array_equal(draws, np.random.default_rng(42).integers(0, 15, size=(10_000, 15)))
    rhos = [statistics.WeekRho(w, 30, {"model": 0.3 + 0.01 * w, "form": 0.2}) for w in range(15)]
    found = statistics.compare(rhos, "model", "form", draws, 2.5)
    assert found.value == pytest.approx(0.17) and found.weeks == 15
    assert found.lower_bound is not None and 0.1 < found.lower_bound < 0.17


def test_s2_takes_each_weeks_first_twelve_and_s3_counts_ties_half() -> None:
    rows = pd.DataFrame(
        {
            "week": [1] * 14,
            "unit": [f"u{i:02d}" for i in range(14)],
            "actual": np.arange(14.0),
            "model": np.arange(14.0),
        }
    )
    assert statistics.starters_points(rows, "model", [1], 12) == pytest.approx(np.mean(np.arange(2.0, 14.0)))
    shares = statistics.range_shares(np.array([1.0, 2.0, 3.0, 4.0]), np.full(4, 2.0), np.full(4, 3.0), np.full(4, 4.0))
    assert (shares.below_floor, shares.above_ceiling, shares.below_median) == (0.375, 0.125, 0.625)


def test_a_per_game_rate_is_shrunk_by_round_fours_closed_form() -> None:
    prior = GamePrior(1.0, 6.0)
    assert shrunk_per_game(6.0, 3.0, prior) == pytest.approx(3 / 9 * 2.0 + 6 / 9 * 1.0)
    assert shrunk_per_game(0.0, 0.0, prior) == 1.0
    assert shrunk_per_game(6.0, 3.0, GamePrior(1.0, math.inf)) == 1.0  # full pooling
    pooled = moments_prior([[1.0, 1.0, 1.0], [1.0, 1.0, 1.0]])
    assert pooled.pooled  # no spread within or across: nothing to shrink by


def test_a_trial_rate_is_shrunk_in_its_beta_binomial_form() -> None:
    prior = trials_prior([8.0, 9.0, 5.0, 10.0], [10.0, 10.0, 10.0, 10.0])
    assert prior.rate == pytest.approx(0.8)
    found = shrunk_rate(10.0, 10.0, 0.8, prior)
    assert (0.8 < found < 1.0) if not prior.pooled else found == 0.8


def _kicking(week: int, player: str, team: str, attempts: int) -> dict[str, object]:
    row: dict[str, object] = {
        "player_id": player,
        "team": team,
        "fg_att": attempts,
        "fg_blocked": 0,
        "pat_made": 2,
        "pat_att": 2,
    }
    for band in ("0_19", "20_29", "30_39", "40_49", "50_59", "60"):
        row[f"fg_made_{band}"] = attempts if band == "30_39" else 0
        row[f"fg_missed_{band}"] = 0
    return row


def test_the_clubs_kicker_is_the_one_who_kicked_its_latest_game() -> None:
    tally = Tally()
    add_kicking(
        tally,
        [
            (2023, 1, _kicking(1, "A", "SEA", 2)),
            (2023, 2, _kicking(2, "A", "SEA", 1)),
            (2023, 3, _kicking(3, "B", "SEA", 1)),
        ],
    )
    assert club_kicker(tally, "SEA") == "B"
    assert club_kicker(tally, "KC") is None
    moved = Tally()
    add_kicking(moved, [(2022, 17, _kicking(17, "A", "SEA", 1)), (2023, 2, _kicking(2, "A", "KC", 1))])
    assert club_kicker(moved, "SEA") is None and club_kicker(moved, "KC") == "A"


def test_shapley_values_sum_to_the_point_less_the_neutral_point() -> None:
    weights = {"game": 2.0, "matchup": -1.0, "weather": 0.5, "home_rest": 0.25}
    values = {}
    for present in subsets(GROUPS):
        total = sum(weights[g] for g in present) + (1.5 if {"game", "weather"} <= present else 0.0)
        values[present] = (np.array([total]), np.array([2 * total]))
    found = shapley(values)
    full = values[frozenset(GROUPS)]
    assert sum(found[g][0][0] for g in GROUPS) == pytest.approx(full[0][0] - values[frozenset()][0][0])
    assert found["game"][0][0] == pytest.approx(2.0 + 0.75)  # the interaction shared by its two groups
    assert found["home_rest"][1][0] == pytest.approx(0.5)


def _play(club: str, week: int, play_id: int, **values: object) -> Play:
    base: dict[str, object] = dict.fromkeys(PLAY_COLUMNS)
    base |= {"game_id": f"g{week}{club}", "play_id": play_id, "season": 2023, "week": week}
    base |= {"as_of": datetime(2023, 9, 1, tzinfo=UTC), "posteam": club, "defteam": "OPP", "play_type": "pass"}
    return Play(**{**base, **values})  # type: ignore[arg-type]


def test_the_starter_passes_over_a_withheld_first_quarterback_and_falls_back_to_the_latest_passer() -> None:
    chart = {"SEA": {"qb1": 1, "qb2": 2, "wr1": 1}}
    quarterbacks = frozenset({"qb1", "qb2"})
    assert scrimmage.starter("SEA", chart, quarterbacks, {}, frozenset()) == "qb1"
    assert scrimmage.starter("SEA", chart, quarterbacks, {}, frozenset({"qb1"})) == "qb2"
    assert scrimmage.starter("SEA", chart, quarterbacks, {}, frozenset({"qb1", "qb2"})) is None
    assert scrimmage.starter("KC", chart, quarterbacks, {"KC": "pm"}, frozenset()) == "pm"
    assert scrimmage.starter("KC", chart, quarterbacks, {"KC": "pm"}, frozenset({"pm"})) is None


def test_the_plays_tally_counts_dropbacks_yards_and_fourth_downs() -> None:
    plays = [
        _play("SEA", 1, 1, qb_dropback=True, passer_player_id="a", interception=True, yards_gained=0.0),
        _play("SEA", 1, 2, qb_dropback=True, passer_player_id="a", yards_gained=12.0),
        _play("SEA", 2, 3, qb_dropback=True, passer_player_id="b", yards_gained=6.0),
        _play("SEA", 2, 4, play_type="run", yards_gained=4.0, down=4, yardline_100=30),
        _play("SEA", 2, 5, play_type="field_goal", down=4, yardline_100=20),
        _play("SEA", 2, 6, play_type="punt", down=4, yardline_100=55),  # outside field-goal range
        _play("SEA", 2, 7, two_point_attempt=True, qb_dropback=True, passer_player_id="b", yards_gained=2.0),
    ]
    t = scrimmage.tally_plays(plays)
    assert t.latest["SEA"] == "b"
    assert t.passers["a"] == [1.0, 2.0]
    assert t.gained["SEA"] == [0.0, 12.0, 6.0, 4.0]
    assert t.allowed["OPP"] == [0.0, 12.0, 6.0, 4.0]
    assert t.fourth["SEA"] == [1.0, 2.0]
    third = scrimmage.tally_plays([_play("SEA", 3, 8, qb_dropback=True, passer_player_id="c", yards_gained=1.0)])
    later = scrimmage.merged(t, third)
    assert later.latest["SEA"] == "c"
    assert later.passers["a"] == [1.0, 2.0]
    assert len(later.gained["SEA"]) == 5
