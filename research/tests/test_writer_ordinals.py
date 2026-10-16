"""Lane 52: an ordinal is read whole. "469th overall" was read as "46" (the digit run backtracked to
dodge the letters after it), so a page whose overall rank the sheet prints as 469 was refused for an
untraced "46": 13 of the 21 untraced-number refusals in Lane 50's three samples and Lane 52's, and
the last violation of three of Lane 52's seven blocked pages. Every number still traces to the sheet:
an ordinal the sheet does not print is still refused, now as the number it is."""

import pytest

from research.capsules.grounding import extract_numbers, is_derived_from_ledger

LEDGER = [469.0, 4.9, 186.0]


@pytest.mark.parametrize(
    ("text", "numbers"),
    [
        ("he sat 469th overall, WR186", [469.0]),
        ("We had him 443rd overall before the year.", [443.0]),
        ("he was the 2nd back and the 31st pick", [2.0, 31.0]),
        ("1.1x touchdown share", [1.0]),
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
