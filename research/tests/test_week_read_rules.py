"""Lane 72, the week-ahead read: its sheet, its caption and its rules.

The sheet carries only stamped facts and names the projection as published, never ours; the caption is
the page's "Written Fri 9:00 pm Central, for week 6"; the read is held to the writer's rules and to the
week's own (no betting or trading word, no provider or rival product, no tip, the published projection
named as published, a player who cannot play never recommended, a bye named, three to five sentences,
no sentence another page carries). The season read in season refuses the draft-time sentence."""

from dataclasses import replace
from datetime import UTC, datetime

import pytest

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.narrative import held_sentences
from research.capsules.season_voice import SeasonClock, time_frame_hits
from research.capsules.voice_rules import gate_hits
from research.capsules.week.caption import written_caption
from research.capsules.week.rules import WEEK_NEVER_WORDS, week_rule_violations
from research.capsules.week.sheet import PublishedProjection, render_week_facts_block, render_week_sheet
from research.capsules.week.validate import validate_week_read
from research.tests.week_read_fixtures import (
    BOARD,
    CAPTURED,
    FIGURES,
    REPORT,
    WRITTEN_AT,
    on_bye,
    on_injured_reserve,
    questionable,
    starter,
)

STARTER_READ = (
    "Puka Nacua gets ARI at home in week 6 of 2026, and the Cardinals have allowed receivers 41.3 PPR points a "
    "game, 26th of 32. The published projection for him is 18.4 points, up 0.5 from the published figure "
    "before it. The Rams are expected to score 32.5 points indoors, which is plenty of room for his 25.9 "
    "points a game. Start him with confidence."
)
BYE_READ = (
    "Jahmyr Gibbs and the Lions are on their bye in week 6 of 2026, so he does not play and scores nothing "
    "for you this week. Keep him on your roster through the off week, because his 21.3 points a game over "
    "5 games make him a weekly starter once Detroit plays again. Fill his spot with a back who has a game, "
    "and bring Gibbs straight back for week 7 of 2026."
)


def test_the_sheet_names_the_week_the_projection_as_published_and_the_rank_basis() -> None:
    sheet = render_week_sheet(starter())
    assert "week 6 of 2026" in sheet
    assert "published projection" in sheet.lower()
    assert "not ours" in sheet
    assert "18.4 points" in sheet
    assert "+0.5" in sheet
    assert "26th of 32" in sheet and "1st allowed the fewest" in sheet
    assert "Sunday 3:05 pm Central" in sheet
    assert "32.5" in sheet and "20" in sheet
    assert "indoors" in sheet
    assert "WR2" in sheet and "rest of the season" in sheet


def test_the_sheet_never_prints_a_betting_word_or_a_provider() -> None:
    for sheet in (starter(), questionable(), on_bye(), on_injured_reserve()):
        text = render_week_sheet(sheet)
        assert gate_hits(text, ()) == [], text
        assert week_rule_violations_of_words(text) == []
        assert "tank01" not in text.lower() and "nflverse" not in text.lower()


def week_rule_violations_of_words(text: str) -> list[str]:
    return [rule.name for rule in WEEK_NEVER_WORDS if rule.pattern.search(text)]


def test_the_sheet_states_a_bye_and_a_status_that_keeps_him_out() -> None:
    bye = render_week_sheet(on_bye())
    assert "does not play in week 6 of 2026" in bye
    assert "published projection" not in bye.lower()
    out = render_week_sheet(on_injured_reserve())
    assert "injured reserve" in out
    assert "cannot play in week 6 of 2026" in out


def test_the_questionable_sheet_names_the_designation_the_change_since_the_last_read_and_the_forecast() -> None:
    sheet = render_week_sheet(questionable())
    assert "Questionable" in sheet
    assert "17 points" in sheet and "-1.8" in sheet
    assert "61 degrees" in sheet and "14 mph" in sheet and "30% chance of rain" in sheet


def test_the_facts_block_is_labelled_facts_and_no_sentence() -> None:
    block = render_week_facts_block(starter())
    lines = block.splitlines()
    assert all(": " in line for line in lines)
    assert any(line.startswith("Published projection: 18.4 points") for line in lines)
    assert not any(line.rstrip().endswith(".") for line in lines)


def test_the_stamps_are_every_fact_at_or_before_the_write() -> None:
    sheet = starter()
    stamps = sheet.stamps()
    assert set(stamps) >= {"projection", "status", "expected", "allowed", "board"}
    assert all(datetime.fromisoformat(at) <= WRITTEN_AT for at in stamps.values())
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
    result = validate_week_read(STARTER_READ, starter())
    assert result.ok, result.violations


def test_an_honest_bye_read_passes_and_says_he_does_not_play() -> None:
    result = validate_week_read(BYE_READ, on_bye())
    assert result.ok, result.violations


