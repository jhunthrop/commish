"""LANE 281, THE V1 ARM: the week read as Lane 266 shipped it, for the harness to measure voices v2 against.

Lane 266's matchup, story and table-talk briefs, its voice header and opening rule, and no first-sentence cap
or "other club" rule (Lane 281, B270). `use_v1` sets them for the whole process, so one run is one arm;
production never imports this module.
"""

from dataclasses import replace
from typing import Final

from research.capsules.week import prompt, rules, voices, write

V1_BRIEFS: Final = {
    "matchup": (
        "Open on the opponent: the club by name and what it allows his position, with its rank. Sentences of "
        '14 to 18 words, each one clause joined by "and" or "but". Lean on the game around him: the opponent, '
        "the expected score, the weather, home or away. His own numbers come second, as the reason the "
        "matchup matters for him."
    ),
    "story": (
        "Open on where his season stands, carried by a figure from it or by his status. Vary the rhythm: one "
        "longer sentence of up to 20 words, then shorter ones. Lean on the week's story: how his season has "
        "gone and what this game asks of him, told forward, never a recap of every game."
    ),
    "table_talk": (
        "Open on the call or his status in the everyday words a league-mate uses across the table. "
        "Contractions, plain verbs, sentences of 10 to 15 words. Lean on what a manager who has him worries "
        "about this week and answer it straight."
    ),
}
V1_HEADER: Final = (
    "This read's voice. It changes how the read sounds, never a rule: every rule you were given still holds, "
    "and the facts, the call and the figures are the same in any voice."
)
V1_OPENING_RULE: Final = (
    "- Open on the fact that matters most for him this week: the first sentence carries the call, a figure or "
    'his status. Never open with a scene-setting clause (no "runs into the kind of matchup" before a colon), a '
    "greeting, a question, or his name followed by a verdict. Name him in the read."
)


def v1_voices() -> tuple[voices.Voice, ...]:
    """The desk with Lane 266's briefs for the three voices Lane 281 rewrote, in the same order."""
    return tuple(replace(v, brief=V1_BRIEFS.get(v.key, v.brief)) for v in voices.VOICES)


def v1_rules() -> str:
    """The system prompt with Lane 266's opening rule and no "other club" words."""
    text = prompt.WEEK_RULES
    if prompt.OPENING_RULE not in text or prompt.OTHER_CLUB_RULE not in text:
        raise RuntimeError("the system prompt no longer carries the rules the v1 arm swaps out")
    return text.replace(prompt.OPENING_RULE, V1_OPENING_RULE).replace(prompt.OTHER_CLUB_RULE, "")


def _no_violations(*_: object) -> list[str]:
    return []


def use_v1() -> None:
    """Set the v1 arm for this process: Lane 266's briefs, header and opening rule, and no Lane 281 rule."""
    rules_text = v1_rules()
    for module, name, value in (
        (voices, "VOICES", v1_voices()),
        (voices, "_HEADER", V1_HEADER),
        (prompt, "WEEK_RULES", rules_text),
        (write, "WEEK_RULES", rules_text),
        (rules, "_first_sentence_violation", _no_violations),
        (rules, "_other_club_violations", _no_violations),
    ):
        setattr(module, name, value)
