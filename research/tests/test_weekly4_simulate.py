"""The simulation of a game (2.6): the named seed, the shared margin and volume, the allocation, each
opportunity's outcome, the mean against the point, floor, median and ceiling, and the paired chance."""

import hashlib

import numpy as np
import pandas as pd
import pytest

from research.model.weekly4.point import Constants, analytic_points
from research.model.weekly4.simulate import (
    Dispersion,
    Simulated,
    bands,
    game_seed,
    mean_check,
    paired_chance,
    simulate_game,
)

CONSTANTS = Constants(scramble_yards=6.0, scramble_touchdowns=0.02, residual_target_td=0.04, residual_carry_td=0.03)


def test_the_seed_is_the_sha256_of_the_named_text() -> None:
    digest = hashlib.sha256(b"2023:2023:7:BUF").digest()
    assert game_seed(2023, 2023, 7, "BUF") == int.from_bytes(digest[:8], "big")


def _club(club: str, opponent: str, home: float, spread: float) -> list[dict[str, object]]:
    base: dict[str, object] = {
        "season": 2023,
        "week": 7,
        "game_id": "2023_07_BBB_AAA",
        "club": club,
        "opponent": opponent,
        "home": home,
        "spread": spread,
        "withheld": 0,
        "default_no_game_this_season": 0,
        "rate_m_ppr": 9.0,
        "rate_m_half": 8.0,
        "rate_m_std": 7.0,
        "exp_plays": 64.0,
        "exp_dropbacks": 40.0,
        "exp_sacks": 2.0,
        "exp_rushing_touchdowns": 1.0,
        "exp_receiving_touchdowns": 1.5,
        "target_rate": 0.9,
        "residual_targets": 0.1,
        "residual_carries": 0.1,
        "residual_dropbacks": 0.0,
        "target_wx_catch": 0.6,
        "target_wx_yards": 7.0,
        "target_wx_td": 0.04,
        "carry_wx_yards": 4.0,
        "carry_wx_td": 0.03,
        "dropback_wx_pass_yards": 6.5,
        "dropback_wx_interception": 0.02,
        "target_catch_factor": 1.0,
        "target_yards_over": 0.0,
        "target_td_factor": 1.0,
        "carry_yards_over": 0.0,
        "carry_td_factor": 1.0,
        "dropback_yards_over": 0.0,
        "dropback_scramble_rate": 0.05,
        **{f"allow_{k}_{f}": 0.0 for k in ("target", "carry", "dropback") for f in ("ppr", "half", "std")},
    }
    players = [("qb", "QB", 0.0, 0.05, 1.0), ("wr", "WR", 0.5, 0.0, 0.0), ("rb", "RB", 0.4, 0.85, 0.0)]
    return [
        {
            **base,
            "player_id": f"{club}-{p}",
            "position": pos,
            "share_targets": t,
            "share_carries": c,
            "share_dropbacks": d,
        }
        for p, pos, t, c, d in players
    ]


def _game() -> pd.DataFrame:
    board = pd.DataFrame([*_club("AAA", "BBB", 1.0, 3.0), *_club("BBB", "AAA", 0.0, -3.0)])
    return board.join(
        analytic_points(board, CONSTANTS).drop(columns=["season", "week", "club", "player_id", "position"])
    )


DISPERSION = Dispersion(
    margin_sd=13.0,
    script_slope=-0.004,
    plays_dispersion=40.0,
    plays_sd=6.0,
    concentration={
        ("QB", "dropbacks"): 200.0,
        ("WR", "targets"): 30.0,
        ("RB", "targets"): 30.0,
        ("RB", "carries"): 30.0,
    },
    yards_sd={"target": 9.0, "carry": 5.0, "dropback": 8.0},
    scale={"QB": 1.0, "RB": 1.0, "WR": 1.0, "TE": 1.0},
)


def test_the_simulation_is_deterministic_and_its_mean_is_the_point() -> None:
    game = _game()
    first = simulate_game(game, DISPERSION, CONSTANTS, run_seed=2023, draws=10_000)
    second = simulate_game(game, DISPERSION, CONSTANTS, run_seed=2023, draws=10_000)
    assert np.array_equal(first.points["ppr"], second.points["ppr"])
    for i, pid in enumerate(first.players):
        point = float(game.set_index("player_id")["point_ppr"].to_dict()[pid])
        assert first.points["ppr"][i].mean() == pytest.approx(point, rel=0.03, abs=0.25)
    breaches = mean_check(first, game)
    assert breaches == []


def test_the_bands_and_the_scale() -> None:
    simulated = simulate_game(_game(), DISPERSION, CONSTANTS, run_seed=2023, draws=4_000)
    floor, median, ceiling = bands(simulated, "ppr", {"QB": 1.0, "RB": 1.0, "WR": 1.0, "TE": 1.0})
    assert (floor <= median).all() and (median <= ceiling).all()
    wide = bands(simulated, "ppr", {"QB": 2.0, "RB": 2.0, "WR": 2.0, "TE": 2.0})
    assert (wide[2] - wide[0] >= ceiling - floor - 1e-9).all()


def test_teammates_share_a_draw_and_the_chance_is_paired() -> None:
    simulated = simulate_game(_game(), DISPERSION, CONSTANTS, run_seed=2023, draws=4_000)
    a = simulated.points["ppr"][simulated.players.index("AAA-wr")]
    b = simulated.points["ppr"][simulated.players.index("AAA-rb")]
    chance = paired_chance(a, b)
    assert chance == pytest.approx(float(np.mean(a > b) + 0.5 * np.mean(a == b)))
    qb = simulated.points["ppr"][simulated.players.index("AAA-qb")]
    assert np.corrcoef(qb, a)[0, 1] > 0.0  # one game script: the passer and his receiver move together
    assert isinstance(simulated, Simulated)
