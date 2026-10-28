"""Lane 266: the week read's writer voices. A player's voice is a pure function of the season and his id,
stable across rewrites and weeks, with the board's shares about even; the ask carries his voice's brief
after the facts on the first ask (a correction quotes the draft, already in his voice), and nothing when the voices are off; every brief keeps
the site's words."""

from collections import Counter
from dataclasses import replace

import pytest

from research.capsules.rule_notes import notes_of
from research.capsules.voice_rules import gate_hits
from research.capsules.week import voices
from research.capsules.week.prompt import WEEK_RULES, week_correction, week_prompt
from research.capsules.week.rules import WEEK_NEVER_WORDS
from research.capsules.week.validate import validate_week_read
from research.capsules.week.voices import VOICES, voice_for, voice_section
from research.tests.week_read_fixtures import starter

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
    # A correction quotes the draft, already in his voice, and carries no brief: the heaviest correction's
    # prompt bound (`WORST_PROMPT_TOKENS`, which the budgets price) is unchanged.
    assert brief not in week_correction(sheet, "Buy him.", ledger, ())
    # The system prompt is the same for every player, voices or not.
    assert brief not in WEEK_RULES


def test_off_the_ask_is_as_it_was(monkeypatch: pytest.MonkeyPatch) -> None:
    sheet = starter()
    monkeypatch.setattr(voices, "VOICES_ON", False)
    assert voice_section(sheet) == []
    assert all(v.brief not in week_prompt(sheet, ()) for v in VOICES)
    monkeypatch.setattr(voices, "VOICES_ON", True)
    assert voice_section(sheet) == [voice_section(sheet, on=True)[0]]


@pytest.mark.parametrize("voice", VOICES, ids=lambda v: v.key)
def test_every_brief_keeps_the_sites_words(voice: voices.Voice) -> None:
    text = voice.brief
    assert "—" not in text and ";" not in text and "?" not in text
    assert gate_hits(text, ()) == []
    assert [rule.name for rule in WEEK_NEVER_WORDS if rule.pattern.search(text)] == []
