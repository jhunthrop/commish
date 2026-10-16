"""Lane 52, the time frame rules the writer failed most (Lane 50's samples: a bare week on 115 attempts,
points a game against the season number on 39). The rules are unchanged. The sheet hands the writer
the per-game figure it kept reaching for, our preseason pace, so a pace can be set against a pace; and
the prompt names the shapes the bare week took (a bye, a stretch, "through week 5")."""

from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

import pytest

from research.capsules.prompt import IN_SEASON_RULES
from research.capsules.render import preseason_pace_line
from research.capsules.season_voice import SeasonClock, time_frame_hits

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

CLOCK = SeasonClock(2026, 5, (1, 2, 3, 4, 5))


def _facts(points: float, games: float | None, *, in_season: bool = True) -> "PlayerFacts":
    availability = None if games is None else SimpleNamespace(expected_games=games)
    return cast(
        "PlayerFacts",
        SimpleNamespace(
            projection=SimpleNamespace(projected_points=points),
            availability=availability,
            season=SimpleNamespace() if in_season else None,
        ),
    )


def test_in_season_the_sheet_prints_our_preseason_number_as_a_pace() -> None:
    # 212 points over the 15 games we expected, from the printed whole numbers: 14.1 a game.
    assert preseason_pace_line(_facts(212.4, 14.6)) == (
        "Our preseason pace: 14.1 points a game, our 212 points over the 15 games we expected."
    )


def test_no_pace_before_the_season_or_without_expected_games() -> None:
    assert preseason_pace_line(_facts(212.4, 14.6, in_season=False)) is None
    assert preseason_pace_line(_facts(212.4, None)) is None
    assert preseason_pace_line(_facts(212.4, 0.2)) is None


@pytest.mark.parametrize(
    "sentence",
    [
        "Our preseason pace was 14.1 a game, and he is at 22.0 a game through week 5 of 2026.",
        "We expected about 14.1 points a game from him, and he has given 22.0.",
        "Spread over the 15 games we expected, our preseason number of 212 points is 14.1 a game.",
    ],
)
def test_a_pace_set_against_our_preseason_pace_passes_the_rule(sentence: str) -> None:
    assert time_frame_hits(sentence, CLOCK) == []


@pytest.mark.parametrize(
    "sentence",
    [
        "Our preseason number was 212 points, and at 22.0 a game he is well past it.",
        "Hold him through the week 13 bye.",
        "Nothing through week 5 supports it.",
    ],
)
def test_the_rules_still_refuse_what_they_refused(sentence: str) -> None:
    assert time_frame_hits(sentence, CLOCK) != []


def test_the_prompt_names_the_bye_and_the_stretch_and_the_pace() -> None:
    assert '"his bye in week 13 of 2026"' in IN_SEASON_RULES
    assert '"the week 13 bye"' in IN_SEASON_RULES
    assert '"through week 5 of 2026"' in IN_SEASON_RULES
    assert "our preseason pace" in IN_SEASON_RULES
    for sentence in ("His bye in week 13 of 2026 is still ahead.", "Through week 5 of 2026 he has 8 touchdowns."):
        assert time_frame_hits(sentence, CLOCK) == []
