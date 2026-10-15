# ruff: noqa: PLR2004 - the expected values are the preregistration's numbers and hand-made cases
"""Weekly round 3's constant is the preregistration's section 5 verbatim, the development check
moves only its seasons and its rate record, and G5 needs its per-game clause as well as round 2's."""

from dataclasses import replace

from research.model.ros import gates as ros_gates
from research.model.weekly2.gates import ROUND_TWO
from research.model.weekly3.gates import DEVELOPMENT_CHECK, GATE_LINES, ROUND_THREE, isolation_line


def test_the_constant_is_the_preregistration_verbatim() -> None:
    t = ROUND_THREE
    assert t.model_name == "commish_weekly_v3"
    assert (t.fit_seasons, t.judgment_season, t.weeks) == ((2021, 2022, 2023), 2024, tuple(range(6, 18)))
    assert dict(t.population) == {"QB": 36, "RB": 72, "WR": 108, "TE": 36}
    assert dict(t.starters) == {"QB": 12, "RB": 24, "WR": 24, "TE": 12}
    assert (t.adp_margin, t.form_margin, t.position_floor, t.places_margin) == (0.04, 0.02, -0.02, 0.25)
    assert (t.calibration_low, t.calibration_high, t.calibration_min_size) == (0.05, 0.15, 100)
    assert t.chance_bins == ((0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0))
    assert (t.chance_min_pairs, t.chance_tolerance, t.chance_min_bins) == (200, 0.05, 3)
    assert (t.resamples, t.seed, t.lower_percentile) == (10_000, 42, 2.5)
    assert t.residual_percentiles == tuple(float(p) for p in range(1, 100))
    assert t.band_percentiles == (10.0, 50.0, 90.0)
    assert t.min_week_population == 8
    assert (t.adp_source, t.adp_seasons) == ("ffc_adp_ppr_12", (2023, 2024))
    assert t.rate_round == ros_gates.ROUND_THREE
    assert t.rate_record == "2026-10-14-rest-of-season-round3-results.json"
    assert GATE_LINES == 26


def test_every_threshold_is_round_twos_kept() -> None:
    assert replace(ROUND_TWO, model_name="commish_weekly_v3") == ROUND_THREE


def test_the_development_check_moves_only_the_seasons_and_the_rate() -> None:
    moved = replace(
        ROUND_THREE,
        fit_seasons=(2021, 2022),
        judgment_season=2023,
        adp_seasons=(2023,),
        rate_round=ros_gates.ROUND_THREE_CHECK,
        rate_record="2026-10-14-rest-of-season-round3-dev-check.json",
    )
    assert moved == DEVELOPMENT_CHECK


_DIGESTS = {"model_artifacts": "1:a"}


def test_g5_needs_the_readers_the_tables_and_the_per_game_clause() -> None:
    t = DEVELOPMENT_CHECK
    passed = isolation_line([2021, 2022], [2023], _DIGESTS, _DIGESTS, (True, "12 games"), t)
    assert passed.passed
    assert "per-game clause: 12 games" in passed.detail
    assert not isolation_line([2021, 2022], [2023], _DIGESTS, _DIGESTS, (False, "late"), t).passed
    assert not isolation_line([2021, 2023], [2023], _DIGESTS, _DIGESTS, (True, ""), t).passed
    assert not isolation_line([2021], [2023, 2024], _DIGESTS, _DIGESTS, (True, ""), t).passed
    assert not isolation_line([2021], [2023], _DIGESTS, {"model_artifacts": "2:b"}, (True, ""), t).passed
