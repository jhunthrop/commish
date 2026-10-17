"""Lane 72, the week-ahead read: its sheet, its caption and its rules (fix round 1 included).

The sheet carries only stamped facts, each line with its read, and names the projection as published,
never ours; the caption is the page's "Written Fri 9:00 pm Central, for week 6"; the read is held to the
writer's rules and to the week's own: no betting or trading word, no provider or rival product, no tip;
the published projection named with its exact figure and nothing else put on it (H4); a player who may
not be started never recommended, by his call or in any wording (H2); every figure with its unit (M1);
his place in our order said with which order (M2); the season named once (the ruling on L5); three to
five sentences; no sentence shape another page carries (M4). The season read in season refuses the
draft-time sentence."""

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from research.capsules.season_voice import SeasonClock, time_frame_hits
from research.capsules.voice_rules import gate_hits
from research.capsules.week.caption import written_caption
from research.capsules.week.render import render_week_facts_block, render_week_sheet
from research.capsules.week.rules import WEEK_NEVER_WORDS, week_rule_violations
from research.capsules.week.sheet import BoardPlace, DepthPlace, PublishedProjection, Status, WeekGame
from research.capsules.week.validate import sentence_shapes, validate_week_read, with_season
from research.tests.week_read_fixtures import (
    BOARD,
    CAPTURED,
    FIGURES,
    KICKOFF,
    LINES,
    REPORT,
    WRITTEN_AT,
    on_bye,
    on_injured_reserve,
    questionable,
    starter,
)

STARTER_READ = (
    "Puka Nacua gets ARI at home in week 6 of 2026, and the Cardinals have allowed receivers 41.3 PPR points "
    "a game, 26th of 32. The published projection has him at 18.4 points, up 0.5 points from the published "
    "figure before it. The Rams are expected to score 32.5 points indoors, plenty of room for his 25.9 PPR "
    "points a game. Start him with confidence."
)
BYE_READ = (
    "Jahmyr Gibbs and the Lions are on their bye in week 6 of 2026, so he does not play and scores nothing "
    "for you this week. Keep him on your roster through the off week, because his 21.3 PPR points a game over "
    "5 games make him a weekly starter once Detroit plays again. Fill his spot with a back who has a game, and "
    "bring Gibbs straight back for week 7 against Green Bay."
)


def _words(text: str) -> list[str]:
    return [rule.name for rule in WEEK_NEVER_WORDS if rule.pattern.search(text)]


def test_the_sheet_names_the_week_the_projection_as_published_and_the_order() -> None:
    sheet = render_week_sheet(starter())
    assert "week 6 of 2026" in sheet
    assert "published projection" in sheet.lower() and "not ours" in sheet
    assert "18.4 points" in sheet and "+0.5" in sheet
    assert "26th of 32" in sheet and "1st allowed the fewest" in sheet
    assert "Sunday 3:05 pm Central" in sheet
    assert "32.5" in sheet and "indoors" in sheet
    assert "Our rest-of-season order" in sheet and "WR2" in sheet and '"in our rest-of-season order"' in sheet


def test_a_preseason_board_is_named_as_the_preseason_order() -> None:
    sheet = replace(starter(), board=BoardPlace(1, 1, None, "preseason", None, BOARD))
    text = render_week_sheet(sheet)
    assert "Our preseason order" in text and '"in our preseason order"' in text


def test_every_line_carries_its_stamp_and_the_report_its_day() -> None:
    sheet = replace(
        starter(),
        game=WeekGame(6, "ARI", True, KICKOFF, LINES),
        depth=DepthPlace(1.0, (("Davante Adams", 2.0),), LINES),
        lines_at=LINES,
    )
    text = render_week_sheet(sheet)
    for line in text.splitlines()[2:]:
        if not line.startswith("Injury report"):
            assert "(as of " in line, line
    assert "on Friday's report" in text
    assert set(sheet.stamps()) >= {"schedule", "projection", "status", "expected", "allowed", "board", "stat_lines"}
    assert set(sheet.stamps()) >= {"depth_chart"}


