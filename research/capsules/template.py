"""THE TEMPLATE CAPSULE: the permanent floor when the writer does not produce a read that validates.

Ported from `research-ts/src/capsules/template.ts`, with two changes so the floor passes the gate
the nightly holds every page to: the range sentence no longer says "most seasons land" (a refrain the
voice rules now refuse), and a projection under ten points prints to the tenth, the precision the
page's pull figure reads it at. Every number is the sheet's.
"""

from typing import TYPE_CHECKING, Final

from research.capsules.facts.model import InjuryClean, InjuryDesignated, LawEvidence
from research.capsules.render_words import whole
from research.model.jsmath import js_to_fixed
from research.pipeline.jscompat import js_string

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

TEMPLATE_CAPSULE_NOTE: Final = "A summary from the numbers."
_WHOLE_NUMBER_FLOOR: Final = 10


def _law_sentence(headline: str, net: float) -> str:
    magnitude = js_to_fixed(abs(net), 1)
    if net >= 0:
        return f"{headline} adds {magnitude} points a game to what we expect from him."
    return f"{headline} costs him {magnitude} points a game against what we would otherwise expect."


def _projection(points: float) -> str:
    return whole(points) if abs(points) >= _WHOLE_NUMBER_FLOOR else js_to_fixed(points, 1)


def render_template_capsule(facts: "PlayerFacts") -> str:
    """`renderTemplateCapsule`."""
    identity, p, story = facts.identity, facts.projection, facts.last_season_story
    sentences = [
        f"{identity.name} ({identity.position}, {identity.team}) projects for {_projection(p.projected_points)} points this season.",
        f"His middle range runs {whole(p.typical_low)} to {whole(p.typical_high)}. The full range runs {whole(p.floor_points)} "
        f"to {whole(p.ceiling_points)}, where the low end is what an injury year looks like and the high end is the smash case.",
    ]
    if story is not None:
        sentences.append(
            f"Last season he finished {identity.position}{story.points_rank.position_rank} at the position, averaging "
            f"{js_string(story.points_per_game)} points a game."
        )
    if facts.market.adp is None:
        sentences.append("He has no ADP.")
    laws = sorted(
        (item for item in facts.evidence if isinstance(item, LawEvidence)), key=lambda law: -abs(law.net_effect_points)
    )
    if laws:
        sentences.append(_law_sentence(laws[0].headline, laws[0].net_effect_points))
    if facts.season is not None:
        games = "game" if facts.season.games_played == 1 else "games"
        sentences.append(
            f"Through {facts.season.games_played} {games} this season he is averaging {js_string(facts.season.points_per_game)} points a game."
        )
    if facts.bye_week is not None:
        sentences.append(f"His bye is week {facts.bye_week}.")
    injury = facts.injury
    if isinstance(injury, InjuryDesignated):
        sentences.append(f"The injury report lists him as {injury.designation} as of {injury.as_of[:10]}.")
    elif isinstance(injury, InjuryClean):
        sentences.append(f"The injury report showed no designation for him as of {injury.as_of[:10]}.")
    else:
        sentences.append("We have not checked an injury feed for him yet.")
    return " ".join(sentences)
