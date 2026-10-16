"""Lane 52: an ordinal is read whole. "469th overall" was read as "46" (the digit run backtracked to
dodge the letters after it), so a page whose overall rank the sheet prints as 469 was refused for an
untraced "46": 13 of the 21 untraced-number refusals in Lane 50's three samples and Lane 52's, and
the last violation of three of Lane 52's seven blocked pages. Every number still traces to the sheet:
an ordinal the sheet does not print is still refused, now as the number it is."""

import pytest

from research.capsules.grounding import extract_numbers, is_derived_from_ledger
from research.capsules.season_voice import SeasonClock
from research.capsules.validate import Grounding, validate_narrative_slot

LEDGER = [469.0, 4.9, 186.0]


@pytest.mark.parametrize(
    ("text", "numbers"),
    [
        ("he sat 469th overall, WR186", [469.0]),
        ("We had him 443rd overall before the year.", [443.0]),
        ("he was the 2nd back and the 31st pick", [2.0, 31.0]),
        ("his 1,000th yard, 12,345th play and 10000th snap", [1000.0, 12345.0, 10000.0]),
        ("1.1x touchdown share", [1.1]),
        ("He piled up 340yds and a 10x day", [340.0, 10.0]),
        ("the 49ers backfield", []),
        ("He scored 22.", [22.0]),
        ("a 34.3% share, 1,349 air yards", [34.3, 1349.0]),
    ],
)
def test_numbers_are_read_whole(text: str, numbers: list[float]) -> None:
    assert sorted(value for _, value in extract_numbers(text)) == sorted(numbers)


def test_an_ordinal_the_sheet_prints_traces_and_one_it_does_not_is_refused() -> None:
    (honest,) = extract_numbers("our board had him 469th overall")
    (invented,) = extract_numbers("our board had him 470th overall")
    assert is_derived_from_ledger(honest[1], LEDGER)
    assert not is_derived_from_ledger(invented[1], LEDGER)


def _grounding() -> Grounding:
    return Grounding(tuple(LEDGER), (), "", None, (), None, "RB", None, None, SeasonClock(2026, 5, (1, 2, 3, 4, 5)))


@pytest.mark.parametrize(
    ("sentence", "untraced"),
    [
        ("He piled up 340yds in week 5 of 2026.", "340"),
        ("He piled up 34yds in week 5 of 2026.", "34"),
        ("That is a 300yd pace.", "300"),
        ("He is a 10x better runner in week 5 of 2026.", "10"),
        # The re-review's N1: a comma-grouped or long ordinal is its whole number.
        ("He reached his 1,000th yard in week 5 of 2026.", "1,000th"),
        ("He played his 10000th snap in week 5 of 2026.", "10000th"),
    ],
)
def test_a_number_with_letters_after_it_is_still_traced(sentence: str, untraced: str) -> None:
    """The review's H1: a digit run with letters after it is read whole and held to the sheet, never
    dropped. Only an ordinal ending (read by its own rule) and "49ers" are not a number here."""
    result = validate_narrative_slot(sentence, _grounding(), 40)
    assert any(v.startswith(f'The number "{untraced}') for v in result.violations), result.violations
