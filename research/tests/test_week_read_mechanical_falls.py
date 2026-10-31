"""Lane 303: the week reads the 2026-10-30T05 nightly lost to mechanical rules, each sentence as the nightly's report
quoted it.

- The season said once (`season_words.said_once`): the first week the read names takes the season, a repeat after
  it is dropped, and a prior season named on purpose is never touched.
- The name check (B306): a pronoun and his designation, and the call's imperative before his surname, are words.
- The report day (B307): the sheet states the game status report's day, and a read may name it by that day; any
  other day is refused, and a report not out yet is never cited for what it says.
- The openers: the call in the writer's forms and a backup's place on the chart open a read; a scene set on the
  opponent does not.
- "Lines up" and "line up" are football, never the site's betting line.
"""

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from research.capsules.grounding import is_name_grounded, proper_name_phrases
from research.capsules.season_voice import SeasonClock, time_frame_hits
from research.capsules.voice_rules import writer_only_hits
from research.capsules.week.render import render_week_sheet
from research.capsules.week.report_day import report_day, report_day_line, report_issued, report_out
from research.capsules.week.rules import body_rule_violations, week_rule_violations
from research.capsules.week.season_words import said_once
from research.capsules.week.sheet import DepthPlace, Status, WeekGame, WeekSheet
from research.capsules.week.validate import validate_week_read, with_season
from research.tests.week_read_fixtures import on_bye, starter

SEASON = 2026
# The nightly of 2026-10-30, 12:30 am Central; the list as of Thursday 11:00 pm Central; a Sunday and a Monday game.
WRITTEN = datetime(2026, 10, 30, 5, 30, tzinfo=UTC)
THURSDAY_LIST = datetime(2026, 10, 30, 4, 0, tzinfo=UTC)
SATURDAY_LIST = datetime(2026, 10, 31, 15, 0, tzinfo=UTC)
SUNDAY = datetime(2026, 11, 1, 18, 0, tzinfo=UTC)
MONDAY = datetime(2026, 11, 3, 1, 15, tzinfo=UTC)


def _week_eight(kickoff: datetime = SUNDAY, seen: datetime = THURSDAY_LIST) -> WeekSheet:
    written = max(WRITTEN, seen)
    return replace(
        starter(), week=8, written_at=written, game=WeekGame(8, "MIN", True, kickoff), status=Status(None, seen)
    )


def _season_hits(text: str) -> list[str]:
    return [hit.rule for hit in time_frame_hits(with_season(text, SEASON), SeasonClock(SEASON, 7))]


# --- the season said once ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "written",
    [
        "Keep Nailor on the bench for week 8.",
        "He put up 0 PPR points in week 7 and averages 1.9 PPR points a game this season.",
        "He had 12 PPR points last week.",
    ],
)
def test_a_bare_week_stands_with_no_season(written: str) -> None:
    """Lane 307 retired the season on every week: the pass never adds one, and the validator reads a bare week as
    this season's, so "week 8" and "last week" are a read's own words."""
    assert said_once(written, SEASON) == written
    assert _season_hits(with_season(written, SEASON)) == []


def test_a_repeated_season_after_the_first_is_dropped() -> None:
    written = "He had 20 PPR points in week 6 of 2026 and 4 PPR points in week 7 of 2026. Sit him in week 8 of 2026."
    said = said_once(written, SEASON)
    assert said == "He had 20 PPR points in week 6 of 2026 and 4 PPR points in week 7. Sit him in week 8."
    assert not [v for v in week_rule_violations(said, starter(), "sit") if "names the season" in v]
    assert _season_hits(said) == []


def test_a_week_before_the_first_season_stands_and_the_later_one_keeps_its_season() -> None:
    written = "It produced nothing in week 7. He has 3.6 PPR points in week 6 of 2026."
    assert said_once(written, SEASON) == written


def test_a_prior_season_named_on_purpose_is_never_touched() -> None:
    for kept in (
        "He scored 20 PPR points in week 3 of 2025, and nothing like it since.",
        "In 2025 he was a starter. He is not one now.",
        "Last season he had 30 PPR points in week 8. Sit him.",
    ):
        assert said_once(kept, SEASON) == kept, kept
    # A week in a sentence about another season keeps its season even after the read named this one.
    both = "Sit him in week 8 of 2026. He scored in week 3 of 2025 and week 3 of 2026."
    assert said_once(both, SEASON) == both
    # This season said any way but beside a week is the rule's to refuse, never dropped; and a repeat followed by
    # a word, not a possessive or clause punctuation, is the rule's too (the review's H2).
    other = "His best game of 2026 is 13.8 PPR points, and week 7 of 2026 brought 3.6 PPR points."
    assert said_once(other, SEASON) == other
    ended = "His best game of 2026 is 13.8 PPR points, and he had 3.6 PPR points in week 7 of 2026."
    assert said_once(ended, SEASON) == "His best game of 2026 is 13.8 PPR points, and he had 3.6 PPR points in week 7."


