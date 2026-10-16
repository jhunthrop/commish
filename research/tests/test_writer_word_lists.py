"""Lane 52: the first prompt names every word and phrase the validator refuses, once, in one section
generated from the validator's own lists, so the two cannot drift; and it hands the writer the forms
the validator reads (a downside cited as a cost, a missing ADP left alone)."""

import pytest

from research.capsules.claims import NO_ADP_CLAIM, NO_ADP_EXAMPLES, ClaimLedger, claim_violations
from research.capsules.config import CAPSULE_CONFIG
from research.capsules.corrections import soft_correction_for
from research.capsules.prompt import IN_SEASON_RULES, NEVER_ON_THE_PAGE, PRESEASON_RULES
from research.capsules.season_voice import SeasonClock
from research.capsules.validate import COST_WORDS, cites_tension
from research.capsules.voice_rules import (
    ALL_TIME_TERMS,
    ASIDE_PATTERNS,
    BETTING_PATTERNS,
    HONEST_FRAME,
    LAB_REPORT_TERMS,
    SET_PHRASES,
    TRADING_TERMS,
    banned_term_pattern,
    voice_rule_hits,
    writer_only_hits,
)

RULES = (PRESEASON_RULES, IN_SEASON_RULES)
WORD_LISTS = (
    TRADING_TERMS,
    LAB_REPORT_TERMS,
    ALL_TIME_TERMS,
    SET_PHRASES,
    CAPSULE_CONFIG.repetition.validator_only_stems,
)


@pytest.mark.parametrize("words", WORD_LISTS)
def test_every_word_the_validator_refuses_is_in_the_one_list(words: tuple[str, ...]) -> None:
    for word in words:
        assert f'"{word}"' in NEVER_ON_THE_PAGE, word


def test_the_list_words_are_refused_by_the_validator() -> None:
    for word in (*TRADING_TERMS, *LAB_REPORT_TERMS, *ALL_TIME_TERMS):
        assert banned_term_pattern(word).search(f"We {word} him now."), word
    for phrase in SET_PHRASES:
        assert voice_rule_hits(f"Yes, {phrase} here.", ()), phrase
    for stem in CAPSULE_CONFIG.repetition.validator_only_stems:
        assert writer_only_hits(f"Yes, {stem} here.", ()), stem


@pytest.mark.parametrize("rule", [*BETTING_PATTERNS, *ASIDE_PATTERNS, HONEST_FRAME], ids=lambda r: r.name)
def test_every_pattern_rule_shows_words_it_refuses_and_the_list_carries_them(rule: object) -> None:
    shown = getattr(rule, "shown", ())
    assert shown, f"{getattr(rule, 'name', rule)} lists no words for the prompt"
    pattern = getattr(rule, "pattern", None)
    assert pattern is not None
    for word in shown:
        if rule is not HONEST_FRAME:
            assert pattern.search(word), word
            assert f'"{word}"' in NEVER_ON_THE_PAGE, word
        else:
            assert pattern.search("the honest worry")
            assert word in NEVER_ON_THE_PAGE


def test_the_list_sits_in_one_place_in_both_voices_and_names_no_rival() -> None:
    for rules in RULES:
        assert rules.count(NEVER_ON_THE_PAGE) == 1
        assert "Never these trading words" not in rules
        assert "Phrases this board has worn out" not in rules
        for name in ("espn", "yahoo", "draftkings", "fanduel", "ffpc"):  # "sleeper" and "underdog" are words
            assert name not in rules.lower(), name


def test_the_writer_is_told_the_cost_words_the_validator_reads() -> None:
    for rules in RULES:
        for word in COST_WORDS:
            assert f'"{word}"' in rules, word
    correction = soft_correction_for(
        "Mixed evidence: the strongest downside (-6.2 pts/game) is never cited. It has to appear, with that number, before the call."
    )
    assert correction is not None
    assert "has cost players in his spot 6.2 points a game on average" in correction
    assert all(f'"{word}"' in correction for word in COST_WORDS)


def test_the_cost_form_passes_and_worth_alone_does_not() -> None:
    """The rule is unchanged (Henry's attempt 4 of Lane 50's arm A, "worth 6.2 points a week in
    regression risk", stays refused); the writer is handed the form it reads."""
    assert cites_tension("That costs him 6.2 points a game.", -6.2)
    assert cites_tension("The touchdown share shaves 6.2 a game off him.", -6.2)
    assert not cites_tension("A 34.3% touchdown share worth 6.2 points a week in regression risk.", -6.2)


def test_dock_cites_the_downside_as_a_cost_and_still_needs_its_number() -> None:
    """The coordinator's ruling (Lane 52): "dock", "docks" and "docked" are cost words."""
    assert cites_tension("Our numbers dock him 6.2 a game for it.", -6.2)
    assert cites_tension("The touchdown reliance docks him 6.2 points a game.", -6.2)
    assert cites_tension("He was docked 6.2 points a game before the season.", -6.2)
    assert not cites_tension("Our numbers dock him for how top-heavy his scoring is.", -6.2)
    assert not cites_tension("Our numbers dock him 1.4 a game for the inside-ten work.", -6.2)


@pytest.mark.parametrize("example", NO_ADP_EXAMPLES)
def test_each_missing_adp_claim_the_prompt_names_is_one_the_rule_refuses(example: str) -> None:
    ledger = ClaimLedger(SeasonClock(2026, 5), None, None, None, None)
    found = claim_violations(f"He is a bench piece, {example}.", ledger)
    assert any(v.startswith(NO_ADP_CLAIM) for v in found), example
    for rules in RULES:
        assert f'"{example}"' in rules
