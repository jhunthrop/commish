# ruff: noqa: PLR2004 - hand-computed components
"""Round 5's components (Lane 168; preregistration 2.5 to 2.7, 2.12): each realised quantity read from the play
rows as 2.5 says, the quarterback's path, the touchdown rule, the fumble constant, the missing-share fallback,
the house scoring of the expected components and the rate m with no game this season."""

import math

import numpy as np
import pandas as pd
import pytest

from research.model.domain import StatLine, compute_fantasy_points
from research.model.weekly.round.scoring import FORMATS
from research.model.weekly5.games import lined_games, player_games
from research.model.weekly5.point import NO_SHARE, expected_column, expected_components, fumble_rates, points, score
from research.model.weekly5.shrinkage import QB_CARRY, WindowError, rate_column

POSITIONS = {"qb": "QB", "wr": "WR", "rb": "RB"}


def play(kind: str, player: str, play_id: int, **values: float) -> dict[str, object]:
    base = {"season": 2021, "week": 3, "game_id": "g", "play_id": play_id, "kind": kind, "player_id": player,
            "posteam": "KC", "yardline_100": 50.0, "complete_pass": 0.0, "yards_gained": 0.0, "touchdown": 0.0,
            "interception": 0.0, "sack": 0.0, "xfp_ppr": 1.0}  # fmt: skip
    return {**base, **values}


def plays() -> pd.DataFrame:
    return pd.DataFrame(
        [
            play("dropback", "qb", 1, complete_pass=1, yards_gained=20, touchdown=1, yardline_100=15),
            play("target", "wr", 1, complete_pass=1, yards_gained=20, touchdown=1, yardline_100=15, xfp_ppr=3.0),
            play("dropback", "qb", 2),  # an incompletion with no target (a throwaway)
            play("dropback", "qb", 3, interception=1),
            play("target", "wr", 3, interception=1, xfp_ppr=0.5),
            play("dropback", "qb", 4, sack=1, yards_gained=-7),
            play("dropback", "qb", 5, yards_gained=9, yardline_100=8, touchdown=1),  # a scramble that scores
            play("carry", "rb", 6, yards_gained=4, yardline_100=5, touchdown=1, xfp_ppr=1.2),
            play("carry", "rb", 7, yards_gained=-1),
        ]
    )


def teams() -> pd.DataFrame:
    return pd.DataFrame([{"season": 2021, "week": 3, "club": "KC", "rushing_touchdowns": 2.0, "receiving_touchdowns": 1.0}])


def test_each_realised_quantity_is_read_as_2_5_says() -> None:
    games = player_games(plays(), teams(), POSITIONS).set_index("player_id")
    qb, wr, rb = games.loc["qb"], games.loc["wr"], games.loc["rb"]
    assert (qb["dropbacks"], qb["sacks"], qb["scrambles"], qb["pass_attempts"]) == (5, 1, 1, 3)
    assert (qb["passing_yards"], qb["interceptions"], qb["passing_touchdowns"]) == (20, 1, 1)
    assert (qb["carries"], qb["rushing_yards"], qb["rushing_touchdowns"]) == (1, 9, 1)  # his scramble is a carry
    assert (wr["targets"], wr["receptions"], wr["receiving_yards"], wr["receiving_touchdowns"]) == (2, 1, 20, 1)
    assert (rb["carries"], rb["rushing_yards"], rb["rushing_touchdowns"]) == (2, 3, 1)
    assert wr["xfp_target"] == pytest.approx(3.5) and rb["xfp_carry"] == pytest.approx(2.2)
    # Red-zone opportunities: his targets and designed rushes from the 20; the club's are the receiver's and the
    # back's (a scramble is no designed rush).
    assert (wr["red_zone"], rb["red_zone"], rb["inside_ten"]) == (1, 1, 1)
    assert rb["touchdown_share"] == pytest.approx(0.5 * 0.5 + 0.5 * 1.0)
    assert rb["u_rush"] == pytest.approx(2.0 * 0.75) and wr["u_receiving"] == pytest.approx(1.0 * 0.25)
    assert qb["dropback_share"] == 1.0 and qb["u_passing"] == pytest.approx(1.0)


