"""Lane 75, nightly-rrl84 and nightly-869c4: Devin Neal's draft fell to its facts block with
`The name "Audric Estim" does not trace to any supplied fact.` The sheet printed "Audric Estimé"; the
name reader stopped at the first letter outside ASCII and traced the stub. The ruling: a name traces on
NFKD-normalised, accent-stripped, case-folded text, whole name; a truncated name is still refused, and
its violation then names the full name the sheet carries, so the fallback line shows the cause."""

from dataclasses import replace

import pytest

from research.capsules.grounding import is_name_grounded, proper_name_phrases
from research.capsules.names import fold_name
from research.capsules.rule_notes import note_of
from research.capsules.week.sheet import DepthPlace, WeekSheet
from research.capsules.week.validate import validate_week_read
from research.tests.week_read_fixtures import starter

SHEET_NAME = "Audric Estimé"
LEDGER = ("Devin Neal", "Devin", "Neal", SHEET_NAME, "Audric", "Estimé")
TRUNCATED = 'The name "Audric Estim" does not trace to any supplied fact. The sheet carries "Audric Estimé".'


def neal() -> WeekSheet:
    """Devin Neal's week, Audric Estimé listed with him on the chart."""
    return replace(
        starter(),
        player_id="00-0040000",
        name="Devin Neal",
        position="RB",
        team="NO",
        depth=DepthPlace(1.0, ((SHEET_NAME, 2.0),)),
    )


def test_fold_name_strips_accents_and_case() -> None:
    assert fold_name("Audric Estimé") == fold_name("audric estime") == "audric estime"
    # A decomposed accent (an e and a combining acute) folds like the precomposed one.
    assert fold_name("Estimé") == "estime"


def test_the_name_reader_keeps_the_accent() -> None:
    assert proper_name_phrases("Audric Estimé takes the early downs.") == ["Audric Estimé"]
    assert proper_name_phrases("Behind him sits Élan Ñúñez now.") == ["Élan Ñúñez"]


@pytest.mark.parametrize("written", ["Audric Estimé", "Audric Estime", "AUDRIC ESTIMÉ"])
def test_the_whole_name_traces_with_or_without_its_accent(written: str) -> None:
    assert is_name_grounded(written, LEDGER)


def test_a_truncated_name_is_still_refused() -> None:
    assert not is_name_grounded("Audric Estim", LEDGER)


def _name_violations(text: str) -> list[str]:
    result = validate_week_read(text, neal())
    return [v for v in result.violations if v.startswith("The name ")]


@pytest.mark.parametrize("written", ["Audric Estimé", "Audric Estime"])
def test_the_week_read_traces_the_teammate(written: str) -> None:
    assert _name_violations(f"Devin Neal shares the backfield with {written} in week 6 of 2026.") == []


def test_the_truncated_teammate_names_what_the_sheet_carries() -> None:
    text = "Devin Neal shares the backfield with Audric Estim in week 6 of 2026."
    assert _name_violations(text) == [TRUNCATED]


def test_an_untraced_name_with_no_near_name_says_nothing_more() -> None:
    text = "Devin Neal shares the backfield with Kendre Miller in week 6 of 2026."
    assert _name_violations(text) == ['The name "Kendre Miller" does not trace to any supplied fact.']


def test_the_rule_note_reads_the_named_violation() -> None:
    body = "Devin Neal shares the backfield with Audric Estim in week 6 of 2026."
    assert note_of(TRUNCATED, body).rule == 'an untraced name, "Audric Estim"'
