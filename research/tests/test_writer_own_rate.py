"""The coordinator's M3 ruling (Lane 52): a law's figure is a population average, so the sheet says so,
and the validator refuses a per-game cost or gain put on the player that is larger than his own
points a game ("costs him 13.7 points a game" on a back scoring 8.9): he cannot lose more than he scores."""

from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

import pytest

from research.capsules.corrections import soft_correction_for
from research.capsules.facts.model import LawEvidence
from research.capsules.own_rate import OWN_RATE_VIOLATION, own_points_per_game, own_rate_violations
from research.capsules.render import law_line
from research.capsules.rule_notes import notes_of

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

OWN = 8.9


def test_the_sheet_states_a_laws_figure_as_the_average_change_among_players_in_his_spot() -> None:
    falls = LawEvidence("law", "touchdownPointsShare", "39.2% touchdown-points share", -13.7, 4)
    rises = LawEvidence("law", "targetShare", "30.3% target share", 10.1, 1)
    assert law_line(falls) == (
        "39.2% touchdown-points share: among players in his spot, points a game fell 13.7 on average from one "
        "season to the next, net of 4 factors."
    )
    assert law_line(rises) == (
        "30.3% target share: among players in his spot, points a game rose 10.1 on average from one season to the next."
    )


def _facts(season: float | None, last: float | None, points: float, games: float | None) -> "PlayerFacts":
    return cast(
        "PlayerFacts",
        SimpleNamespace(
            season=None if season is None else SimpleNamespace(points_per_game=season),
            last_season_story=None if last is None else SimpleNamespace(points_per_game=last),
            projection=SimpleNamespace(projected_points=points),
            availability=None if games is None else SimpleNamespace(expected_games=games),
        ),
    )


def test_his_own_points_a_game_is_the_largest_per_game_figure_the_sheet_prints_for_him() -> None:
    assert own_points_per_game(_facts(8.9, 6.4, 62, 12)) == pytest.approx(8.9)
    assert own_points_per_game(_facts(None, 16.4, 212, 15)) == pytest.approx(16.4)
    assert own_points_per_game(_facts(None, None, 212, 15)) == pytest.approx(212 / 15)
    assert own_points_per_game(_facts(None, None, 212, None)) is None


@pytest.mark.parametrize(
    "sentence",
    [
        "Our touchdown model costs him 13.7 points a game on that profile.",
        "The missing goal-line work docks him 13.7 a game.",
        "His target share adds about 10.1 points a game.",
        "The volume gains him 12 points per game.",
        "That shaves another 9.5 a game off him.",
    ],
)
def test_a_per_game_figure_larger_than_his_own_scoring_put_on_him_is_refused(sentence: str) -> None:
    (violation,) = own_rate_violations(sentence, OWN)
    assert violation.startswith(OWN_RATE_VIOLATION)
    assert "8.9 points a game" in violation and "cannot" in violation


@pytest.mark.parametrize(
    "sentence",
    [
        "That profile costs him 1.6 points a game.",
        "Among players in his spot, points a game fell 13.7 on average from one season to the next.",
        "That touchdown profile has cost players in his spot 13.7 points a game on average.",
        "He has scored 22 points a game.",
    ],
)
def test_a_figure_within_his_scoring_or_stated_as_the_average_passes(sentence: str) -> None:
    assert own_rate_violations(sentence, OWN) == []


def test_no_figure_of_his_own_means_no_refusal() -> None:
    assert own_rate_violations("It costs him 13.7 points a game.", None) == []


def test_the_correction_and_the_note_name_the_sentence() -> None:
    sentence = "Our touchdown model costs him 13.7 points a game on that profile."
    (violation,) = own_rate_violations(sentence, OWN)
    correction = soft_correction_for(violation)
    assert correction is not None and sentence in correction
    (note,) = notes_of([(sentence, (violation,))])
    assert note.sentence == sentence
