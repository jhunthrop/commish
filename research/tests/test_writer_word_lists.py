"""Lane 52: the first prompt names every word and phrase the validator refuses, once, in one section
generated from the validator's own lists, so the two cannot drift; and it hands the writer the forms
the validator reads (a downside cited as a cost, a missing ADP left alone)."""

import json

import pytest

from research.capsules.claims import NO_ADP_CLAIM, NO_ADP_EXAMPLES, ClaimLedger, claim_violations
from research.capsules.config import CAPSULE_CONFIG
from research.capsules.corrections import soft_correction_for
from research.capsules.prompt import IN_SEASON_RULES, NEVER_ON_THE_PAGE, PRESEASON_RULES
from research.capsules.season_voice import SeasonClock
from research.capsules.site_words import list_file
from research.capsules.validate import COST_WORDS, banned_term_in, cites_tension
from research.capsules.voice_rules import (
    ALL_TIME_TERMS,
    ASIDE_PATTERNS,
    BETTING_PATTERNS,
    HONEST_FRAME,
    LAB_REPORT_TERMS,
    SET_PHRASES,
    SITE_WORDS,
    TRADING_TERMS,
    banned_term_pattern,
    gate_hits,
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


@pytest.mark.parametrize("rule", [*BETTING_PATTERNS, *ASIDE_PATTERNS, HONEST_FRAME, SITE_WORDS], ids=lambda r: r.name)
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


def test_the_writer_reads_the_sites_one_list_file() -> None:
    """The sweep of 2026-10-20 (C7, Y6): the site's copy guard and the writer read one file."""
    raw = json.loads(list_file().read_text(encoding="utf-8"))
    for group in ("bettingOnly", "bettingShared", "trading", "platform"):
        for word in raw[group].values():
            assert word in SITE_WORDS.shown, word
            hits = (*voice_rule_hits(f"We {word} him.", ()), *writer_only_hits(f"We {word} him.", ()))
            assert any(hit.found == word for hit in hits) or banned_term_in(f"We {word} him.") is not None, word
    assert raw["line"]["shown"] in SITE_WORDS.shown
    for mark in raw["marks"]:
        assert SITE_WORDS.pattern.search(f"a {mark} b"), mark


@pytest.mark.parametrize(
    ("text", "found"),
    [
        ("He has 15 total touchdowns this season.", "total"),
        ("The Rams keep holding this line on him.", "line"),
        ("The Bills host the Jets on Sunday.", "host"),
        ("His stock is up after week 5.", "stock"),
        ("The game ran 31 to 28 \u2013 a shootout.", "\u2013"),
    ],
)
def test_prose_that_trips_the_site_trips_the_writer(text: str, found: str) -> None:
    assert [hit.found for hit in writer_only_hits(text, ()) if hit.rule.startswith("site word")] == [found]
    # A stored page is held to it when he is next written, never failed at the gate for it.
    assert not any(hit.rule.startswith("site word") for hit in gate_hits(text, ()))


def test_the_fields_own_lines_and_a_word_already_refused_are_not_refused_twice() -> None:
    clean = "He runs behind the offensive line, scores from the goal line and the O-line holds the line of scrimmage."
    assert writer_only_hits(clean, ()) == []
    # Lane 303: lining up is football, never the betting line.
    for lining in ("Whoever lines up opposite him.", "Line up a fill-in.", "He lined up in the slot.", "They line up."):
        assert writer_only_hits(lining, ()) == [], lining
    assert [hit.found for hit in writer_only_hits("The line upset him.", ())] == ["line"]
    # "odds" is a betting word already: refused once, by its own rule.
    assert [hit.rule for hit in voice_rule_hits("The odds say he scores.", ())] == ["betting word (odds)"]
    assert writer_only_hits("The odds say he scores.", ()) == []
    # A name in the ledger is masked first: Jadarian Price is never the trading word.
    assert writer_only_hits("Jadarian Price runs hard.", ["Jadarian Price"]) == []


@pytest.mark.parametrize("text", ["His price is high.", "The market loves him.", "Buy him now."])
def test_a_trading_word_on_both_lists_is_refused_once(text: str) -> None:
    """Review 81 finding 5: the validator's banned term refuses it, the site list does not again."""
    assert banned_term_in(text) is not None
    assert not any(hit.rule.startswith("site word") for hit in writer_only_hits(text, ()))
    assert [hit.found for hit in writer_only_hits("His stock and his price rose.", ())] == ["stock"]


def test_a_clubs_city_is_a_name_and_every_other_vegas_the_bettors() -> None:
    """Review 81 finding 9: the club spellings are masked as ledger names, on both lists."""
    clean = "He scored twice against the Las Vegas Raiders, and Las Vegas had no answer."
    assert voice_rule_hits(clean, ()) == []
    assert writer_only_hits(clean, ()) == []
    assert [hit.found for hit in voice_rule_hits("Vegas likes him this week.", ())] == ["Vegas"]


def test_the_lists_own_examples_the_writer_catches_and_spares_as_the_site_does() -> None:
    """Review 81 finding 6: the file's examples tie this pattern to the site's (copy-guard.test.ts)."""
    examples = json.loads(list_file().read_text(encoding="utf-8"))["examples"]
    for text in examples["caught"]:
        assert SITE_WORDS.pattern.search(text), text
    for text in examples["spared"]:
        assert not SITE_WORDS.pattern.search(text), text