def test_the_sheet_never_prints_a_betting_word_or_a_provider() -> None:
    for sheet in (starter(), questionable(), on_bye(), on_injured_reserve()):
        text = render_week_sheet(sheet)
        assert gate_hits(text, ()) == [], text
        assert _words(text) == []


def test_the_sheet_states_a_bye_and_a_status_that_keeps_him_out() -> None:
    bye = render_week_sheet(on_bye())
    assert "does not play in week 6 of 2026" in bye
    assert "published projection" not in bye.lower()
    out = render_week_sheet(on_injured_reserve())
    assert "injured reserve" in out and "cannot play in week 6 of 2026" in out


def test_the_questionable_sheet_names_the_designation_the_change_since_the_last_read_and_the_forecast() -> None:
    sheet = render_week_sheet(questionable())
    assert "Questionable on Friday's report" in sheet
    assert "17 points" in sheet and "-1.8" in sheet
    assert "61 degrees" in sheet and "14 mph" in sheet and "30% chance of rain" in sheet


def test_the_facts_block_is_labelled_facts_and_no_sentence() -> None:
    lines = render_week_facts_block(starter()).splitlines()
    assert all(": " in line for line in lines)
    assert any(line.startswith("Published projection: 18.4 points") for line in lines)
    assert any(line.startswith("In our rest-of-season order: 3 overall") for line in lines)
    assert not any(line.rstrip().endswith(".") for line in lines)


def test_the_stamps_are_every_fact_at_or_before_the_write() -> None:
    sheet = starter()
    assert all(datetime.fromisoformat(at) <= WRITTEN_AT for at in sheet.stamps().values())
    assert sheet.facts_at == max(CAPTURED, REPORT, FIGURES, BOARD)


def test_a_fact_stamped_after_the_write_is_refused() -> None:
    late = datetime(2026, 10, 17, 3, 0, tzinfo=UTC)
    with pytest.raises(ValueError, match="after the write"):
        replace(starter(), projection=PublishedProjection(18.4, late, None, None))


@pytest.mark.parametrize(
    ("written_at", "week", "caption"),
    [
        (WRITTEN_AT, 6, "Written Fri 9:00 pm Central, for week 6"),
        (datetime(2026, 10, 18, 16, 5, tzinfo=UTC), 6, "Written Sun 11:05 am Central, for week 6"),
        (datetime(2026, 12, 1, 6, 30, tzinfo=UTC), 13, "Written Tue 12:30 am Central, for week 13"),
    ],
)
def test_the_caption_is_the_write_in_central_time_and_the_week(written_at: datetime, week: int, caption: str) -> None:
    assert written_caption(written_at, week) == caption


def test_an_honest_starter_read_passes() -> None:
    result = validate_week_read(STARTER_READ, starter(), call="start")
    assert result.ok, result.violations


def test_an_honest_bye_read_passes_and_says_he_does_not_play() -> None:
    result = validate_week_read(BYE_READ, on_bye(), call="hold")
    assert result.ok, result.violations


@pytest.mark.parametrize(
    "sentence",
    [
        "The odds favor the Rams.",
        "The Rams are favoured on the scoreboard.",
        "ARI is a big underdog this week.",
        "The line on this game moved.",
        "Vegas likes this spot.",
        "The spread is wide.",
        "It is a safe bet he scores.",
        "The books expect points.",
        "Buy him now before the price climbs.",
    ],
)
def test_a_betting_or_trading_word_is_refused(sentence: str) -> None:
    result = validate_week_read(f"{STARTER_READ} {sentence}", starter(), call="start")
    assert not result.ok
    assert any(sentence in v for v in result.violations), result.violations


def test_football_senses_of_line_and_spread_pass() -> None:
    assert _words("His offensive line held up and his stat line was full.") == []
    assert _words("The goal line is his, on the line of scrimmage.") == []
    assert _words("He lines up in the slot, and the Rams spread the ball to his favorite target.") == []


@pytest.mark.parametrize("name", ["Tank01", "nflverse", "the National Weather Service", "Sleeper app", "ESPN"])
def test_a_provider_or_a_rival_product_is_refused(name: str) -> None:
    assert not validate_week_read(f"{STARTER_READ} {name} agrees.", starter(), call="start").ok