def test_lined_games_keep_a_line_with_no_play_and_his_fumbles() -> None:
    games = player_games(plays(), teams(), POSITIONS)
    lines = pd.DataFrame(
        [{"season": 2021, "week": 3, "player_id": p, "club": "KC"} for p in ("qb", "wr", "rb")]
        + [{"season": 2021, "week": 3, "player_id": "te", "club": "KC"}]
    )
    fumbles = pd.DataFrame([{"season": 2021, "week": 3, "player_id": "rb", "fumbles_lost": 1.0}])
    found = lined_games(games, lines, {**POSITIONS, "te": "TE"}, fumbles).set_index("player_id")
    assert found.loc["te", "targets"] == 0.0 and found.loc["te", "position"] == "TE"
    assert found.loc["rb", "fumbles_lost"] == 1.0 and found.loc["wr", "fumbles_lost"] == 0.0


def test_fumbles_lost_per_touch_by_position_on_the_window() -> None:
    games = pd.DataFrame(
        [
            {"season": 2021, "week": 1, "position": "RB", "receptions": 2.0, "carries": 18.0, "dropbacks": 0.0, "fumbles_lost": 1.0},
            {"season": 2021, "week": 2, "position": "QB", "receptions": 0.0, "carries": 5.0, "dropbacks": 35.0, "fumbles_lost": 2.0},
        ]
    )
    assert fumble_rates(games, (2021,)) == {"RB": pytest.approx(1 / 20), "QB": pytest.approx(2 / 40)}
    with pytest.raises(WindowError):
        fumble_rates(games, (2022,))


def _row(position: str, **values: float) -> dict[str, object]:
    base: dict[str, object] = {
        "position": position, "exp_dropbacks": 40.0, "exp_rushing_touchdowns": 1.0, "exp_receiving_touchdowns": 2.0,
        "model_dropbacks": 0.9, "model_red_zone": 0.2, "model_inside_ten": 0.1, "share_season_red_zone": 0.05,
        "share_season_inside_ten": 0.15, "share_season_dropbacks": 0.8, "tree_carries": 4.0, "tree_targets": 7.0,
        "tree_receptions": 5.0, "tree_receiving_yards": 60.0, "tree_rushing_yards": 3.0,
        rate_column("sacks_per_dropback"): 0.06, rate_column("scrambles_per_dropback"): 0.04,
        rate_column("passing_yards_per_attempt"): 7.0, rate_column("interceptions_per_attempt"): 0.025,
        rate_column("passing_conversion"): 1.1, rate_column("rushing_conversion"): 0.8,
        rate_column("receiving_conversion"): 0.9, rate_column(QB_CARRY): 5.0,
    }  # fmt: skip
    return {**base, **values}


def test_the_quarterbacks_path() -> None:
    found = expected_components(pd.DataFrame([_row("QB")]), {"QB": 0.01}).iloc[0]
    attempts = 40.0 * 0.9 * (1 - 0.06 - 0.04)
    assert found[expected_column("pass_attempts")] == pytest.approx(attempts)
    assert found[expected_column("passing_yards")] == pytest.approx(attempts * 7.0)
    assert found[expected_column("interceptions")] == pytest.approx(attempts * 0.025)
    assert found[expected_column("passing_touchdowns")] == pytest.approx(2.0 * 0.9 * 1.1)
    assert found[expected_column("rushing_yards")] == pytest.approx(4.0 * 5.0)
    # His touchdown share is his season-to-date red-zone and inside-ten share (no share model of them for him).
    assert found[expected_column("rushing_touchdowns")] == pytest.approx(1.0 * (0.5 * 0.05 + 0.5 * 0.15) * 0.8)
    assert found[expected_column("fumbles_lost")] == pytest.approx((40.0 * 0.9 + 4.0) * 0.01)
    assert found[expected_column("targets")] == 0.0 and found[NO_SHARE] == 0


