"""Lane 66v on the season read's sheet: every points figure prints to the tenth the page prints, so the
writer never copies a stat line's cents (Josh Allen's prose said 17.46 and 18.52 where his game log
printed 17.5 and 18.5; on dev's board 122 of the written pages carried such a figure)."""

from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

from research.capsules.facts.model import RankedStat, SeasonSoFar, SeasonTotals, SeasonWeek
from research.capsules.render import _story_line, _trend_line
from research.capsules.render_depth import _prior_seasons, _volatility
from research.capsules.render_season import season_section

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts
    from research.capsules.facts.depth_model import Depth


def _facts(**fields: object) -> "PlayerFacts":
    return cast("PlayerFacts", SimpleNamespace(**fields))


def test_his_weeks_this_season_print_to_the_tenth() -> None:
    weeks = (SeasonWeek(3, "played", 17.46), SeasonWeek(4, "played", 18.52))
    totals = SeasonTotals(None, None, None, None, None, None, None, 35.98)
    section = season_section(_facts(season=SeasonSoFar(2026, 5, 2, 18.0, totals, weeks, None), product_season=2026))
    assert "week 3 of 2026, played, 17.5 points" in section
    assert "week 4 of 2026, played, 18.5 points" in section
    assert "17.46" not in section and "18.52" not in section


def test_last_seasons_best_week_and_points_a_game_trend_print_to_the_tenth() -> None:
    metric = SimpleNamespace(
        material=True, delta=4.66, prior_value=18.78, prior_season=2024, recent_value=23.44, recent_season=2025
    )
    trend = SimpleNamespace(points_per_game=metric, yards_per_opportunity=None, target_share=None)
    line = _trend_line(_facts(trend=trend, identity=SimpleNamespace(position="QB")))
    assert line == "His points per game rose from 18.8 in 2024 to 23.4 in 2025."
    rank = RankedStat(363.36, 1, 81, None)
    story = SimpleNamespace(
        season=2025,
        points_rank=rank,
        games_played=16,
        points_per_game=22.71,
        best_week=SimpleNamespace(week=11, points=42.68),
        weeks_above_median=13,
        touches_rank=None,
        receiving_yards_rank=RankedStat(310.0, 12, 81, None),
    )
    told = _story_line(_facts(last_season_story=story, identity=SimpleNamespace(position="QB"))) or ""
    assert "His best week was week 11 of 2025 with 42.7 points." in told


def test_his_worst_week_and_prior_seasons_print_to_the_tenth() -> None:
    swing = SimpleNamespace(
        threshold=15,
        weeks_above_threshold=10,
        weeks_played=17,
        season=2025,
        worst_week=SimpleNamespace(week=7, points=4.68),
    )
    told = _volatility(cast("Depth", SimpleNamespace(volatility=swing))) or ""
    assert "his worst was 4.7 in week 7 of 2025" in told
    prior = SimpleNamespace(season=2024, points=301.36, games_played=17, position_rank=3, qualifier_count=40)
    depth = SimpleNamespace(prior_seasons=(prior,))
    seasons = _prior_seasons(_facts(depth=depth, identity=SimpleNamespace(position="QB"))) or ""
    assert "301.4 points over 17 games" in seasons