def test_the_written_read_with_a_bare_week_passes() -> None:
    """Lane 307: a read that names no season passes, the bare week read as this season's."""
    sheet = _week_eight()
    read = (
        "Puka Nacua has 25.9 PPR points a game, the best of his career. He has no designation before week 8's game "
        "status report on Friday. Start him at home against Minnesota, where the dome keeps the weather out of it."
    )
    violations = validate_week_read(said_once(read, SEASON), sheet, call="start").violations
    assert not any("a week without its season" in v or "names the season" in v for v in violations), violations


# --- the name check (B306) -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "said", ["He's Questionable on the list.", "His Questionable tag stands.", "He's Doubtful.", "He's Out for Sunday."]
)
def test_a_pronoun_and_his_designation_are_never_a_name(said: str) -> None:
    assert proper_name_phrases(said) == []


@pytest.mark.parametrize(
    ("said", "ledger"),
    [
        ("Keep Humphrey on the bench.", "Lil'Jordan Humphrey"),
        ("Leave Rudolph out of it.", "Mason Rudolph"),
        ("Keep Engram benched.", "Evan Engram"),
        ("Bench Palmer this week.", "Joshua Palmer"),
        ("Play Daniels this week.", "Jayden Daniels"),
        ("Sit Kyle Pitts this week.", "Kyle Pitts"),
    ],
)
def test_the_calls_imperative_before_his_name_traces(said: str, ledger: str) -> None:
    phrases = proper_name_phrases(said)
    assert phrases and all(is_name_grounded(phrase, [ledger]) for phrase in phrases), phrases


def test_an_imperative_before_an_unledgered_name_still_fails() -> None:
    assert not is_name_grounded("Keep Fakename", ["Evan Engram"])
    assert not is_name_grounded("Marcus Engram", ["Evan Engram"])


# --- the report day (B307) -------------------------------------------------------------------------------------


def test_the_sheet_states_the_report_day_and_whether_it_is_out() -> None:
    before = _week_eight()
    assert (report_day(before), report_out(before)) == ("Friday", False)
    line = report_day_line(before)
    assert line is not None and "comes out Friday by 3:00 pm Central" in line and "before Friday's report" in line
    # Lane 307: the sheet prints the line for a designation alone; no designation is one short line.
    assert line in render_week_sheet(replace(before, status=Status("questionable", THURSDAY_LIST)))
    assert line not in render_week_sheet(before) and "No injury designation." in render_week_sheet(before)
    # A Monday game's report is Saturday's; once his status is read after it, the line says it came out.
    after = _week_eight(MONDAY, datetime(2026, 11, 1, 2, 0, tzinfo=UTC))
    assert (report_day(after), report_out(after)) == ("Saturday", True)
    assert "came out Saturday by 3:00 pm Central, Saturday's report" in (report_day_line(after) or "")
    # A bye has no game status report this week.
    assert report_day_line(on_bye()) is None


def _report_breaks(said: str, sheet: WeekSheet) -> list[str]:
    return [v for v in week_rule_violations(said, sheet, "sit") if v.startswith("The text names")]


@pytest.mark.parametrize(
    "said",
    [
        # Calvin Ridley's and Hollywood Brown's falls: the report still to come, by the day the sheet states.
        "Keep him on the bench, and only worry about a change if Friday's game status report clears him.",
        "With no designation on the injury list as of Thursday 11:00 pm Central, before Friday's game status report, "
        "there's nothing to wait for.",
        "Hold him until Friday's report lands.",
    ],
)
def test_the_report_named_by_the_sheets_day_passes(said: str) -> None:
    assert _report_breaks(said, _week_eight()) == []


def test_another_day_and_a_report_not_out_cited_are_refused() -> None:
    sheet = _week_eight()
    # Zay Flowers's fall: no report is issued on Thursday for a Sunday game.
    thursday = _report_breaks("He had no designation on Thursday's report, so start him.", sheet)
    assert len(thursday) == 1 and "a report the facts do not name" in thursday[0]
    # Friday's report is not out at the write: citing it for what it says is refused.
    cited = _report_breaks("He has no designation on Friday's report.", sheet)
    assert len(cited) == 1 and "a report not out at the write" in cited[0]
    # The remedy quotes the sheet's own words, which name no bare week (the angles' "this week's").
    assert "this week's game status report on Friday" in cited[0] and "week 8's" not in cited[0]
    # Jahdae Walker's: a Monday game's report is Saturday's, and Friday's is no report.
    monday = _week_eight(MONDAY)
    assert _report_breaks("Hold him before Saturday's game status report.", monday) == []
    assert _report_breaks("Hold him before Friday's game status report.", monday)
    # Once it is out, it may be cited.
    out = _week_eight(seen=SATURDAY_LIST)
    assert _report_breaks("He has no designation on Friday's report.", out) == []