def test_a_tip_is_refused() -> None:
    result = validate_week_read(f"{STARTER_READ} Pro tip: check the inactives.", starter(), call="start")
    assert any("tip" in v for v in result.violations), result.violations


def test_the_projection_is_never_called_ours() -> None:
    text = STARTER_READ.replace("The published projection has him at", "Our projection has him at")
    assert any("ours" in v for v in week_rule_violations(text, starter()))


def test_the_projection_figure_needs_the_word_published() -> None:
    text = STARTER_READ.replace(
        "The published projection has him at 18.4 points, up 0.5 points from the published figure before it.",
        "He is projected for 18.4 points this week.",
    )
    violations = week_rule_violations(text, starter())
    assert any("without saying it is published" in v for v in violations), violations
    assert any("never names the published projection" in v for v in violations), violations


def test_another_figure_put_on_the_published_projection_is_refused() -> None:
    """The review's H4: 25.9 is his points a game, grounded but not the projection."""
    text = STARTER_READ.replace("has him at 18.4 points", "has him at 25.9 points")
    violations = validate_week_read(text, starter(), call="start").violations
    assert any("puts 25.9 on the published projection" in v for v in violations), violations


def test_the_published_projection_named_without_its_figure_is_refused() -> None:
    text = STARTER_READ.replace(
        "The published projection has him at 18.4 points, up 0.5 points from the published figure before it.",
        "The published projection likes him a lot this week.",
    )
    violations = validate_week_read(text, starter(), call="start").violations
    assert any("without its figure" in v for v in violations), violations


@pytest.mark.parametrize(
    "advice",
    [
        "You can't sit him, start him.",
        "He is a must-start in your lineup this week anyway.",
        "Start Puka Nacua this week.",
    ],
)
@pytest.mark.parametrize("sheet_of", [on_injured_reserve, lambda: replace(starter(), bye=True)])
def test_a_player_who_may_not_be_started_is_never_recommended_in_any_wording(advice: str, sheet_of: object) -> None:
    sheet = sheet_of()  # type: ignore[operator]
    text = f"Puka Nacua does not play in week 6 of 2026. His 25.9 PPR points a game wait for week 7. {advice}"
    assert any("recommends starting" in v for v in week_rule_violations(text, sheet, "sit")), advice


@pytest.mark.parametrize("status", ["out", "doubtful", "injured_reserve", "suspended"])
def test_a_start_call_on_a_sheet_that_may_not_start_him_is_refused(status: str) -> None:
    sheet = replace(starter(), status=Status(status, REPORT))
    assert any("call is start" in v for v in week_rule_violations(STARTER_READ, sheet, "start"))
    assert not any("call is start" in v for v in week_rule_violations(STARTER_READ, starter(), "start"))


def test_a_negation_in_its_own_clause_is_no_recommendation() -> None:
    text = "Puka Nacua is on injured reserve and does not play in week 6 of 2026. Do not start him. Hold the spot."
    assert not any("recommends" in v for v in week_rule_violations(text, on_injured_reserve(), "sit"))


def test_what_a_bye_does_to_a_lineup_is_not_a_recommendation() -> None:
    sheet = on_bye()
    stated = "Detroit is on its bye in week 6 of 2026, so Gibbs does not play and puts a zero in your lineup this week."
    assert not any("recommends" in v for v in week_rule_violations(stated, sheet, "hold"))
    advice = "Detroit is on its bye in week 6 of 2026. Put him in your lineup anyway."
    assert any("recommends" in v for v in week_rule_violations(advice, sheet, "hold"))


def test_a_read_must_say_he_does_not_play_when_he_cannot() -> None:
    text = "Jahmyr Gibbs has 21.3 PPR points a game over 5 games in 2026. The Lions back is a weekly starter. Hold him."
    assert any("does not play" in v for v in week_rule_violations(text, on_bye(), "hold"))


