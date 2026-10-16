"""Lane 50: the worn phrases refreshed from the live set of 2026-10-15 (stems on more than 3% of its
567 written pages, less the ones the sheet itself prints), and the opening and closing shapes the
writer is told to stay away from."""

import pytest

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.prompt import IN_SEASON_RULES, PRESEASON_RULES
from research.capsules.season_voice import SeasonClock
from research.capsules.validate import Grounding, validate_narrative_slot
from research.capsules.voice_rules import gate_hits, writer_only_hits


def test_the_live_sets_worn_stem_binds_new_writes() -> None:
    assert "if he is on your roster" in CAPSULE_CONFIG.repetition.validator_only_stems
    assert set(CAPSULE_CONFIG.repetition.validator_only_stems).isdisjoint(CAPSULE_CONFIG.repetition.refrain_stems)


def test_a_worn_stem_is_caught_as_written() -> None:
    assert [hit.found for hit in writer_only_hits("If he is on your roster, start him.", ())] == [
        "If he is on your roster"
    ]


# Held back: the sheet prints "Our preseason number:" and "He has not missed a game this season.",
# and the week naming the time rules require stays free.
@pytest.mark.parametrize(
    "text",
    [
        "Our preseason number was 287 points, and he is ahead of it.",
        "Our preseason number had him at 173 points.",
        "He has not missed a game, and the bye is late.",
        "Weeks 1 through 5 of 2026 went by without a start.",
    ],
)
def test_the_held_back_stems_pass(text: str) -> None:
    assert writer_only_hits(text, ()) == []


def test_a_stored_page_with_the_new_worn_stem_is_no_page_gate_target() -> None:
    assert gate_hits("If he is on your roster, start him every week.", ()) == []


OCTOBER = SeasonClock(2026, 5, (1, 2, 3, 4, 5), ())
GROUNDING = Grounding((287.0, 2026.0), (), "", None, (), None, "QB", None, None, OCTOBER)


def test_the_validator_names_the_sentence_with_the_worn_stem() -> None:
    text = "He throws deep. If he is on your roster, start him every week."
    violations = validate_narrative_slot(text, GROUNDING, 40).violations
    assert any(
        '"If he is on your roster"' in v and '"If he is on your roster, start him every week."' in v for v in violations
    ), violations


@pytest.mark.parametrize("rules", [IN_SEASON_RULES, PRESEASON_RULES], ids=["in-season", "preseason"])
def test_the_prompt_names_the_stem_and_the_shapes_to_avoid(rules: str) -> None:
    assert '"if he is on your roster"' in rules
    assert "Vary how a note opens and how it closes from one player to the next" in rules
    for shape in ('"Five weeks into 2026"', '"The story here"', '"Let him go."', '"We would let him go"'):
        assert shape in rules
