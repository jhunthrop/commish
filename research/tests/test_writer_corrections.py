"""Lane 52: a retry tells the writer exactly what it got wrong. Every correction carries each rule
the note has broken on any attempt so far: the rule's name, the sentence it was broken in, word for
word, and the rule in one line. A read that misses its length is still read for every other rule,
so the length correction asks for all of it at once. Lane 50's samples ended 37 of 41 failing reads
on a rule the attempt before had not broken."""

import pytest

from research.capsules.claims import NO_ADP_CLAIM
from research.capsules.generate import _next_correction, _Read
from research.capsules.prompt import PriorAttempt, correction_request
from research.capsules.rule_notes import RuleNote, notes_of
from research.capsules.season_voice import SeasonClock
from research.capsules.validate import BandFailure, Grounding, ValidationResult, validate_narrative_slot

BYE = "Hold him through the week 6 bye, and see what week 7 brings."
BET = "He is a safe bet to finish as a starter."
MIXED = "Mixed evidence: the strongest downside (-6.2 pts/game) is never cited. It has to appear, with that number, before the call."
_BYE_VIOLATION = f'The text carries a time frame (a week without its season), "week 6", in the sentence "{BYE}". Rewrite that sentence.'
_BET_VIOLATION = f'The text carries a betting word (a bet), "bet", in the sentence "{BET}". Rewrite that sentence.'


@pytest.mark.parametrize(
    ("violation", "body", "rule", "sentence"),
    [
        (_BYE_VIOLATION, BYE, 'time frame (a week without its season), "week 6"', BYE),
        (_BET_VIOLATION, BET, 'betting word (a bet), "bet"', BET),
        (
            'The text carries a set phrase, "is the whole case", in the sentence "That climb is the whole case for him.". '
            "Rewrite that sentence.",
            "That climb is the whole case for him.",
            'set phrase, "is the whole case"',
            "That climb is the whole case for him.",
        ),
        (MIXED, "Any text.", "mixed evidence uncited", None),
        (
            'The number "17.5" does not trace to any supplied fact.',
            "He gets 22 touches. He scored 17.5 in week 2 of 2026.",
            'an untraced number, "17.5"',
            "He scored 17.5 in week 2 of 2026.",
        ),
        (
            f'{NO_ADP_CLAIM}: the sentence "Nobody drafted him." says "Nobody drafted". The page has no ADP for him, which '
            "means only that our sources have none, and that says nothing about who drafted him. Leave drafters out of it.",
            "Nobody drafted him.",
            NO_ADP_CLAIM,
            "Nobody drafted him.",
        ),
        ("Word count 231 is outside the required 240-300 word band.", "Any text.", "length", None),
        ("The text contains a semicolon. Split it into two sentences instead.", "A; b. C.", "a semicolon", "A; b."),
    ],
)
def test_each_violation_names_its_rule_its_sentence_and_the_rule_in_one_line(
    violation: str, body: str, rule: str, sentence: str | None
) -> None:
    (note,) = notes_of([(body, (violation,))])
    assert note.rule == rule
    assert note.sentence == sentence
    assert note.statement
    assert "\n" not in note.statement


@pytest.mark.parametrize(
    ("violation", "statement"),
    [
        (
            'The text states an ADP or a pick that is not his ADP on the page: "pick 43", and the page has no ADP '
            "for him. Say no ADP or pick at all.",
            "The page has no ADP for him. Say no ADP or pick at all.",
        ),
        (
            'The text states an ADP or a pick that is not his ADP on the page: "ADP 98.2". His ADP is 104.7 or 105. '
            "Say exactly that, or say no ADP.",
            "His ADP is 104.7 or 105. Say exactly that, or say no ADP.",
        ),
    ],
)
def test_an_adp_note_states_the_remedy_alone(violation: str, statement: str) -> None:
    """The review's L3: the no-ADP shape carried its whole violation as its statement."""
    (note,) = notes_of([("He went at pick 43. ADP 98.2 then.", (violation,))])
    assert note.statement == statement


def test_every_statement_keeps_the_copy_rules() -> None:
    violations = [
        _BYE_VIOLATION,
        _BET_VIOLATION,
        MIXED,
        "Word count 231 is outside the required 240-300 word band.",
        "The text contains an em-dash. Rewrite without one.",
        'The text carries an aside (the first person singular), "I", in the sentence "I like him.". Rewrite that sentence.',
        'The text carries a time frame (a month), "October", in the sentence "By October he is back.". Rewrite that sentence.',
    ]
    for note in notes_of([("I like him. By October he is back.", tuple(violations))]):
        assert chr(0x2014) not in note.statement
        assert ";" not in note.statement


def test_a_rule_broken_twice_in_one_sentence_is_listed_once() -> None:
    notes = notes_of([(BYE, (_BYE_VIOLATION,)), (BYE, (_BYE_VIOLATION,))])
    assert len(notes) == 1


def test_a_correction_carries_every_rule_broken_on_every_attempt_so_far() -> None:
    first = f"{BYE} He is worth 22 points a game."
    second = f"{BET} He is worth 22 points a game."
    read = (
        _Read()
        .graded("draft", first, ValidationResult(False, (_BYE_VIOLATION,)), None, 0)
        .graded("soft", second, ValidationResult(False, (_BET_VIOLATION, MIXED)), None, 1)
    )
    prior = _next_correction(read)
    assert prior is not None
    request = correction_request("full", prior)
    for expected in (
        'time frame (a week without its season), "week 6"',
        BYE,
        'betting word (a bet), "bet"',
        BET,
        "mixed evidence uncited",
        *(note.statement for note in prior.ledger),
    ):
        assert expected in request
    assert [n.rule for n in prior.ledger] == [
        'time frame (a week without its season), "week 6"',
        'betting word (a bet), "bet"',
        "mixed evidence uncited",
    ]


def test_a_length_correction_also_asks_for_every_other_rule() -> None:
    long_text = " ".join(["word"] * 10) + "; then more."
    read = _Read().graded(
        "draft",
        long_text,
        ValidationResult(
            False,
            ("Word count 320 is outside the required 240-300 word band.", _BYE_VIOLATION),
            BandFailure(320, 240, 300),
        ),
        None,
        0,
    )
    prior = _next_correction(read)
    assert isinstance(prior, PriorAttempt)
    assert prior.kind == "length"
    request = correction_request("full", prior)
    assert "Bring it to 270 words" in request
    assert BYE in request


def _grounding() -> Grounding:
    return Grounding((), (), "", None, (), None, "RB", None, None, SeasonClock(2026))


def test_a_read_out_of_its_band_is_still_read_for_every_other_rule() -> None:
    result = validate_narrative_slot("He runs hard; he scores often and he is a safe bet now.", _grounding(), 5)
    assert not result.ok
    assert result.band_failure is not None
    assert result.violations[0].startswith("Word count")
    assert any("semicolon" in v for v in result.violations)
    assert any('"bet"' in v for v in result.violations)


def test_a_note_without_a_sentence_reads_as_its_rule_alone() -> None:
    note = RuleNote("mixed evidence uncited", None, "The downside appears with its number.")
    assert note.line() == "- mixed evidence uncited: The downside appears with its number."
    with_sentence = RuleNote("a semicolon", "A; b.", "Never a semicolon.")
    assert with_sentence.line() == '- a semicolon, in "A; b.": Never a semicolon.'