# --- lining up is football --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "said",
    [
        "That's a problem for whoever lines up opposite Josh Downs and Keenan Allen.",
        "Line up a fill-in and wait until the report lands before kickoff.",
        "He lined up in the slot on most snaps.",
        "They line up three receivers wide.",
    ],
)
def test_lining_up_is_never_the_sites_line(said: str) -> None:
    assert not [hit for hit in writer_only_hits(said, ()) if hit.rule.startswith("site word")]
    assert not [v for v in week_rule_violations(said, starter(), "sit") if "betting word (a line)" in v]


def test_the_line_itself_is_still_refused() -> None:
    assert [hit for hit in writer_only_hits("His work stays near the line.", ()) if hit.rule.startswith("site word")]


# --- fix round 1 -----------------------------------------------------------------------------------------------


def test_the_injury_list_by_the_day_his_status_was_read_passes() -> None:
    """Ruling 3a: "Tuesday's injury list" is the sheet's "the injury list as of Tuesday"; any other day is not."""
    tuesday = datetime(2026, 10, 27, 23, 0, tzinfo=UTC)  # Tuesday 6:00 pm Central
    sheet = _week_eight(seen=tuesday)
    listed = replace(sheet, status=Status("questionable", tuesday))
    assert "the injury list as of Tuesday 6:00 pm Central" in render_week_sheet(listed)
    # Jared Goff's and Bhayshul Tuten's falls in run p.
    for said in (
        "Jared Goff carries no designation on Tuesday's injury list, before Friday's report.",
        "Bhayshul Tuten enters week 8 of 2026 clean on Tuesday's injury list.",
    ):
        assert _report_breaks(said, sheet) == [], said
    assert _report_breaks("He is clean on Monday's injury list.", sheet)
    # A list by its day is never a report by it: Tuesday's report is still no report the facts name.
    assert _report_breaks("He is clean on Tuesday's report.", sheet)


@pytest.mark.parametrize(
    ("name", "team", "said", "rule"),
    [
        (
            "KC Concepcion",
            "CLE",
            "KC Concepcion is down to 58% of Cleveland's offensive snaps over his last three games.",
            "by its code",
        ),
    ],
)
def test_his_own_name_never_trips_a_word_rule(name: str, team: str, said: str, rule: str) -> None:
    """Ruling 3b: his name and his teammates' are masked before the word rules (the nightly's Tip Reiman, run p's
    KC Concepcion), and the rule's own word outside a name is still refused."""
    sheet = replace(_week_eight(), name=name, team=team)
    text = f"{said} Sit him this week. He has little to work with."
    assert not [v for v in week_rule_violations(text, sheet, "sit") if rule in v]
    assert not [v for v in body_rule_violations(text, SEASON, (name,)) if rule in v]
    assert [v for v in body_rule_violations(text, SEASON) if rule in v]
    outside = {"by its code": "KC is the club he faces."}[rule]
    assert [v for v in week_rule_violations(f"{text} {outside}", sheet, "sit") if rule in v]


def test_a_teammates_name_is_masked_too() -> None:
    sheet = replace(_week_eight(), depth=DepthPlace(2.0, (("KC Concepcion", 1.0),)))
    text = "He sits second behind KC Concepcion on the chart. Sit him this week. He has little to work with."
    assert not [v for v in week_rule_violations(text, sheet, "sit") if "by its code" in v]


def test_a_bye_names_no_report_for_another_week() -> None:
    """Ruling 3c: on a bye a read names no report for a week it is not for (run p's Cam Skattebo and Deebo Samuel
    Sr.: "Friday's week 9 report" on a week 8 bye), and a report named with its week is held to the read's week."""
    bye = on_bye()
    said = f"He's Questionable on the injury list, ahead of Friday's week {bye.week + 1} report on his status."
    found = _report_breaks(said, bye)
    assert len(found) == 1 and "a report for a week this read is not for" in found[0]
    assert _report_breaks("He's Questionable ahead of Friday's report.", bye)
    sheet = _week_eight()
    assert _report_breaks("Hold him before Friday's week 8 game status report.", sheet) == []
    assert _report_breaks("Hold him before Friday's week 9 report.", sheet)


