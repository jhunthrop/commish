"""Lane 286 (B282), four defects Lane 282's samples carried past the validator, each its own rule with its
own reason words: a rank stated twice, the member's sheet addressed, an opening set up on a colon, and a
figure spelled out. Each is refused on the sample sentence from Lane 282's report and taken on a passing
counterpart, and the correction a retry gets carries the reason."""

from typing import Final

import pytest

from research.capsules.rule_notes import notes_of
from research.capsules.week.prompt import week_correction
from research.capsules.week.rules import week_rule_violations
from research.tests.week_read_fixtures import on_bye, starter

TWICE: Final = "states the rank"
ADDRESSED: Final = "addresses the member's sheet"
COLON: Final = "opens on a set-up clause ended by a colon"
SPELLED: Final = "spells out a figure"
_OPEN: Final = "Puka Nacua is healthy for week 6 of 2026."
_TAIL: Final = " Start him in week 6 of 2026. He leads the Rams' receivers."


def _reasons(text: str, reason: str) -> list[str]:
    return [v for v in week_rule_violations(text, starter(), "start") if reason in v]


@pytest.mark.parametrize(
    ("sample", "counterpart", "reason"),
    [
        (
            # Drake London, verdict.
            "Tampa Bay has allowed the 11th-fewest PPR points a game to receivers, 11th of 32, so the matchup asks "
            "for effort but not fear.",
            "Tampa Bay sits 11th of 32 against receivers, so the matchup asks for effort but not fear.",
            TWICE,
        ),
        (
            # George Kittle, table talk.
            "The 49ers don't play in week 6, so he puts zero points on your sheet this week.",
            "The 49ers don't play in week 6, so he scores nothing this week.",
            ADDRESSED,
        ),
        (
            "Keep him on your roster and fill the spot this week.",
            "Keep him rostered and fill the spot this week.",
            ADDRESSED,
        ),
        ("He belongs in your lineup this week.", "He plays this week.", ADDRESSED),
        (
            # Justin Jefferson, story.
            "Fourteen PPR points a game over 5 games is a quiet season for Jefferson.",
            "14 PPR points a game over 5 games is a quiet season for Jefferson.",
            SPELLED,
        ),
        (
            "He has scored over twenty-five points a game across five games.",
            "He has scored 25.9 PPR points a game across 3 games.",
            SPELLED,
        ),
    ],
)
def test_each_defect_is_refused_with_its_reason_and_its_counterpart_taken(
    sample: str, counterpart: str, reason: str
) -> None:
    text = f"{_OPEN} {sample} Start him."
    found = _reasons(text, reason)
    assert found and sample in found[0], week_rule_violations(text, starter(), "start")
    assert not _reasons(f"{_OPEN} {counterpart} Start him.", reason)


@pytest.mark.parametrize(
    "opener",
    [
        # George Kittle and David Montgomery: each clause names the bye, and the colon still sets a scene.
        "Bye week for Kittle: the 49ers don't play in week 6 of 2026, so he scores nothing this week.",
        "The bye settles this week regardless: the Lions don't play in week 6 of 2026.",
    ],
)
def test_an_opening_set_up_on_a_colon_is_refused_whatever_it_names(opener: str) -> None:
    found = [v for v in week_rule_violations(f"{opener}{_TAIL}", on_bye(), "hold") if COLON in v]
    assert found and opener in found[0]


@pytest.mark.parametrize(
    "opener",
    [
        "The Lions don't play in week 6 of 2026, so the bye settles this week.",
        # A clock time's colon sets nothing up.
        "He carries no designation on the injury list as of Tuesday 6:00 pm Central.",
        # A colon after the first clause is not the opening's set-up.
        "The Lions are off in week 6 of 2026, and the reason is simple: the bye.",
    ],
)
def test_an_opening_without_a_set_up_colon_is_taken(opener: str) -> None:
    assert not [v for v in week_rule_violations(f"{opener}{_TAIL}", on_bye(), "hold") if COLON in v]


def test_zero_is_words_on_a_bye() -> None:
    """Zero is no cell's figure: "he scores zero points" is not a spelled-out figure."""
    assert not _reasons(f"{_OPEN} He scores zero points if he sits. Start him.", SPELLED)


def test_two_different_ranks_are_not_a_rank_stated_twice() -> None:
    text = "Arizona ranks 26th of 32 against receivers. He sits 3rd in our rest-of-season order. Start him."
    assert not _reasons(text, TWICE)


def test_the_retry_round_is_told_each_reason() -> None:
    """The correction a retry gets (the writer's and the retry writer's) names each rule with its sentence."""
    body = (
        "Bye week for Gibbs: the Lions don't play in week 6 of 2026. Fourteen PPR points a game is his rate. "
        "Keep him on your roster. Detroit has allowed the 9th-fewest points, 9th of 32."
    )
    violations = week_rule_violations(body, on_bye(), "hold")
    correction = week_correction(on_bye(), body, notes_of([(body, violations)]), ())
    for reason in (COLON, SPELLED, ADDRESSED, TWICE):
        assert reason in correction, reason
