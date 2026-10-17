# ruff: noqa: PLR2004 - the expected values are hand-computed from the games written beside them
"""Round 4's shares (preregistration section 2.2): season to date, last three, decayed by his games'
age, the prior season's; vacated shares from withheld teammates who played in one of the club's last
three games; and returning shares only with the evidence a return needs (a week-W filing that is not
Out or Doubtful, or a week-W depth-chart row), a teammate without it counted as absent."""

import math
from dataclasses import replace

import pytest

from research.model.weekly4.features.plays import Counts
from research.model.weekly4.features.shares import (
    GameShare,
    decayed_share,
    last_three_share,
    season_share,
)
from research.model.weekly4.features.teammates import Teammates, returning, vacated

_TEAM = Counts(targets=10.0, carries=20.0, air_yards=100.0, red_zone=4.0, inside_ten=0.0, dropbacks=30.0)


def _game(week: int, targets: float, club: str = "KC") -> GameShare:
    return GameShare(week, club, Counts(targets=targets, air_yards=targets * 10), _TEAM, 0.8)


def test_season_last_three_and_decayed_shares_are_ratios_of_his_games_sums() -> None:
    games = (_game(1, 1.0), _game(2, 2.0), _game(3, 3.0), _game(4, 4.0))
    assert season_share(games, "targets") == pytest.approx(10.0 / 40.0)
    assert last_three_share(games, "targets") == pytest.approx(9.0 / 30.0)
    weights = (0.125, 0.25, 0.5, 1.0)
    expected = sum(w * t for w, t in zip(weights, (1.0, 2.0, 3.0, 4.0), strict=True)) / (10.0 * sum(weights))
    assert decayed_share(games, "targets", 0.5) == pytest.approx(expected)
    assert decayed_share(games, "targets", 1.0) == season_share(games, "targets")


def test_a_kind_the_club_never_had_is_a_share_of_zero_and_no_game_is_nan() -> None:
    games = (_game(1, 1.0),)
    assert season_share(games, "inside_ten") == 0.0
    assert math.isnan(season_share((), "targets"))


def _mates() -> Teammates:
    histories = {
        "out": (_game(3, 5.0), _game(4, 5.0), _game(5, 5.0)),
        "hurt_long": (_game(1, 4.0),),
        "back": (_game(1, 3.0), _game(2, 3.0)),
        "back_no_word": (_game(1, 2.0), _game(2, 2.0)),
        "back_on_chart": (_game(1, 1.0), _game(2, 1.0)),
        "never_played": (),
        "me": (_game(4, 1.0), _game(5, 1.0)),
    }
    return Teammates(
        club="KC",
        recent_weeks=(3, 4, 5),
        histories=histories,
        clubs=dict.fromkeys(histories, "KC"),
        statuses={"out": "withheld", "hurt_long": "withheld", "back": "questionable", "never_played": "clear"},
        depth=frozenset({"back_on_chart"}),
    )


def test_vacated_counts_withheld_teammates_who_played_in_the_clubs_last_three() -> None:
    found = vacated("me", _mates())
    assert found.counted == 1 and found.left_out == 1
    assert found.shares.targets == pytest.approx(15.0 / 30.0)


def test_returning_needs_a_filing_that_is_not_out_or_a_week_w_chart_row() -> None:
    found = returning("me", _mates())
    assert found.counted == 2  # "back" by his Questionable filing, "back_on_chart" by the chart
    assert found.shares.targets == pytest.approx(6.0 / 20.0 + 2.0 / 20.0)
    assert found.without_evidence == 1  # "back_no_word": no filing never means returned
    assert found.without_pre_absence == 1  # "never_played"


def test_the_absence_ends_with_the_clubs_latest_game_and_its_share_is_the_mean_of_game_shares() -> None:
    small = Counts(targets=5.0)
    histories = {
        "back": (
            GameShare(1, "KC", Counts(targets=1.0), small, 0.5),
            GameShare(2, "KC", Counts(targets=4.0), _TEAM, 0.5),
        ),
        "played_since": (_game(1, 2.0), _game(3, 2.0), _game(5, 2.0)),  # missed week 4 only
        "me": (_game(4, 1.0), _game(5, 1.0)),
    }
    mates = Teammates(
        club="KC",
        recent_weeks=(3, 4, 5),
        histories=histories,
        clubs=dict.fromkeys(histories, "KC"),
        statuses={"back": "questionable", "played_since": "questionable"},
        depth=frozenset(),
        earlier={("back", 3): "withheld"},
    )
    found = returning("me", mates)
    assert found.counted == 1  # "played_since" played the club's latest game: not away
    assert found.shares.targets == pytest.approx((1.0 / 5.0 + 4.0 / 10.0) / 2)
    assert found.without_withheld_filing == 0  # his absence carried an Out filing in week 3
    unfiled = returning("me", replace(mates, earlier={}))
    assert unfiled.without_withheld_filing == 1


def test_on_the_charts_fallback_only_the_filing_is_evidence() -> None:
    mates = _mates()
    found = returning(
        "me", Teammates(mates.club, mates.recent_weeks, mates.histories, mates.clubs, mates.statuses, None)
    )
    assert found.counted == 1 and found.without_evidence == 2
