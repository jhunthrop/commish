"""Lane 50: the worn phrases refreshed from the live set of 2026-10-15 (stems on more than 3% of its
567 written pages), a number in a stem read as any number, and the opening and closing shapes the
writer is told to stay away from."""

import pytest

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.prompt import IN_SEASON_RULES, PRESEASON_RULES
from research.capsules.season_voice import SeasonClock
from research.capsules.validate import Grounding, validate_narrative_slot
from research.capsules.voice_rules import gate_hits, writer_only_hits

NEW_STEMS = (
    "our preseason number was # points",
    "our preseason number had him at",
    "he has not missed a game",
    "our preseason number gave him #",
    "if he is on your roster",
)


def test_the_live_sets_worn_stems_bind_new_writes() -> None:
    for stem in NEW_STEMS:
        assert stem in CAPSULE_CONFIG.repetition.validator_only_stems
    assert set(CAPSULE_CONFIG.repetition.validator_only_stems).isdisjoint(CAPSULE_CONFIG.repetition.refrain_stems)


@pytest.mark.parametrize(
    ("text", "found"),
    [
        ("Our preseason number was 287 points, and he is ahead of it.", "Our preseason number was 287 points"),
        ("Our preseason number was 56.5 points for the year.", "Our preseason number was 56.5 points"),
        ("Our preseason number gave him 6 expected games.", "Our preseason number gave him 6"),
        ("Our preseason number had him at 173 points.", "Our preseason number had him at"),
        ("He has not missed a game, and the bye is late.", "He has not missed a game"),
        ("If he is on your roster, start him.", "If he is on your roster"),
    ],
)
def test_a_worn_stem_is_caught_with_its_number(text: str, found: str) -> None:
    assert [hit.found for hit in writer_only_hits(text, ())] == [found]


@pytest.mark.parametrize(
    "text",
    [
        # The week naming the time rules require stays free (the stem "weeks # through # of #" is held back).
        "Weeks 1 through 5 of 2026 went by without a start.",
        "We had him at 287 points before the season, and he is ahead of it.",
        "Our preseason number of 287 points still stands.",
        "He has not missed a single snap of note.",
    ],
)
def test_the_free_phrasings_pass(text: str) -> None:
    assert writer_only_hits(text, ()) == []


def test_a_stored_page_with_a_new_worn_stem_is_no_page_gate_target() -> None:
    assert gate_hits("Our preseason number was 287 points. He has not missed a game. Start him.", ()) == []


OCTOBER = SeasonClock(2026, 5, (1, 2, 3, 4, 5), ())
GROUNDING = Grounding((287.0, 2026.0), (), "", None, (), None, "QB", None, None, OCTOBER)


def test_the_validator_names_the_sentence_with_the_worn_stem() -> None:
    text = "He throws deep. Our preseason number was 287 points, and he is ahead of it."
    violations = validate_narrative_slot(text, GROUNDING, 40).violations
    assert any(
        '"Our preseason number was 287 points"' in v
        and '"Our preseason number was 287 points, and he is ahead of it."' in v
        for v in violations
    ), violations


@pytest.mark.parametrize("rules", [IN_SEASON_RULES, PRESEASON_RULES], ids=["in-season", "preseason"])
def test_the_prompt_names_the_stems_and_the_shapes_to_avoid(rules: str) -> None:
    assert '"our preseason number was N points"' in rules
    assert "N stands for any number" in rules
    assert "Vary how a note opens and how it closes from one player to the next" in rules
    for shape in ('"Five weeks into 2026"', '"The story here"', '"Let him go."', '"If he is on your roster"'):
        assert shape in rules
