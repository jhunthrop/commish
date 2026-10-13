"""THE TEMPLATE CAPSULE: the counted fallback when the writer does not produce a read that validates.

Ruled (coordinator, phase C fix round 1): a template capsule is allowed only as a counted fallback,
stored `source = 'template'`, and the nightly fails the run when they pass 2% of the board
(`research.nightly.capsule_gate`). It states the player's own numbers with their basis, in
sentences built from his facts, and never a stock sentence: no fixed prose line may appear on two
players' pages. So there is no sentence without a fact in it (no "we have not checked an injury
feed"; an absent fact is simply not said), and every sentence carries him: his name, or his
overall board rank, which no two players share (a law, which teammates share, goes under his full
name).

Ported in its facts from `research-ts/src/capsules/template.ts`; its sentences are this lane's.
Every number is the sheet's; a projection under ten points prints to the tenth, the precision the
page's pull figure reads it at.
"""

from typing import TYPE_CHECKING, Final

from research.capsules.facts.model import InjuryClean, InjuryDesignated, LawEvidence
from research.capsules.render_words import whole
from research.capsules.voice_rules import in_fantasy_words
from research.model.jsmath import js_to_fixed
from research.pipeline.jscompat import js_string

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

TEMPLATE_CAPSULE_NOTE: Final = "A summary from the numbers."
_WHOLE_NUMBER_FLOOR: Final = 10
_NAME_SUFFIXES: Final = frozenset({"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"})


def surname(name: str) -> str:
    """The name a sentence calls him by after the first: his last name, a suffix skipped."""
    parts = name.split()
    while len(parts) > 1 and parts[-1].lower() in _NAME_SUFFIXES:
        parts = parts[:-1]
    return parts[-1] if parts else name


def _projection(points: float) -> str:
    return whole(points) if abs(points) >= _WHOLE_NUMBER_FLOOR else js_to_fixed(points, 1)


def _opening(facts: "PlayerFacts") -> str:
    identity, availability = facts.identity, facts.availability
    over = (
        ""
        if availability is None
        else f" over the {js_to_fixed(availability.expected_games, 1)} games we expect him to play"
    )
    return (
        f"{identity.name} ({identity.position}, {identity.team}) projects for "
        f"{_projection(facts.projection.projected_points)} points this season{over}."
    )


def _ranges(facts: "PlayerFacts", called: str) -> str:
    p = facts.projection
    return (
        f"{called}'s middle range runs {whole(p.typical_low)} to {whole(p.typical_high)} points, "
        f"and his full range {whole(p.floor_points)} to {whole(p.ceiling_points)}."
    )


def _standing(facts: "PlayerFacts", called: str) -> str:
    """His place on the board and in drafts, his bye and his injury status: one sentence, carried by
    his overall rank."""
    market, injury = facts.market, facts.injury
    taken = "has no ADP" if market.adp is None else f"goes at ADP {js_string(market.adp)}"
    parts = [f"{called} {taken} and is {market.board_rank} overall on our board"]
    if facts.bye_week is not None:
        parts.append(f"his bye is week {facts.bye_week}")
    if isinstance(injury, InjuryDesignated):
        parts.append(f"the {injury.as_of[:10]} injury report lists him {injury.designation}")
    elif isinstance(injury, InjuryClean):
        parts.append(f"the {injury.as_of[:10]} injury report lists no designation for him")
    return "; ".join(parts) + "."


def _story(facts: "PlayerFacts", called: str) -> str | None:
    story = facts.last_season_story
    if story is None:
        return None
    games = "game" if story.games_played == 1 else "games"
    return (
        f"In {story.season} {called} finished {facts.identity.position}{story.points_rank.position_rank}, "
        f"averaging {js_string(story.points_per_game)} points a game over {story.games_played} {games}."
    )


def _law(facts: "PlayerFacts") -> str | None:
    """The law that moves him most, under his full name: a law and its size are shared by
    teammates, and two of them may share a last name."""
    laws = sorted(
        (item for item in facts.evidence if isinstance(item, LawEvidence)), key=lambda law: -abs(law.net_effect_points)
    )
    if not laws:
        return None
    net, headline = laws[0].net_effect_points, in_fantasy_words(laws[0].headline)
    magnitude = js_to_fixed(abs(net), 1)
    name = facts.identity.name
    if net >= 0:
        return f"For {name}, {headline} adds {magnitude} points a game to what we expect."
    return f"For {name}, {headline} costs {magnitude} points a game against what we would otherwise expect."


def _season(facts: "PlayerFacts", called: str) -> str | None:
    if facts.season is None:
        return None
    games = "game" if facts.season.games_played == 1 else "games"
    return (
        f"Through {facts.season.games_played} {games} this season {called} is averaging "
        f"{js_string(facts.season.points_per_game)} points a game."
    )


def render_template_capsule(facts: "PlayerFacts") -> str:
    """The fallback read: his projection and its basis, his ranges, his last season, the law that
    moves him most, his season so far, then where he stands; only what his sheet holds."""
    called = surname(facts.identity.name)
    sentences = [
        _opening(facts),
        _ranges(facts, called),
        _story(facts, called),
        _law(facts),
        _season(facts, called),
        _standing(facts, called),
    ]
    return " ".join(sentence for sentence in sentences if sentence is not None)
