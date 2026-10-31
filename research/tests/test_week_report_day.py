"""Lane 96, B16: the week read names the injury report by the day the clubs issued it, and turns to the
next week by his club's game state.

The Gibbs read "written Sun 12:01 am for week 6" cited "no designation on Sunday's report": the sheet named
the report by the day we read the list, and no report is issued on a Sunday. The sheet now names the game
status report of the game in front of him (Friday for a Sunday game), and before that report is out it
names the list by its read and the report to come; the validator refuses a read naming any other day."""

from dataclasses import replace
from datetime import UTC, datetime

from research.capsules.week.collect import club_week
from research.capsules.week.render import render_week_sheet
from research.capsules.week.report_day import report_words, status_report_day
from research.capsules.week.rules import week_rule_violations
from research.capsules.week.sheet import Status, WeekGame
from research.nightly.reads.schedule import Game
from research.tests.week_read_fixtures import KICKOFF, on_bye, starter

# Sunday 2026-10-18, 12:01 am Central: the night the Gibbs read was written.
SUNDAY_NIGHTLY = datetime(2026, 10, 18, 5, 1, tzinfo=UTC)
# The list as it stood at midnight Eastern, Saturday 11 pm Central.
SATURDAY_LIST = datetime(2026, 10, 18, 4, 0, tzinfo=UTC)
# Tuesday 2026-10-20, 12:00 am Central: the nightly after Monday night's game.
TUESDAY_NIGHTLY = datetime(2026, 10, 20, 5, 0, tzinfo=UTC)
BYE_WEEK = 6
NEXT_WEEK = 7
GIBBS_NEXT = WeekGame(NEXT_WEEK, "GB", home=True, kickoff=datetime(2026, 10, 25, 20, 25, tzinfo=UTC))


def test_the_game_status_report_is_two_days_before_and_the_day_before_a_thursday_game() -> None:
    days = {
        "Sunday": datetime(2026, 10, 18, 17, 0, tzinfo=UTC),
        "Monday": datetime(2026, 10, 20, 0, 15, tzinfo=UTC),
        "Thursday": datetime(2026, 10, 23, 0, 15, tzinfo=UTC),
        "Saturday": datetime(2026, 12, 19, 21, 30, tzinfo=UTC),
    }
    issued = {game: status_report_day(kickoff).strftime("%A") for game, kickoff in days.items()}
    assert issued == {"Sunday": "Friday", "Monday": "Saturday", "Thursday": "Wednesday", "Saturday": "Thursday"}


def test_a_status_seen_after_the_report_names_its_day() -> None:
    friday_evening = datetime(2026, 10, 16, 21, 0, tzinfo=UTC)
    game = WeekGame(6, "ARI", True, KICKOFF)
    assert report_words(Status(None, friday_evening), SUNDAY_NIGHTLY, game) == "Friday's report"


def test_a_list_changed_the_day_after_the_report_says_so() -> None:
    """Review M3: a Saturday downgrade is not Friday's report."""
    saturday = datetime(2026, 10, 17, 18, 0, tzinfo=UTC)
    game = WeekGame(6, "ARI", True, KICKOFF)
    assert report_words(Status("out", saturday), SUNDAY_NIGHTLY, game) == "Friday's report, updated Saturday"
    sheet = replace(starter(), written_at=SUNDAY_NIGHTLY, status=Status("out", saturday))
    assert "Out on Friday's report, updated Saturday" in render_week_sheet(sheet)
    said = "Puka Nacua is Out on Friday's report, updated Saturday. Sit him. The Rams play at home."
    assert not [v for v in week_rule_violations(said, sheet, "sit") if "report the facts" in v]


def test_a_status_seen_before_the_report_names_the_list_and_the_report_to_come() -> None:
    words = report_words(Status(None, SATURDAY_LIST), SUNDAY_NIGHTLY, GIBBS_NEXT)
    assert words == "the injury list as of Saturday 11:00 pm Central, before week 7's game status report on Friday"


