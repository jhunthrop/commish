# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""The rest-of-season model in the nightly: the switch, a week as the model reads it, the prior, the
player's input, and the in-season format basis."""

from datetime import UTC, datetime

import pytest

from research.errors import ConfigurationError
from research.model.ros.live import (
    FIRST_MODEL_WEEK,
    ClubSlates,
    PlayerWeeks,
    WeekFacts,
    Window,
    game_played,
    player_to_date,
    stale_prior,
    window_of,
)
from research.model.ros.raw_line import RawLine, line_of, payload_of
from research.model.ros.scratch import check_target_url
from research.model.ros.ship import first_difference
from research.nightly.build.player_season import SCORING
from research.nightly.build.ros import RosBasis, carried
from research.nightly.build.season import format_json, month_day, read_week_templates
from research.nightly.config import RUN_FORMATS
from research.nightly.reads.record import method

_SERVED = {"ppr": 200.0, "half": 170.0, "std": 140.0}


def test_the_switch_reads_the_first_week_still_to_play() -> None:
    assert FIRST_MODEL_WEEK == 6  # the founder's ruling of 2026-10-15; the preregistration named week 7
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


def test_the_prior_is_the_raw_lines_points_a_game_in_each_format() -> None:
    line = {"ppr": 10.0, "half": 8.75, "std": 7.5}
    entry = stale_prior(line, _SERVED, 15.3)
    assert entry.per_game == line  # the raw line's own split, never the served boards' ratio
    assert entry.availability == pytest.approx(0.9)
    assert stale_prior(None, _SERVED, 15.3).per_game is None  # no raw line for him: the off-board rate


def test_the_raw_line_reads_back_and_a_format_it_lacks_is_named() -> None:
    line = RawLine(2026, "2026-09-09T02:20:29.697Z", "research@abc", {"p": {"ppr": 10.0, "half": 8.5, "std": 7.0}})
    assert line_of(payload_of(line)) == line
    short = RawLine(2026, line.as_of, line.model_version, {"p": {"ppr": 10.0, "half": 8.5}})
    assert carried(line) == {"ppr", "half", "std"}
    assert carried(short) == {"ppr", "half"}


def test_the_one_shot_fit_still_refuses_any_number_off_the_judged_record() -> None:
    judged = {"shrinkage": {"WR|ppr": {"k": 1.5, "alpha": 0.5}}, "availabilityK": {"WR": 8.0}}
    assert first_difference(judged, judged) is None
    moved = {**judged, "availabilityK": {"WR": 8.000000001}}
    assert first_difference(moved, judged) == "availabilityK"
    assert first_difference({**judged, "rawLine": {}}, judged) == "rawLine"


def test_the_record_says_it_grades_the_preseason_board() -> None:
    assert method(()).startswith("Each week our preseason board froze ")


def test_the_players_input_stops_at_the_lines_and_ranks_from_the_window() -> None:
    weeks = {
        1: WeekFacts({"receptions": 4.0}, {"offensive_snaps": 30.0, "team_offensive_snaps": 60.0}),
        2: WeekFacts({"receptions": 6.0}, {"offensive_snaps": 30.0, "team_offensive_snaps": 60.0}),
        6: WeekFacts({"receptions": 9.0}, {}),  # a week past the lines' reach is not read
    }
    who = PlayerWeeks("p", "WR", "KC", {1: "KC", 2: "BUF"}, weeks)
    schedule = {"KC": [1, 2, 3, 4, 5, 6, 7], "BUF": [1, 2, 3, 5, 6, 8, 9, 17, 18]}
    player = player_to_date(
        who, Window(7, 5), ClubSlates(schedule, schedule), stale_prior(None, _SERVED, 17.0), SCORING
    )
    assert player.club_weeks == (1, 2, 3, 5)  # his latest club is Buffalo
    assert [g.week for g in player.played] == [1, 2]
    assert player.remaining_weeks == (8, 9, 17)  # Buffalo plays weeks 8, 9 and 17 from week 7
    assert player.streak == 2
    # Lane 86: Buffalo's week 8 game kicked off, so his rest of season is weeks 9 and 17.
    played_eight = {**schedule, "BUF": [9, 17, 18]}
    later = player_to_date(
        who, Window(7, 5), ClubSlates(schedule, played_eight), stale_prior(None, _SERVED, 17.0), SCORING
    )
    assert later.remaining_weeks == (9, 17)


def test_the_in_season_basis_names_the_rest_of_the_season_and_the_refresh() -> None:
    rest = RosBasis(7, 6, datetime(2026, 10, 21, 3, 30, tzinfo=UTC))  # 23:30 on October 20 in New York
    assert month_day(rest.refreshed_at) == "October 20"
    shown = format_json(RUN_FORMATS[0], 2026, rest)
    assert shown["basis"] == [
        "PPR, rest of the 2026 season from week 7, refreshed October 20",
        "ranked by points over replacement in a 12-team league",
        "tiers drawn within each position",
    ]
    assert (shown["rosFromWeek"], shown["rosThroughWeek"], shown["refreshedAt"]) == (7, 6, "2026-10-21T03:30:00.000Z")
    assert shown["rosFromWeekPartial"] is False
    # Lane 86: while a game of the first week is played, the words say it counts that week's games left.
    partly = format_json(RUN_FORMATS[0], 2026, RosBasis(6, 5, rest.refreshed_at, partial=True))
    assert partly["basis"][0] == "PPR, rest of the 2026 season from week 6's games left, refreshed October 20"
    assert (partly["rosFromWeek"], partly["rosFromWeekPartial"]) == (6, True)
    preseason = format_json(RUN_FORMATS[0], 2026)
    assert "rosFromWeek" not in preseason
    assert "rosFromWeekPartial" not in preseason
    assert preseason["basis"][:2] == ["PPR, full 2026 season", "projected before the season's first kickoff"]


@pytest.mark.parametrize(
    "url",
    [
        "postgres://commish:commish@localhost:5432/commish",
        "postgres://commish:commish@localhost/commish",  # no port: libpq's 5432
        "postgres://commish:commish@127.0.0.1/commish",
        "postgres://commish:commish@[::1]/commish",
        "postgres://u:p@prod.example:6543/commish_test",  # the parity database, anywhere
    ],
)
def test_the_one_shot_guard_refuses_dev_and_the_parity_database(url: str) -> None:
    with pytest.raises(ConfigurationError):
        check_target_url(url)


def test_the_one_shot_guard_admits_an_explicit_other_store() -> None:
    check_target_url("postgres://u:p@localhost:6543/commish")  # a proxy on another port
    check_target_url("postgres://commish:commish@localhost:5433/lane18_live")


def test_the_week_templates_are_checked_when_read() -> None:
    """Re-review N3: the words table's week templates are read once, when the module loads, and a
    template missing or without exactly one week slot fails then, never at a format's words."""
    assert read_week_templates(
        '{"restFrom": "from week {week}", "restFromPartial": "from week {week}\'s games left"}'
    ) == {
        "restFrom": "from week {week}",
        "restFromPartial": "from week {week}'s games left",
    }
    for broken in ('{"restFrom": "from week {week}"}', '{"restFrom": "from week", "restFromPartial": "{week}"}',
                   '{"restFrom": "{week} {week}", "restFromPartial": "{week}"}'):  # fmt: skip
        with pytest.raises(ValueError, match="week template"):
            read_week_templates(broken)
