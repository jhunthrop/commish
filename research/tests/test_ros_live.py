# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""The rest-of-season model in the nightly: the switch, a week as the model reads it, the prior, the
player's input, and the in-season format basis."""

from datetime import UTC, datetime

import pytest

from research.model.ros.live import (
    FIRST_MODEL_WEEK,
    PlayerWeeks,
    RawPrior,
    WeekFacts,
    Window,
    game_played,
    player_to_date,
    stale_prior,
    window_of,
)
from research.nightly.build.player_season import SCORING
from research.nightly.build.ros import RosBasis
from research.nightly.build.season import format_json, month_day
from research.nightly.config import RUN_FORMATS

_SERVED = {"ppr": 200.0, "half": 170.0, "std": 140.0}


def test_the_switch_reads_the_first_week_still_to_play() -> None:
    assert FIRST_MODEL_WEEK == 6
    assert window_of([6, 7, 18], through=5) == Window(6, 5)
    assert window_of([7, 8], through=5) == Window(7, 5)  # week 6's lines not yet in: the window still starts at 7
    assert window_of([5, 6], through=4) == "week 5 is before the switch week (6)"
    assert window_of([18], through=17) == "week 18 is past week 17, the last the model ranks"
    assert window_of([], through=17) == "the season's schedule has no game left to play"
    assert window_of([6], through=0) == "the store holds no week of this season's lines"


def test_a_week_is_played_with_a_stat_line_or_snaps() -> None:
    line = WeekFacts(
        {"receptions": 5.0, "receiving_yards": 60.0, "targets": 8.0, "carries": 1.0},
        {"offensive_snaps": 40.0, "team_offensive_snaps": 50.0},
    )
    game = game_played(3, line, "WR", SCORING)
    assert game is not None
    assert game.points == {"ppr": 11.0, "half": 8.5, "std": 6.0}
    assert (game.targets, game.carries, game.pass_attempts, game.snap_share) == (8.0, 1.0, 0.0, 0.8)
    snaps_only = game_played(
        4, WeekFacts({"targets": 0.0}, {"offensive_snaps": 3.0, "team_offensive_snaps": 60.0}), "WR", SCORING
    )
    assert snaps_only is not None
    assert snaps_only.points == {"ppr": 0.0, "half": 0.0, "std": 0.0}
    assert game_played(5, WeekFacts({}, {"offensive_snaps": 0.0}), "WR", SCORING) is None


def test_the_prior_is_the_raw_points_a_game_carried_by_the_served_ratio() -> None:
    entry = stale_prior(RawPrior("p", 150.0, 15.0), _SERVED, 15.3)
    assert entry.per_game == pytest.approx({"ppr": 10.0, "half": 8.5, "std": 7.0})
    assert entry.availability == pytest.approx(0.9)
    assert stale_prior(None, _SERVED, 15.3).per_game is None
    assert stale_prior(RawPrior("p", 10.0, 0.0), _SERVED, 15.3).per_game is None


def test_the_players_input_stops_at_the_lines_and_ranks_from_the_window() -> None:
    weeks = {
        1: WeekFacts({"receptions": 4.0}, {"offensive_snaps": 30.0, "team_offensive_snaps": 60.0}),
        2: WeekFacts({"receptions": 6.0}, {"offensive_snaps": 30.0, "team_offensive_snaps": 60.0}),
        6: WeekFacts({"receptions": 9.0}, {}),  # a week past the lines' reach is not read
    }
    who = PlayerWeeks("p", "WR", "KC", {1: "KC", 2: "BUF"}, weeks)
    schedule = {"KC": [1, 2, 3, 4, 5, 6, 7], "BUF": [1, 2, 3, 5, 6, 8, 9, 17, 18]}
    player = player_to_date(who, Window(6, 5), schedule, stale_prior(None, _SERVED, 17.0), SCORING)
    assert player.club_weeks == (1, 2, 3, 5)  # his latest club is Buffalo
    assert [g.week for g in player.played] == [1, 2]
    assert player.remaining_weeks == (6, 8, 9, 17)
    assert player.streak == 2


def test_the_in_season_basis_names_the_rest_of_the_season_and_the_refresh() -> None:
    rest = RosBasis(6, 5, datetime(2026, 10, 14, 3, 30, tzinfo=UTC))  # 23:30 on October 13 in New York
    assert month_day(rest.refreshed_at) == "October 13"
    shown = format_json(RUN_FORMATS[0], 2026, rest)
    assert shown["basis"] == [
        "PPR, rest of the 2026 season from week 6, refreshed October 13",
        "ranked by points over replacement in a 12-team league",
        "tiers drawn within each position",
    ]
    assert (shown["rosFromWeek"], shown["rosThroughWeek"], shown["refreshedAt"]) == (6, 5, "2026-10-14T03:30:00.000Z")
    preseason = format_json(RUN_FORMATS[0], 2026)
    assert "rosFromWeek" not in preseason
    assert preseason["basis"][:2] == ["PPR, full 2026 season", "projected before the season's first kickoff"]
