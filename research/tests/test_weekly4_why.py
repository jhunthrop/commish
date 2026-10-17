"""The why lines of 2.7: the three groups with the largest absolute contribution and any other of at
least half a point, each a fact in the site's words, and every template clear of the copy rules."""

from dataclasses import replace

import pytest

from research.capsules.voice_rules import BANNED_VOCABULARY, COMPETITOR_NAMES, banned_term_pattern, voice_rule_hits
from research.model.weekly4.why import Facts, chosen_groups, sentence

FACTS = Facts(
    position="RB",
    opponent="BUF",
    opponent_rank=4,
    home=1.0,
    rest_days=7.0,
    implied_points=25.4,
    spread=3.0,
    roof="outdoors",
    wind_mph=14.0,
    temperature_f=38.0,
    precipitation=1.0,
    precipitation_probability=None,
    vacated_count=1,
    vacated_volume=2.1,
    returning_count=0,
    returning_volume=0.0,
    kind="carries",
    share_last_three=0.42,
    share_season=0.35,
    efficiency_per_100=6.0,
    efficiency_sample=54,
    efficiency_kind="carries",
)

_FORBIDDEN = ("—", ";", "favoured", "favored", "odds", "spread", "total", "line", "vegas", "tip")


def test_the_three_largest_and_any_other_of_half_a_point() -> None:
    values = {
        "role": 1.2,
        "teammates": -0.3,
        "matchup": 0.6,
        "game": 2.0,
        "weather": -0.7,
        "home_rest": 0.1,
        "efficiency": 0.2,
    }
    assert chosen_groups(values) == ["game", "role", "weather", "matchup"]


@pytest.mark.parametrize("group", ["role", "teammates", "matchup", "game", "weather", "home_rest", "efficiency"])
def test_every_sentence_keeps_the_copy_rules(group: str) -> None:
    for facts in (
        FACTS,
        replace(FACTS, spread=-2.5, home=0.0, roof="dome", returning_count=2, returning_volume=1.4),
        replace(FACTS, spread=0.0, roof=None, precipitation_probability=0.4, efficiency_per_100=-3.0),
    ):
        text = sentence(group, facts)
        lowered = text.lower()
        for word in _FORBIDDEN:
            assert word not in lowered.split() and (word not in ("—", ";") or word not in text), (group, text)
        assert not voice_rule_hits(text, [facts.opponent]), (group, text)
        assert not any(banned_term_pattern(term).search(text) for term in BANNED_VOCABULARY), (group, text)
        assert not any(name in lowered for name in COMPETITOR_NAMES), (group, text)


def test_the_game_sentence_speaks_of_winning_not_of_a_figure() -> None:
    assert sentence("game", FACTS) == "His team is expected to score 25 and to win by 3"
    losing = replace(FACTS, spread=-3.5)
    assert sentence("game", losing) == "His team is expected to score 25 and to lose by 3.5"
    even = replace(FACTS, spread=0.0)
    assert sentence("game", even) == "His team is expected to score 25 in an even game"
