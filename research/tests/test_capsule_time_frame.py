"""The capsule's time frame floor (`capsules.season_voice`, the live review's H2), the doubled word
(M2), and the corrections each slip is handed back with: the H2 sentences themselves fail, their
honest rewrites pass."""

import pytest

from research.capsules.corrections import is_voice_rule_violation, soft_correction_for
from research.capsules.season_voice import (
    SeasonClock,
    missed_weeks_violation,
    names_missed_weeks,
    time_frame_hits,
    week_references,
)
from research.capsules.voice_rules import doubled_words, voice_rule_hits

PRESEASON = SeasonClock(2026)
# Puka Nacua's page on 2026-10-14: through week 5, played 1, 4 and 5, missed 2 and 3.
OCTOBER = SeasonClock(2026, 5, (1, 4, 5), (2, 3))


def _rules(text: str, clock: SeasonClock) -> list[str]:
    return [hit.rule for hit in time_frame_hits(text, clock)]


@pytest.mark.parametrize(
    ("text", "season"),
    [
        ("His best week was week 16 of 2025.", 2025),
        ("He missed weeks 2 and 3 of 2026.", 2026),
        ("Weeks 15 to 17 of 2026 bring SEA and TB.", 2026),
        ("In 2025's week 7 he sat.", 2025),
        ("In 2024, week 7 was his worst.", 2024),
        ("Week one of 2026 went fine.", 2026),
    ],
)
def test_a_week_with_its_season_is_read_with_it(text: str, season: int) -> None:
    references = week_references(text)
    assert [r.season for r in references] == [season]
    assert "time frame (a week without its season)" not in _rules(text, PRESEASON)


def test_a_bare_week_fails_in_either_voice() -> None:
    text = "The low weeks, that 5.2 in week 7, are the worry."
    assert "time frame (a week without its season)" in _rules(text, PRESEASON)
    assert "time frame (a week without its season)" in _rules(text, OCTOBER)


def test_a_week_still_to_play_is_only_looked_ahead_to() -> None:
    assert "time frame (a week still to play told as past)" in _rules("That 5.2 in week 7 of 2026 hurt.", OCTOBER)
    assert "time frame (a week still to play told as past)" in _rules("In week 9 of 2026 he scored twice.", OCTOBER)
    assert _rules("Week 7 of 2026 is a home game against SF.", OCTOBER) == []
    assert _rules("That 5.2 in week 7 of 2025 hurt.", OCTOBER) == []
    assert _rules("He scored 37.7 points in week 5 of 2026.", OCTOBER) == []


def test_the_draft_and_the_calendar_are_preseason_words_only() -> None:
    achane = "He needs to be back on the field by October, or your first-round pick sits on your bench."
    rules = _rules(achane, OCTOBER)
    assert "time frame (a month)" in rules
    assert "draft voice (your early pick)" in rules
    assert _rules(achane, PRESEASON) == []
    for text in ("Draft him at 18.", "Take him at his ADP of 9.6.", "Let him fall a round.", "On draft day, wait."):
        assert any(rule.startswith("draft voice") for rule in _rules(text, OCTOBER)), text
    assert _rules("Start him and hold him through his week 11 of 2026 bye.", OCTOBER) == []
    assert _rules("He beat the backs drafted at his ADP of 1.4 by 20 points.", OCTOBER) == []
    assert _rules("That early-October dud last season is rare for him.", OCTOBER) == []
    assert _rules("He sat three weeks in October of 2025.", OCTOBER) == []
    assert "time frame (a month)" in _rules("He sat in October of 2025 and again this October of 2026.", OCTOBER)


def test_missed_weeks_are_named_in_season() -> None:
    puka = "We expect 15 games this year, and there is no designation on file."
    assert not names_missed_weeks(puka, OCTOBER)
    assert names_missed_weeks("He sat out weeks 2 and 3 of 2026 and came back hot.", OCTOBER)
    assert names_missed_weeks("He has missed two games already this season.", OCTOBER)
    assert names_missed_weeks(puka, PRESEASON)
    correction = soft_correction_for(missed_weeks_violation(OCTOBER))
    assert correction is not None and "weeks 2 and 3 of 2026" in correction


