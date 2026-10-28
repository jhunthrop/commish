"""Lane 281 (B270), voices v2: the matchup, story and table-talk briefs carry the opening rule's point in their
own first sentence, the opening rule leaves the first sentence's shape to the voice, the first sentence is
capped at 30 words, and "other club" phrasing with no fact behind it is refused; each new refusal reaches the
correction and the retry writer's ask."""

import pytest

from research.capsules.rule_notes import notes_of
from research.capsules.week import voices
from research.capsules.week.prompt import OPENING_RULE, OTHER_CLUB_RULE, WEEK_RULES, week_correction
from research.capsules.week.rules import FIRST_SENTENCE_WORDS, week_rule_violations
from research.capsules.week.validate import validate_week_read
from research.capsules.week.voices import VOICES
from research.capsules.week.write import WeekAttempt, _retry_prompt
from research.tests.week_read_fixtures import starter

_REST = (
    "Arizona ranks 26th of 32 against receivers, and the Rams play indoors at home. He leads the Rams' receivers "
    "with 25.9 PPR points a game. Start him with confidence."
)
_CAP = "over the 30-word cap"
_OTHER = "with no fact naming that tie"


def _brief(key: str) -> str:
    return next(v.brief for v in VOICES if v.key == key)


def test_the_opening_rule_leaves_the_shape_to_the_voice() -> None:
    assert OPENING_RULE in WEEK_RULES
    assert "Open on the fact that matters most" not in WEEK_RULES
    assert "the first sentence carries the call, a figure or his status" in OPENING_RULE.lower()
    assert f"{FIRST_SENTENCE_WORDS} words at most" in OPENING_RULE
    for never in ("scene-setting clause before a colon", "a greeting", "a question"):
        assert never in OPENING_RULE
    assert OTHER_CLUB_RULE in WEEK_RULES


@pytest.mark.parametrize(
    ("key", "carries"),
    [
        ("matchup", "the call framed by the opponent"),
        ("story", "his status as the turn his season takes"),
        ("table_talk", "the call as a league-mate says it across the table"),
    ],
)
def test_each_quiet_voice_opens_on_the_rules_point_in_its_own_way(key: str, carries: str) -> None:
    assert carries in _brief(key)


def test_the_voice_header_says_the_voice_sets_the_first_sentence() -> None:
    assert "how the first sentence carries its point" in voices.voice_section(starter(), on=True)[0]


def test_a_first_sentence_of_thirty_words_passes_and_one_over_is_refused() -> None:
    sheet = starter()
    thirty = "Start Puka Nacua " + " ".join(["now"] * (FIRST_SENTENCE_WORDS - 4)) + " week."
    over = "Start Puka Nacua " + " ".join(["now"] * (FIRST_SENTENCE_WORDS - 3)) + " week."
    assert not any(_CAP in v for v in week_rule_violations(f"{thirty} {_REST}", sheet, "start"))
    refused = [v for v in week_rule_violations(f"{over} {_REST}", sheet, "start") if _CAP in v]
    assert refused and f"{FIRST_SENTENCE_WORDS + 1} words" in refused[0]


@pytest.mark.parametrize(
    "sentence",
    [
        "Los Angeles's other club sits 24th of 32 against backs.",
        "He gets the other Los Angeles team at home.",
        "The other side ranks 26th of 32 against receivers.",
    ],
)
def test_other_club_phrasing_with_no_fact_behind_it_is_refused(sentence: str) -> None:
    text = f"Start Puka Nacua this week. {sentence} He leads the Rams' receivers. Keep him in your lineup."
    assert any(_OTHER in v for v in week_rule_violations(text, starter(), "start"))


@pytest.mark.parametrize(
    "sentence",
    [
        "Arizona's defense on the other side of the ball ranks 26th of 32 against receivers.",
        "Arizona allows more to receivers than every other team but six.",
        "His other teammates sit behind him on the chart.",
    ],
)
def test_football_and_league_wide_senses_of_other_pass(sentence: str) -> None:
    text = f"Start Puka Nacua this week. {sentence} He leads the Rams' receivers. Keep him in your lineup."
    assert not any(_OTHER in v for v in week_rule_violations(text, starter(), "start"))


def test_the_new_refusals_reach_the_correction_and_the_retry_writer() -> None:
    sheet = starter()
    long_open = "Start Puka Nacua " + " ".join(["now"] * FIRST_SENTENCE_WORDS) + " week."
    draft = f"{long_open} Los Angeles's other club sits 26th of 32 against receivers. Keep him in your lineup."
    violations = validate_week_read(draft, sheet, call="start").violations
    assert any(_CAP in v for v in violations) and any(_OTHER in v for v in violations)
    correction = week_correction(sheet, draft, notes_of([(draft, violations)]), ())
    retry = _retry_prompt(sheet, [WeekAttempt(draft, "start", violations)], ())
    for ask in (correction, retry):
        assert _CAP in ask and _OTHER in ask
