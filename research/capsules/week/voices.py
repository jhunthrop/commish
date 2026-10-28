"""THE WEEK READ'S WRITER VOICES (Lane 266): a small desk of voices, each player's read in one of them.

The founder (2026-10-28): every week read came from one prompt in one voice, so the site read like one
writer. Each voice is a short brief (how the read opens, its sentence length and rhythm, what it leans on)
that rides in the first ask after the facts (`prompt.week_prompt`). A correction quotes the draft, already
in his voice, and carries no brief, so the heaviest prompt the budgets price is unchanged. The pages read
like a desk of writers while every read carries the same facts, the same call from our order and the same
rules: the system prompt (`prompt.WEEK_RULES`), the validator and the judge are untouched. No voice is a
person or a byline, and the page shows none.

A player's voice is stable for the season: a hash of the season and his player id over the voice count
(`voice_for`), so his page keeps one voice across rewrites and weeks, and the board's shares come out
about even. `VOICES_ON` is the one line that turns the voices off.
"""

import hashlib
from dataclasses import dataclass
from typing import Final

from research.capsules.week.sheet import WeekSheet

# The switch (Lane 266's ship bar): False and every ask goes out exactly as it did before the voices.
VOICES_ON: Final = True


@dataclass(frozen=True, slots=True)
class Voice:
    """One writer voice: its internal key (never shown) and its brief, the lines the ask carries."""

    key: str
    brief: str


# Each brief stays inside the read's rules: the first sentence carries the call, a figure or his status;
# one figure to a sentence; no greeting, no question, no scene set first. They differ in which of those
# leads and how, in rhythm, and in what the middle of the read leans on. Lane 281 (B270, voices v2): the
# matchup, story and table-talk briefs each carry the opening rule's point in their own first sentence (the
# call framed by the opponent, his status as the season's turn, the call said across a table), as the v1
# briefs left the rule's status-first opener in charge and those three voices sounded like no voice.
VOICES: Final = (
    Voice(
        "verdict",
        "Open on the move itself, the verb first (start him, sit him, keep him on the bench, find a fill-in), "
        "with the reason in the same sentence. Short, clipped sentences of 8 to 12 words. Lean on the "
        "manager's decision: what he does this week, what he waits on, who fills the spot. Close on the move "
        "again in fewer words than you opened with.",
    ),
    Voice(
        "matchup",
        "Open on the call framed by the opponent: the first sentence names the club he faces and what that "
        "game means for the move this week, never his status first. When he does not play this week, it names "
        "the game he misses or the club he returns against. Sentences of 14 to 18 words, each one clause joined "
        'by "and" or "but". Lean on the game around him: what the opponent allows his position, the expected '
        "score, the weather, home or away. His own numbers come second, as the reason the matchup matters for "
        "him.",
    ),
    Voice(
        "role",
        "Open on his status or his place on his club's depth chart, as the facts give them. Plain, even "
        "sentences of about 15 words. Lean on his role: the work he gets, the spot he holds and what his "
        "status means for it this week. Name only the teammates and the slots the facts name.",
    ),
    Voice(
        "numbers",
        "Open on one of his own figures with its unit: his points a game, or his last game's points. Compact, "
        "exact sentences, each figure followed by what it means for this week. Lean on the numbers, picking "
        "the two that tell his week best and leaving the rest to his card.",
    ),
    Voice(
        "story",
        "Open on his status as the turn his season takes this week: the first sentence sets where his season "
        "has been against what this week brings, carried by his status or a figure from his season (back from "
        "missed weeks, still on the list, healthy and rolling). Never a plain report of a clean status. Then "
        "shorter sentences, told forward: how his season has gone and what this game asks of him, never a recap "
        "of every game.",
    ),
    Voice(
        "table_talk",
        "Open on the call as a league-mate says it across the table: the move in everyday words, said to the "
        'manager as "you", with the one reason that decides it in the same sentence. Contractions, plain verbs, '
        "sentences of 10 to 15 words. Lean on what a manager who has him worries about this week and answer it "
        "straight, the way a friend in the league would.",
    ),
)

_HEADER: Final = (
    "This read's voice. It sets how the first sentence carries its point and how the read sounds, never a "
    "rule: every rule you were given still holds, and the facts, the call and the figures are the same in any "
    "voice."
)


def voice_for(season: int, player_id: str) -> Voice:
    """The player's voice for `season`: a hash of the season and his id over the voice count, so it is the
    same on every rewrite and every week of the season."""
    digest = hashlib.sha256(f"{season}:{player_id}".encode()).digest()
    return VOICES[int.from_bytes(digest[:8], "big") % len(VOICES)]


def voice_section(sheet: WeekSheet, on: bool | None = None) -> list[str]:
    """The ask's voice part for `sheet`'s player: his voice's brief, or nothing when the voices are off
    (`on`, read from `VOICES_ON` at the call when not given)."""
    if not (VOICES_ON if on is None else on):
        return []
    return [f"{_HEADER}\n{voice_for(sheet.season, sheet.player_id).brief}"]