def test_a_doubled_word_is_read_on_the_text_as_written() -> None:
    names = ["Jaylen Wright", "Ollie Gordon"]
    assert voice_rule_hits("Behind him are Jaylen Wright Ollie Gordon and nobody else.", names) == []


def test_a_doubled_word_is_a_voice_rule_hit() -> None:
    assert doubled_words("Strength is the the average of its opponents.") == ["the the"]
    assert doubled_words("He had had a rough year, and that that mattered.") == []
    assert [hit.rule for hit in voice_rule_hits("Draft him him now.", [])] == ["doubled word"]


@pytest.mark.parametrize(
    ("rule", "found", "advice"),
    [
        ("time frame (a week without its season)", "week 7", "week 7 of 2025"),
        ("time frame (a month)", "October", "never by a month"),
        ("draft voice (draft him)", "Draft him", "running his roster now"),
        ("doubled word", "the the", "repeated word once"),
    ],
)
def test_every_slip_gets_a_sentence_correction(rule: str, found: str, advice: str) -> None:
    violation = f'The text carries a {rule}, "{found}", in the sentence "A sentence."). Rewrite that sentence.'
    violation = violation.replace('."). Rewrite', '.". Rewrite')
    assert is_voice_rule_violation(violation)
    correction = soft_correction_for(violation)
    assert correction is not None and advice in correction


@pytest.mark.parametrize(
    "text",
    [
        "After a lost 2025, he needs to be back by November.",
        "Like last season, he needs to be healthy by December for your playoff run.",
        "He sat in October of 2025 and needs to be back this October.",
    ],
)
def test_a_month_on_this_seasons_calendar_fails_whatever_else_the_sentence_names(text: str) -> None:
    assert "time frame (a month)" in _rules(text, OCTOBER)


@pytest.mark.parametrize(
    "text",
    [
        "He is worth a second-round pick, no more.",
        "Spend a third-round pick on him and do not look back.",
        "Grab him in round two and move on.",
        "Take him over Bijan Robinson.",
        "Draft day is the time to pounce.",
        "Snag him at 18.",
    ],
)
def test_the_draft_voice_the_review_found_missing(text: str) -> None:
    assert any(rule.startswith("draft voice") for rule in _rules(text, OCTOBER)), text


@pytest.mark.parametrize(
    "text",
    [
        "Target him before your league's trade deadline while he is cheap to get.",
        "Managers waiting on him to come back from IR should hold.",
        "He needs 15 points in week 7 of 2026 to stay in your lineup.",
    ],
)
def test_in_season_sentences_the_review_found_refused_pass(text: str) -> None:
    assert _rules(text, OCTOBER) == []


def test_a_bare_week_beside_a_dated_one_takes_its_season() -> None:
    assert _rules("He scored 27.7 in week 4 of 2026 and 37.7 in week 5.", OCTOBER) == []
    mixed = "Week 4 of 2025 and week 5 of 2026, then week 6."
    assert "time frame (a week without its season)" in _rules(mixed, OCTOBER)


def test_a_hit_names_the_sentence_it_stands_in() -> None:
    text = "The week 5 of 2026 game was his best. Hold him through the week 5 dud."
    hits = time_frame_hits(text, OCTOBER)
    assert [(h.found, h.sentence) for h in hits] == [("week 5", "Hold him through the week 5 dud.")]


def test_points_a_game_against_the_season_number_is_handed_back() -> None:
    nacua = "At 25.9 points a game he is tracking exactly where our 344-point projection wanted him."
    assert "time frame (points a game against the season number)" in _rules(nacua, OCTOBER)
    assert _rules("Our preseason number was 344 points for the season.", OCTOBER) == []
    assert _rules(nacua, PRESEASON) == []