def test_the_last_check_of_the_list_counts_once_it_came_by_the_write() -> None:
    thursday = datetime(2026, 10, 15, 22, 0, tzinfo=UTC)
    saturday = datetime(2026, 10, 17, 15, 0, tzinfo=UTC)
    assert Status(None, thursday, saturday).seen_at(SUNDAY_NIGHTLY) == saturday
    assert Status(None, thursday, SUNDAY_NIGHTLY.replace(hour=9)).seen_at(SUNDAY_NIGHTLY) == thursday
    friday = datetime(2026, 10, 17, 1, 0, tzinfo=UTC)
    sheet = replace(starter(), status=Status("questionable", thursday, friday))
    assert "Questionable on Friday's report" in render_week_sheet(sheet)


def test_the_gibbs_sheet_never_names_a_sunday_report() -> None:
    sheet = replace(on_bye(), written_at=SUNDAY_NIGHTLY, game=GIBBS_NEXT, status=Status("questionable", SATURDAY_LIST))
    text = render_week_sheet(sheet)
    assert "Sunday's report" not in text
    assert "Questionable on the injury list as of Saturday 11:00 pm Central" in text
    # The words name no season (review L2): a read that quotes them has named it already.
    assert "game status report on Friday," in text


def test_a_read_naming_a_report_the_facts_do_not_is_refused() -> None:
    sheet = replace(on_bye(), written_at=SUNDAY_NIGHTLY, game=GIBBS_NEXT, status=Status(None, SATURDAY_LIST))
    read = (
        "Gibbs and the Lions are on their bye in week 6 of 2026, so he scores nothing this week. "
        "He carries no designation on Sunday's report. Keep him on your roster for week 7."
    )
    found = [v for v in week_rule_violations(read, sheet, "sit") if "Sunday's report" in v]
    assert len(found) == 1 and "before week 7's game status report on Friday" in found[0]
    # Review L1: a report or list named by its day in any form is held to the sheet's.
    for other in ("on the Tuesday report", "on Tuesday's practice report", "on Sunday's injury list"):
        assert [
            v
            for v in week_rule_violations(read.replace("on Sunday's report", other), sheet, "sit")
            if "report the facts" in v
        ]
    ahead = read.replace(
        "on Sunday's report", "on the injury list as of Saturday night, before week 7's game status report on Friday"
    )
    assert not [v for v in week_rule_violations(ahead, sheet, "sit") if "report the facts do not name" in v]


def test_a_read_naming_the_issued_report_passes_and_another_day_does_not() -> None:
    sheet = starter()
    good = "He has no designation on Friday's report. Start him. The Rams play at home."
    bad = good.replace("Friday's", "Tuesday's")
    # Review R1-L2: the report's kind word names no other report.
    injury = good.replace("Friday's report", "Friday's injury report")
    assert not [v for v in week_rule_violations(injury, sheet, "start") if "report the facts" in v]
    assert [
        v for v in week_rule_violations(injury.replace("Friday", "Tuesday"), sheet, "start") if "report the facts" in v
    ]
    assert not [v for v in week_rule_violations(good, sheet, "start") if "report the facts" in v]
    assert [v for v in week_rule_violations(bad, sheet, "start") if "Tuesday's report" in v]


def test_a_bye_turns_to_the_next_week_once_every_game_of_his_bye_week_has_kicked_off() -> None:
    detroit = [
        Game(5, "CIN", False, datetime(2026, 10, 11, 17, 0, tzinfo=UTC)),
        Game(7, "GB", True, GIBBS_NEXT.kickoff),
    ]
    # Sunday's nightly: week 6 still has games to kick off, so his week is the bye.
    sunday = club_week(detroit, 6, SUNDAY_NIGHTLY)
    assert sunday is not None and sunday.week == BYE_WEEK and sunday.bye
    # Tuesday's nightly: every week 6 game is over, the first week with a game to kick off is 7.
    tuesday = club_week(detroit, 7, TUESDAY_NIGHTLY)
    assert tuesday is not None and tuesday.week == NEXT_WEEK and not tuesday.bye and tuesday.game == detroit[1]


def test_a_player_whose_game_has_kicked_off_reads_the_next_week() -> None:
    seattle = [
        Game(6, "DEN", False, datetime(2026, 10, 16, 0, 15, tzinfo=UTC)),
        Game(7, "ARI", True, GIBBS_NEXT.kickoff),
    ]
    found = club_week(seattle, 6, SUNDAY_NIGHTLY)
    assert found is not None and found.week == NEXT_WEEK and found.game == seattle[1]