def test_a_receivers_touchdowns_are_the_clubs_times_his_modelled_share_times_his_conversion() -> None:
    found = expected_components(pd.DataFrame([_row("WR")]), {"WR": 0.02}).iloc[0]
    s = 0.5 * 0.2 + 0.5 * 0.1
    assert found[expected_column("receiving_touchdowns")] == pytest.approx(2.0 * s * 0.9)
    assert found[expected_column("rushing_touchdowns")] == pytest.approx(1.0 * s * 0.8)
    assert found[expected_column("receptions")] == 5.0 and found[expected_column("pass_attempts")] == 0.0
    assert found[expected_column("fumbles_lost")] == pytest.approx((5.0 + 4.0) * 0.02)


def test_a_missing_modelled_share_falls_back_and_is_counted() -> None:
    rows = pd.DataFrame([_row("WR", model_red_zone=math.nan), _row("WR", model_red_zone=math.nan, share_season_red_zone=math.nan)])
    found = expected_components(rows, {"WR": 0.0})
    assert list(found[NO_SHARE]) == [1, 1]
    first = 0.5 * 0.05 + 0.5 * 0.1
    second = 0.5 * 0.0 + 0.5 * 0.1
    assert found[expected_column("receiving_touchdowns")].tolist() == pytest.approx([2 * first * 0.9, 2 * second * 0.9])


def test_the_point_is_the_house_scoring_of_the_expected_components() -> None:
    line = StatLine("p", 3, passing_yards=250, passing_touchdowns=2, interceptions=1, rushing_yards=31,
                    rushing_touchdowns=1, receiving_yards=12, receiving_touchdowns=0, receptions=2, fumbles_lost=1)  # fmt: skip
    components = pd.DataFrame(
        [{expected_column(c): v for c, v in (("passing_yards", 250), ("passing_touchdowns", 2), ("interceptions", 1),
          ("rushing_yards", 31), ("rushing_touchdowns", 1), ("receiving_yards", 12), ("receiving_touchdowns", 0),
          ("receptions", 2), ("fumbles_lost", 1))}]  # fmt: skip
    )
    from research.model.weekly.round.scoring import FORMATS as RULES  # noqa: PLC0415 - the formats' rules

    for name, rules in RULES.items():
        assert score(components, rules)[0] == pytest.approx(compute_fantasy_points(line, "RB", rules))


def test_no_game_this_season_takes_the_rate_m_and_an_unnumbered_row_none() -> None:
    rows = pd.DataFrame(
        [
            {"default_no_game_this_season": 1, **{f"rate_m_{n}": 9.0 for n in FORMATS}},
            {"default_no_game_this_season": 0, **{f"rate_m_{n}": 9.0 for n in FORMATS}},
            {"default_no_game_this_season": 0, **{f"rate_m_{n}": 9.0 for n in FORMATS}},
        ]
    )
    components = pd.DataFrame({expected_column("receptions"): [1.0, 4.0, 4.0]}).reindex(
        columns=[expected_column(c) for c in ("passing_yards", "passing_touchdowns", "interceptions", "rushing_yards",
                 "rushing_touchdowns", "receiving_yards", "receiving_touchdowns", "receptions", "fumbles_lost")],  # fmt: skip
        fill_value=0.0,
    )
    found = points(rows, components, np.array([True, True, False]))
    assert found["point_ppr"].iloc[0] == 9.0 and found["point_ppr"].iloc[1] == 4.0
    assert found["point_half"].iloc[1] == 2.0 and found["point_std"].iloc[1] == 0.0
    assert np.isnan(found["point_ppr"].iloc[2])