def test_a_figure_without_its_unit_is_refused_and_week_numbers_and_clock_times_are_not_figures() -> None:
    """The review's M1, in the recorded reads' own words."""
    bare = "The expected score has the Rams at 32 to Arizona's 19.5 this week."
    assert any('"32", "19.5" without its unit' in v for v in week_rule_violations(bare, starter()))
    honest = "The Rams are expected to score 32.5 points in week 6 of 2026, kicking off at 3:05 pm Central."
    assert not any("without its unit" in v for v in week_rule_violations(honest, starter()))


def test_a_rank_in_our_order_says_which_order() -> None:
    plain = "We have him WR2 on our board for the weeks ahead."
    assert any("which order" in v for v in week_rule_violations(plain, starter()))
    said = "He is WR2 in our rest-of-season order."
    assert not any("which order" in v for v in week_rule_violations(said, starter()))
    preseason = replace(starter(), board=BoardPlace(1, 1, None, "preseason", None, BOARD))
    assert any("which order" in v for v in week_rule_violations("He is WR1 in our rest-of-season order.", preseason))


def test_the_season_is_named_once_and_weeks_after_it_go_bare() -> None:
    twice = STARTER_READ.replace("plenty of room", "in week 6 of 2026, plenty of room")
    assert any("names the season 2 times" in v for v in week_rule_violations(twice, starter()))
    assert validate_week_read(BYE_READ, on_bye(), call="hold").ok


def test_a_bare_week_before_the_season_is_named_is_refused() -> None:
    text = STARTER_READ.replace("in week 6 of 2026", "in week 6").replace("Start him", "Start him in 2026")
    assert not validate_week_read(text, starter(), call="start").ok


@pytest.mark.parametrize("count", [2, 6])
def test_a_read_runs_three_to_five_sentences(count: int) -> None:
    sentences = [
        "Puka Nacua faces ARI at home in week 6 of 2026.",
        "The published projection has him at 18.4 points.",
        "The Cardinals allow receivers 41.3 PPR points a game.",
        "The Rams are expected to score 32.5 points.",
        "He has 25.9 PPR points a game.",
        "Start him every week.",
    ]
    assert any("sentences" in v for v in week_rule_violations(" ".join(sentences[:count]), starter()))


def test_a_sentence_shaped_like_one_on_another_page_is_refused() -> None:
    """The review's M4: the same skeleton with another name and other numbers is the same sentence."""
    theirs = "The Bears are expected to score 25 points indoors, plenty of room for his 17.6 PPR points a game."
    taken = frozenset(sentence_shapes(theirs))
    result = validate_week_read(STARTER_READ, starter(), taken, call="start")
    assert any("shaped like one another page carries" in v for v in result.violations), result.violations


def test_a_call_is_required() -> None:
    assert any("no call" in v for v in validate_week_read(STARTER_READ, starter(), call=None).violations)


def test_a_number_the_sheet_never_printed_is_refused() -> None:
    text = STARTER_READ.replace("41.3 PPR points", "44.7 PPR points")
    assert any('"44.7"' in v for v in validate_week_read(text, starter(), call="start").violations)


def test_the_in_season_season_read_refuses_the_draft_time_sentence() -> None:
    """Item 3: the season read keeps its place in season, and the writer's rules (never a template)
    retire "take him at pick 3": the validator and the page gate both read it as draft voice."""
    october = SeasonClock(2026, 5, (1, 4, 5), (2, 3))
    hits = time_frame_hits("Take him at pick 3 without blinking.", october)
    assert any(hit.rule.startswith("draft voice") for hit in hits)
    assert time_frame_hits("Take him at pick 3 without blinking.", SeasonClock(2026)) == []


def test_a_bare_week_beside_a_figure_takes_the_season_and_never_the_figure() -> None:
    """The recorded run's second draft for Jahmyr Gibbs: "in week 5 and 41.4 PPR points" read as a week
    list made "2026.4", a figure no sheet prints."""
    text = "Lions bye in week 6 of 2026. He had 37.7 PPR points in week 5 and 41.4 PPR points in week 3."
    assert with_season(text, 2026).endswith("in week 5 of 2026 and 41.4 PPR points in week 3 of 2026.")
