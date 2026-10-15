"""No fit and no gate reads the product season's outcomes: launch 2027 on 2026 held out.

The weekly pass now stores the product season's play-by-play and charted feeds, so every season
window a fit is taken over, and every season a gate judges, must still end before the product
season: the unported fits' inputs (`model.fit_inputs`), the game-variance fit, the rest-of-season
rounds' fit, opportunity and judgment seasons, and the fit step's ingested seasons.
"""

from research.model.fit_check import INGESTED_SEASONS
from research.model.fit_inputs import FIT_INPUTS
from research.model.fits.game_variance import HELD_OUT_SEASONS, TRAIN_SEASONS
from research.model.ros import gates
from research.season import PRODUCT_SEASON


def test_no_unported_fit_reads_the_product_season() -> None:
    for fit, inputs in FIT_INPUTS.items():
        for item in inputs:
            assert max(item.seasons) < PRODUCT_SEASON, f"{fit} reads {item.name} for {max(item.seasons)}"


def test_the_game_variance_fit_holds_the_product_season_out() -> None:
    assert max(TRAIN_SEASONS) < PRODUCT_SEASON
    assert PRODUCT_SEASON in HELD_OUT_SEASONS


def test_no_rest_of_season_round_fits_or_judges_on_the_product_season() -> None:
    rounds = [value for value in vars(gates).values() if isinstance(value, gates.Thresholds)]
    assert rounds, "the rounds are named in model/ros/gates.py"
    for thresholds in rounds:
        seasons = (*thresholds.fit_seasons, *thresholds.opportunity_seasons, thresholds.judgment_season)
        assert max(seasons) < PRODUCT_SEASON, thresholds


def test_the_fit_step_rebuilds_only_finished_seasons() -> None:
    assert max(INGESTED_SEASONS) < PRODUCT_SEASON
