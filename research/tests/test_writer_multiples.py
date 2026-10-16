"""Lane 52's review (M2): a comparison word ("double", "twice", "half", "triple") only where the two
figures stand within a tenth of that ratio. A new rule, a tightening."""

import pytest

from research.capsules.corrections import soft_correction_for
from research.capsules.multiples import MULTIPLE_VIOLATION, multiple_violations
from research.capsules.prompt import IN_SEASON_RULES, PRESEASON_RULES
from research.capsules.rule_notes import notes_of


@pytest.mark.parametrize(
    "text",
    [
        # Henry's short note in the sample: 22 is 1.56 times 14.1.
        "Eight touchdowns in five games and 22 points a game, almost double our preseason pace of 14.1.",
        "He is running at 8.9 a game, double his preseason pace of 5.2.",
        "His targets doubled, from 30 to 45.",
        "Our preseason pace was 5.7 a game. He is running at barely half of that, 3.8 a game.",
        "He is scoring triple the 4.1 a game we expected, at 9.0.",
        "That is twice as many targets, 18 against 12.",
        # The re-review's N6: the other forms of the claim.
        "His targets halved, from 30 to 20.",
        "That doubles his 7.0 a game, at 12.0.",
        "It was a 2x jump, 9.0 against 6.0.",
        "He is at one and a half times his 8.0 a game, at 16.0.",
    ],
)
def test_a_multiple_the_figures_do_not_make_is_refused(text: str) -> None:
    (violation,) = multiple_violations(text)
    assert violation.startswith(MULTIPLE_VIOLATION)


@pytest.mark.parametrize(
    "text",
    [
        "He is running at 28.0 a game, double his preseason pace of 14.1.",
        "His targets doubled, from 22 to 45.",
        "Our preseason pace was 5.7 a game. He is running at barely half of that, 2.9 a game.",
        "He is scoring triple the 3.1 a game we expected, at 9.0.",
        "That is twice as many targets, 24 against 12.",
        # The word's other senses.
        "He had a double-digit week in week 3 of 2026.",
        "He scored twice in week 5 of 2026.",
        "The second half of 2025 was his best stretch.",
        "He drew a double team in week 2 of 2026.",
        "His targets halved, from 30 to 15.",
        "That doubles his 7.0 a game, at 14.0.",
        "It was a 2x jump, 9.0 against 4.5.",
        "He is at one and a half times his 8.0 a game, at 12.0.",
        # The re-review's N5: "half" that compares no two figures.
        "Half of his targets came late in 2025.",
        "He has half a chance to start in week 7 of 2026.",
        "He missed half the season in 2025.",
        "Half of his carries came late in 2025.",
    ],
)
def test_a_multiple_the_figures_make_or_another_sense_passes(text: str) -> None:
    assert multiple_violations(text) == []


def test_a_season_is_never_one_side_of_a_multiple() -> None:
    assert multiple_violations("In 2026 he is scoring double his 2025 output, 1013 yards.") != []


def test_the_writer_is_told_and_the_correction_and_note_name_the_sentence() -> None:
    text = "He is running at 8.9 a game, double his preseason pace of 5.2."
    (violation,) = multiple_violations(text)
    correction = soft_correction_for(violation)
    assert correction is not None and text in correction
    (note,) = notes_of([(text, (violation,))])
    assert note.sentence == text
    for rules in (PRESEASON_RULES, IN_SEASON_RULES):
        assert "double, twice, half or triple" in rules


@pytest.mark.parametrize(
    "text",
    [
        # Round 3 (the re-review's R2-H1): every hedged or object-bearing multiple is a claim.
        "He is at 22, almost double.",
        "He is at 22, nearly double it.",
        "He is at 22, double his 14.1.",
        "He is at 22, twice the 14.1 we expected.",
        "He is at 22, twice his 14.1 of last year.",
        "He is at 22 against our 14.1, almost double.",
        "Almost double the 14.1, he is at 22.",
        "He is at 22, close to half of his 14.1.",
        "He is at 22, nearly double those 14.1 points.",
        "He is at 22, double our 14.1 pace.",
    ],
)
def test_every_hedged_or_object_bearing_multiple_is_a_claim(text: str) -> None:
    (violation,) = multiple_violations(text)
    assert violation.startswith(MULTIPLE_VIOLATION)


@pytest.mark.parametrize(
    "text",
    [
        "Half of his targets came late in 2025.",
        "He has half a chance to start in week 7 of 2026.",
        "He missed half the season in 2025.",
        "He sees the field twice a week in practice.",
        "He had a double-digit week in week 3 of 2026.",
        "He drew a double team in week 2 of 2026.",
        "He drew double coverage in week 2 of 2026.",
        "He split half of his snaps with Hall in 2025.",
        "He runs with half our guys.",
        "The second half of 2025 was his best stretch.",
        "He scored twice in week 5 of 2026.",
    ],
)
def test_the_named_non_comparisons_pass(text: str) -> None:
    assert multiple_violations(text) == []


@pytest.mark.parametrize(
    "text",
    [
        # Round 4 (the re-review's R3-H1): only a named counted noun is exempt, and only with no figure after it.
        "He is at 9, half of his last season pace of 14.1.",
        "He is at 9, half of his expected 14.1.",
        "He is at 9, half of his old number of 14.1.",
        "He is at 9, half of his career-best 14.1.",
        "He is at 9, half of his targets from 14.1 a game.",
    ],
)
def test_half_of_his_anything_but_a_named_count_is_a_claim(text: str) -> None:
    (violation,) = multiple_violations(text)
    assert violation.startswith(MULTIPLE_VIOLATION)