# --- fix round 2 (the review) ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "said",
    [
        "Friday's report cleared him, so start him.",
        "Friday's report lists him as Questionable, so hold him.",
        "Friday's game status report has him Out, so sit him.",
        "Friday's report confirmed he is healthy.",
        "The Friday report is out and he is clear.",
    ],
)
def test_a_report_not_out_is_never_cited_as_its_subject(said: str) -> None:
    """The review's H1: before the report is out, a day-named report passes only as still to come."""
    found = _report_breaks(said, _week_eight())
    assert len(found) == 1 and "a report not out at the write" in found[0], found


@pytest.mark.parametrize(
    "said",
    [
        "Hold him before Friday's report.",
        "Keep him on the bench, and only worry about a change if Friday's game status report clears him.",
        "Friday's report will settle whether he plays.",
        "He carries no designation, with Friday's report still to come.",
        "Friday's report decides whether he plays.",
    ],
)
def test_a_report_still_to_come_passes(said: str) -> None:
    assert _report_breaks(said, _week_eight()) == []


def test_the_report_days_tense_is_the_writes() -> None:
    """The review's M2: a Saturday write with his status read Thursday, or never read, is past the report: the line
    says it came out, and the read may neither cite it nor call it still to come."""
    saturday = datetime(2026, 10, 31, 20, 0, tzinfo=UTC)
    for status in (Status(None, THURSDAY_LIST), Status(None, None)):
        sheet = replace(_week_eight(), written_at=saturday, status=status)
        assert (report_out(sheet), report_issued(sheet)) == (False, True)
        line = report_day_line(sheet) or ""
        assert "came out Friday by 3:00 pm Central" in line and "not read after it" in line and "comes out" not in line
        assert _report_breaks("Hold him before Friday's report.", sheet)
        assert _report_breaks("He has no designation on Friday's report.", sheet)
    # Read after the report: it may be cited.
    after = replace(_week_eight(seen=SATURDAY_LIST), written_at=saturday)
    assert _report_breaks("Friday's report cleared him, so start him.", after) == []


@pytest.mark.parametrize(
    "written",
    [
        "Sit him in week 8 of 2026. He had 9 in week 7 of the 2026 season.",
        "Sit him in week 8 of 2026. He had 14 in week 7, 2026 his best year so far.",
        "Sit him in week 8 of 2026. He scored 20 in week 7 in 2026 dollars.",
    ],
)
def test_a_season_said_in_another_form_is_never_cut(written: str) -> None:
    """The review's H2: only the remedy's own forms are dropped; anything else is the rule's to refuse."""
    assert said_once(written, SEASON) == written


@pytest.mark.parametrize(
    "written",
    [
        "He has 12 PPR points over weeks 5 to 7. Sit him in week 8.",
        "He sat out weeks 3-5. Sit him in week 8.",
        "He sat out weeks 3 through 5. Sit him in week 8.",
    ],
)
def test_a_range_is_read_as_this_seasons_as_one_span(written: str) -> None:
    """The review's H3: a range at a sentence's end, with a hyphen or "through", is one span in the validator's
    `with_season` (Lane 307: read as this season's, never written so)."""
    assert said_once(written, SEASON) == written
    assert _season_hits(with_season(written, SEASON)) == []


@pytest.mark.parametrize(
    "written",
    [
        "He had 25 PPR points in week 3 of his career.",
        "He had 25 PPR points in week 3 as a rookie.",
        "He scored twice in week 2 of the playoffs.",
        "He had 30 PPR points in week 5 in college.",
    ],
)
def test_a_week_outside_this_season_is_left_for_the_rule(written: str) -> None:
    """The review's M1: the season is never added to a career, rookie, playoff or college week."""
    assert said_once(written, SEASON) == written


def test_quoted_words_and_this_weeks_report() -> None:
    """The review's L1 and L2."""
    quoted = 'Sit him in week 8 of 2026. "Week 9 of 2026 is the one," his coach said.'
    assert said_once(quoted, SEASON) == quoted
    report = "He has no designation before week 8's game status report on Friday. Start him."
    assert said_once(report, SEASON, 8) == (
        "He has no designation before this week's game status report on Friday. Start him."
    )


# --- fix round 3 (the re-review) -------------------------------------------------------------------------------


@pytest.mark.parametrize("said", ["He was cleared by Friday's report, so start him.", "He is Out by Friday's report."])
def test_by_alone_never_makes_a_report_still_to_come(said: str) -> None:
    """The re-review's M1: "by" is the agent as often as the deadline."""
    found = _report_breaks(said, _week_eight())
    assert len(found) == 1 and "a report not out at the write" in found[0], found


@pytest.mark.parametrize(
    "said",
    [
        "We will know by Friday's report whether he plays.",
        "His status should be settled by Friday's report.",
        "By the time Friday's report lands, hold him.",
        "Hold him unless Friday's report clears him.",
    ],
)
def test_by_with_a_forward_word_passes(said: str) -> None:
    assert _report_breaks(said, _week_eight()) == []
