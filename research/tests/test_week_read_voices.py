"""Lane 266: the week read's writer voices. A player's voice is a pure function of the season and his id,
stable across rewrites and weeks, with the board's shares about even; the ask carries his voice's brief
after the facts on the first ask, a correction (and the retry writer's ask) carries his voice's two-line reminder
once (Lane 282), and neither goes out when the voices are off; every brief and reminder keeps the site's words."""

from collections import Counter
from dataclasses import replace
from typing import Final

import pytest

from research.capsules.rule_notes import notes_of
from research.capsules.voice_rules import gate_hits
from research.capsules.week import voices
from research.capsules.week.prompt import WEEK_RULES, week_correction, week_prompt
from research.capsules.week.rules import WEEK_NEVER_WORDS
from research.capsules.week.validate import SHARED_SENTENCE, sentence_shapes, validate_week_read, week_masks
from research.capsules.week.voices import VOICES, voice_for, voice_reminder, voice_section
from research.capsules.week.write import WeekAttempt, _retry_prompt
from research.tests.week_read_fixtures import questionable, starter

_BOARD: tuple[str, ...] = tuple(f"p{n:05d}" for n in range(3000))
# Each voice's share of a 3,000-player board within 2 points of even (an even share is about 16.7%).
_SHARE_TOLERANCE = 0.02
# Ruling 1: four to six voices.
_FEWEST_VOICES, _MOST_VOICES = 4, 6


def test_the_desk_has_four_to_six_distinct_voices() -> None:
    assert _FEWEST_VOICES <= len(VOICES) <= _MOST_VOICES
    assert len({v.key for v in VOICES}) == len(VOICES)
    assert len({v.brief for v in VOICES}) == len(VOICES)


def test_a_players_voice_is_stable_for_the_season() -> None:
    for player_id in _BOARD[:50]:
        assert voice_for(2026, player_id) is voice_for(2026, player_id)
    # The week, the status and the facts never move it: only the season and the id go into the hash.
    sheet = starter()
    moved = replace(sheet, week=sheet.week + 1)
    assert voice_section(sheet, on=True) == voice_section(moved, on=True)


def test_the_season_reshuffles_the_desk() -> None:
    same = sum(voice_for(2026, p) is voice_for(2027, p) for p in _BOARD)
    assert same < len(_BOARD) / 3


def test_the_boards_shares_are_about_even() -> None:
    shares = Counter(voice_for(2026, p).key for p in _BOARD)
    even = 1 / len(VOICES)
    assert set(shares) == {v.key for v in VOICES}
    for key, count in shares.items():
        assert abs(count / len(_BOARD) - even) <= _SHARE_TOLERANCE, (key, count)


def test_the_ask_carries_his_voice_after_the_facts() -> None:
    sheet = starter()
    brief = voice_for(sheet.season, sheet.player_id).brief
    user = week_prompt(sheet, ("Start him with confidence.",))
    on = voices.VOICES_ON
    assert (brief in user) is on
    if on:
        assert user.index("Facts for the week") < user.index(brief) < user.index("Write the week-ahead read")
    ledger = notes_of([("Buy him.", validate_week_read("Buy him.", sheet).violations)])
    # A correction carries the two-line reminder, never the whole brief (Lane 282): the heaviest correction stays
    # inside the prompt bound (`WORST_PROMPT_TOKENS`, which the budgets price).
    assert brief not in week_correction(sheet, "Buy him.", ledger, ())
    # The system prompt is the same for every player, voices or not.
    assert brief not in WEEK_RULES


def test_off_the_ask_is_as_it_was(monkeypatch: pytest.MonkeyPatch) -> None:
    sheet = starter()
    monkeypatch.setattr(voices, "VOICES_ON", False)
    assert voice_section(sheet) == [] and voice_reminder(sheet) == []
    assert all(v.brief not in week_prompt(sheet, ()) for v in VOICES)
    correction = week_correction(sheet, "Buy him.", (), ())
    assert all(v.reminder not in correction for v in VOICES)
    monkeypatch.setattr(voices, "VOICES_ON", True)
    assert voice_section(sheet) == [voice_section(sheet, on=True)[0]]