@pytest.mark.parametrize(
    "sentence",
    [
        "The odds favor the Rams.",
        "The Rams are favoured by 12.5 points.",
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
    text = f"{STARTER_READ} {sentence}"
    result = validate_week_read(text, starter())
    assert not result.ok
    assert any(sentence in v for v in result.violations), result.violations


def test_football_senses_of_line_and_spread_pass() -> None:
    assert week_rule_violations_of_words("His offensive line held up and his stat line was full.") == []
    assert week_rule_violations_of_words("The goal line is his, on the line of scrimmage.") == []
    assert week_rule_violations_of_words("The Rams spread the ball around to his favorite target.") == []


@pytest.mark.parametrize("name", ["Tank01", "nflverse", "the National Weather Service", "Sleeper app", "ESPN"])
def test_a_provider_or_a_rival_product_is_refused(name: str) -> None:
    result = validate_week_read(f"{STARTER_READ} {name} agrees.", starter())
    assert not result.ok


def test_a_tip_is_refused() -> None:
    result = validate_week_read(f"{STARTER_READ} Pro tip: check the inactives.", starter())
    assert any("tip" in v for v in result.violations), result.violations


def test_the_projection_is_never_called_ours() -> None:
    text = STARTER_READ.replace(
        "The published projection for him is 18.4 points", "Our projection for him is 18.4 points"
    )
    violations = week_rule_violations(text, starter())
    assert any("ours" in v for v in violations), violations


def test_the_projection_figure_needs_the_word_published() -> None:
    text = STARTER_READ.replace(
        "The published projection for him is 18.4 points, up 0.5 from the published figure before it.",
        "He is projected for 18.4 points this week.",
    )
    violations = week_rule_violations(text, starter())
    assert any("without saying it is published" in v for v in violations), violations
    assert any("never names the published projection" in v for v in violations), violations


def test_a_read_must_name_the_published_projection_when_there_is_one() -> None:
    text = (
        "Puka Nacua gets ARI at home in week 6 of 2026. The Cardinals have allowed receivers 41.3 PPR points a game. "
        "The Rams are expected to score 32.5 points indoors. Start him."
    )
    assert any("published projection" in v for v in week_rule_violations(text, starter()))


def test_a_player_who_cannot_play_is_never_recommended() -> None:
    sheet = on_injured_reserve()
    text = (
        "Puka Nacua is on injured reserve and cannot play in week 6 of 2026. His 25.9 points a game sit on your "
        "bench until he is back. Start him anyway if you are short."
    )
    violations = week_rule_violations(text, sheet)
    assert any("cannot play" in v and "Start him" in v for v in violations), violations
    benched = text.replace("Start him anyway if you are short.", "Do not start him, and keep the roster spot.")
    assert not any("cannot play" in v and "recommend" in v for v in week_rule_violations(benched, sheet))


def test_a_bye_read_must_say_he_does_not_play() -> None:
    text = (
        "Jahmyr Gibbs has 21.3 points a game over 5 games in 2026. The Lions back is a weekly starter. "
        "Hold him on your roster."
    )
    assert any("does not play" in v for v in week_rule_violations(text, on_bye()))


@pytest.mark.parametrize("count", [2, 6])
def test_a_read_runs_three_to_five_sentences(count: int) -> None:
    sentences = [
        "Puka Nacua faces ARI at home in week 6 of 2026.",
        "The published projection for him is 18.4 points.",
        "The Cardinals allow receivers 41.3 PPR points a game.",
        "The Rams are expected to score 32.5 points.",
        "He has 25.9 points a game in 2026.",
        "Start him every week.",
    ]
    text = " ".join(sentences[:count])
    assert any("sentences" in v for v in week_rule_violations(text, starter()))


def test_a_sentence_another_page_carries_is_refused() -> None:
    taken = frozenset(held_sentences(("Start him with confidence.",), CAPSULE_CONFIG.shared_sentence_min_words))
    result = validate_week_read(STARTER_READ, starter(), taken)
    assert not result.ok
    assert any("another page" in v for v in result.violations), result.violations


def test_a_number_the_sheet_never_printed_is_refused() -> None:
    text = STARTER_READ.replace("18.4 points", "22.7 points")
    result = validate_week_read(text, starter())
    assert any('"22.7"' in v for v in result.violations), result.violations


def test_a_bare_week_is_refused() -> None:
    text = STARTER_READ.replace("in week 6 of 2026", "in week 6")
    assert not validate_week_read(text, starter()).ok


def test_the_in_season_season_read_refuses_the_draft_time_sentence() -> None:
    """Item 3: the season read keeps its place in season, and the writer's rules (never a template)
    retire "take him at pick 3": the validator and the page gate both read it as draft voice."""
    october = SeasonClock(2026, 5, (1, 4, 5), (2, 3))
    hits = time_frame_hits("Take him at pick 3 without blinking.", october)
    assert any(hit.rule.startswith("draft voice") for hit in hits)
    assert time_frame_hits("Take him at pick 3 without blinking.", SeasonClock(2026)) == []


def test_what_a_bye_does_to_a_lineup_is_not_a_recommendation() -> None:
    """The probe's first draft for a player on bye: "a zero in your lineup" says what the bye costs."""
    sheet = on_bye()
    stated = "Detroit is on its bye in week 6 of 2026, so Gibbs does not play and puts a zero in your lineup this week."
    assert not any("recommends" in v for v in week_rule_violations(stated, sheet))
    advice = "Detroit is on its bye in week 6 of 2026. Put him in your lineup anyway."
    assert any("recommends" in v for v in week_rule_violations(advice, sheet))