@pytest.mark.parametrize("voice", VOICES, ids=lambda v: v.key)
def test_every_brief_and_reminder_keeps_the_sites_words(voice: voices.Voice) -> None:
    for text in (voice.brief, voice.reminder):
        assert "—" not in text and ";" not in text and "?" not in text
        assert gate_hits(text, ()) == []
        assert [rule.name for rule in WEEK_NEVER_WORDS if rule.pattern.search(text)] == []


@pytest.mark.parametrize("voice", VOICES, ids=lambda v: v.key)
def test_a_reminder_is_two_lines_how_it_opens_and_what_it_leans_on(voice: voices.Voice) -> None:
    opens, leans = voice.reminder.split("\n")
    assert opens.startswith("Open on ") and leans.startswith("Lean on ")
    assert len(voice.reminder) < len(voice.brief)


def test_a_correction_carries_his_voices_reminder_once_after_the_rules_broken() -> None:
    """Lane 282: about nine written reads in ten are corrections (Lane 281), so the correction names his voice and
    its two lines once, after every rule broken so far and before the answer's shape."""
    sheet = starter()
    voice = voice_for(sheet.season, sheet.player_id)
    ledger = notes_of([("Buy him.", validate_week_read("Buy him.", sheet).violations)])
    user = week_correction(sheet, "Buy him.", ledger, ("Start him with confidence.",))
    (part,) = voice_reminder(sheet, on=True)
    assert voices.VOICES_ON and user.count(part) == 1 and user.count(voice.reminder) == 1
    assert f"voice, {voice.name}," in part
    assert user.index("Every rule this read has broken") < user.index(part) < user.index("Return ONE JSON object")


def test_the_retry_writers_ask_carries_the_reminder_too() -> None:
    """The retry writer's ask on a written draft is the correction, so it carries the reminder the same way."""
    sheet = starter()
    (part,) = voice_reminder(sheet, on=True)
    attempts = [WeekAttempt("Buy him.", "start", validate_week_read("Buy him.", sheet).violations)]
    assert _retry_prompt(sheet, attempts, ()).count(part) == 1


# One sentence in each voice's manner, written for Bijan Robinson and for Puka Nacua: the same shape with his
# name, his club and his numbers swapped in (the coordinator's ruling on Lane 266 in Lane 265's round 2).
_VOICED: Final = {
    "verdict": "Start {name} this week against the {club}, whose defense ranks {rank} of 32.",
    "matchup": "The {club}' defense ranks {rank} of 32 against his position, and {name} draws them at home.",
    "role": "{name} holds the top spot on the depth chart, and the work runs through him every week.",
    "numbers": "{name} has averaged {points} points a game, and that floor holds against the {club} this week.",
    "story": "{name} has carried his club's offense all season, and this game asks the same of him again.",
    "table_talk": "Don't overthink {name} this week, he's the guy you drafted to start against the {club}.",
}


@pytest.mark.parametrize("voice", VOICES, ids=lambda v: v.key)
def test_a_voiced_read_is_held_to_the_shapes_another_page_carries(voice: voices.Voice) -> None:
    """Lane 266's voices change how a read sounds, never the shape rule: a sentence in any voice whose shape
    another page's read carries this week is refused, through the same masks (`week_masks`) as any read."""
    theirs, ours = questionable(), starter()
    template = _VOICED[voice.key]
    their_sentence = template.format(name="Bijan Robinson", club="Bears", rank="9th", points="16.1")
    our_sentence = template.format(name="Puka Nacua", club="Cardinals", rank="26th", points="21.3")
    taken = frozenset(sentence_shapes(their_sentence, week_masks((theirs, ours))))
    assert taken & set(sentence_shapes(our_sentence, week_masks((ours,))))
    result = validate_week_read(our_sentence, ours, taken, call="start")
    assert any(v.startswith(SHARED_SENTENCE) for v in result.violations), voice.key
