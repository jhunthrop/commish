"""THE WEEK READ'S WRITER VOICES (Lane 266): a small desk of voices, each player's read in one of them.

RETIRED FROM THE ASKS BY LANE 307: the analyst playbook in the system prompt is the voice, and no ask carries a
brief or a reminder (`prompt`). The desk stays for the writer bake-off's arms (`explore.writer_bakeoff`), which
read it to tag and compare reads; `VOICES_ON` is off.

The founder (2026-10-28): every week read came from one prompt in one voice, so the site read like one
writer. Each voice is a short brief (how the read opens, its sentence length and rhythm, what it leans on)
that rides in the first ask after the facts (`prompt.week_prompt`). A correction (and the retry writer's ask,
which is one) carries his voice's reminder instead (`voice_reminder`, Lane 282): its name and two lines of the
brief, how it opens and what it leans on, since about nine written reads in ten are corrections (Lane 281) and a
correction with no brief let every voice go quiet. The reminder is short enough that the heaviest correction stays
inside the prompt bound the budgets price (`nightly.week_reads.WORST_PROMPT_TOKENS`). The pages read
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

from research.capsules.week.angles import angles_on
from research.capsules.week.bites import rank_bites
from research.capsules.week.sheet import WeekSheet

# The switch (Lane 266's ship bar): off since Lane 307, which took the voices out of the asks.
VOICES_ON: Final = False


@dataclass(frozen=True, slots=True)
class Voice:
    """One writer voice: its internal key (never shown), its brief, the lines the first ask carries, and its
    reminder, two lines of the brief (how it opens, what it leans on) that a correction carries."""

    key: str
    brief: str
    reminder: str
    # With the angles on (Lane 300, fix round 1) an angle-led read sets the lead: a voice whose brief leans on a
    # fact the sheet may no longer carry has its angles' brief and reminder, used on a sheet with angles.
    angles_brief: str | None = None
    angles_reminder: str | None = None

    @property
    def name(self) -> str:
        """The voice's name as the reminder says it ("table talk")."""
        return self.key.replace("_", " ")


# The matchup voice's angles brief, when no matchup fact bites: the opponent's rank leaves the sheet outside the
# four clubs either end (`bites.RANK_EDGE`), so it leans on his strongest angle, set against this game.
_MATCHUP_ON_ANGLES: Final = (
    "Open on the fact that decides his week, with its figure, set against this game: the opponent by name, home or away, the "
    'expected score when it bites. Sentences of 14 to 18 words, each one clause joined by "and" or "but". '
    "Lean on what that fact means against this opponent this week.",
    "Open on the fact that decides his week, with its figure, set against this game and this opponent.\n"
    "Lean on what that fact means against this opponent this week.",
)
# The role voice's brief with his usage in full (fix round 2): his role is his share of the work, never a tour of
# the depth chart; his place on it leads only when the sheet says it bites (pair h: the depth chart in 36% of
# reads, mostly the role voice's openers).
_ROLE_ON_ANGLES: Final = (
    "Open on his status or on his work: the share of his club's snaps, targets or carries that says most about his "
    "week. Plain, even sentences of about 15 words. Lean on his role as his usage facts state it; his place on the "
    "depth chart only when the sheet says it bites.",
    "Open on his status or on his work, the share that says most about his week.\n"
    "Lean on his role as his usage states it; the depth chart only when it bites.",
)
# The verdict voice's angles brief (fix round 1): its clipped sentences ran reads with two angles to six and seven
# sentences, so the brief holds them to four and gives the angle the reason's place.
_VERDICT_ON_ANGLES: Final = (
    "Open on the move itself, the verb first, with the fact that decides his week as the reason in the same sentence. Four "
    "sentences in all, 10 to 15 words each: the move and its fact, the next fact that matters, what he waits on if anything, "
    "the move again in fewer words.",
    "Open on the move itself, the verb first, with the fact that decides his week as its reason.\n"
    "Four sentences in all: the move, the facts that decide it, the move again.",
)


# Each brief stays inside the read's rules: the first sentence carries the call, a figure or his status;
# one figure to a sentence; no greeting, no question, no scene set first. They differ in which of those
# leads, in rhythm, and in what the middle of the read leans on.
VOICES: Final = (
    Voice(
        "verdict",
        "Open on the move itself, the verb first (start him, sit him, keep him on the bench, find a fill-in), "
        "with the reason in the same sentence. Short, clipped sentences of 8 to 12 words. Lean on the "
        "manager's decision: what he does this week, what he waits on, who fills the spot. Close on the move "
        "again in fewer words than you opened with.",
        "Open on the move itself, the verb first, with its reason in the same sentence.\n"
        "Lean on the manager's decision this week, in short, clipped sentences.",
        *_VERDICT_ON_ANGLES,
    ),
    Voice(
        "matchup",
        "Open on the opponent: the club by name and what it allows his position, with its rank. Sentences of "
        '14 to 18 words, each one clause joined by "and" or "but". Lean on the game around him: the opponent, '
        "the expected score, the weather, home or away. His own numbers come second, as the reason the "
        "matchup matters for him.",
        "Open on the opponent by name and what it allows his position.\n"
        "Lean on the game around him, his own numbers as the reason the matchup matters.",
        *_MATCHUP_ON_ANGLES,
    ),
    Voice(
        "role",
        "Open on his status or his place on his club's depth chart, as the facts give them. Plain, even "
        "sentences of about 15 words. Lean on his role: the work he gets, the spot he holds and what his "
        "status means for it this week. Name only the teammates and the slots the facts name.",
        "Open on his status or his place on his club's depth chart.\n"
        "Lean on his role: the work he gets and what his status means for it this week.",
        *_ROLE_ON_ANGLES,
    ),
    Voice(
        "numbers",
        "Open on one of his own figures with its unit: his points a game, or his last game's points. Compact, "
        "exact sentences, each figure followed by what it means for this week. Lean on the numbers, picking "
        "the two that tell his week best and leaving the rest to his card.",
        "Open on one of his own figures with its unit.\n"
        "Lean on the two numbers that tell his week best, each with what it means for this week.",
    ),
    Voice(
        "story",
        "Open on where his season stands, carried by a figure from it or by his status. Vary the rhythm: one "
        "longer sentence of up to 20 words, then shorter ones. Lean on the week's story: how his season has "
        "gone and what this game asks of him, told forward, never a recap of every game.",
        "Open on where his season stands, carried by a figure from it or by his status.\n"
        "Lean on how his season has gone and what this game asks of him, told forward.",
    ),
    Voice(
        "table_talk",
        "Open on the call or his status in the everyday words a league-mate uses across the table. "
        "Contractions, plain verbs, sentences of 10 to 15 words. Lean on what a manager who has him worries "
        "about this week and answer it straight.",
        "Open on the call or his status in a league-mate's everyday words, contractions welcome.\n"
        "Lean on what a manager who has him worries about this week, answered straight.",
    ),
)

_HEADER: Final = (
    "This read's voice. It changes how the read sounds, never a rule: every rule you were given still holds, "
    "and the facts, the call and the figures are the same in any voice."
)


def voice_for(season: int, player_id: str) -> Voice:
    """The player's voice for `season`: a hash of the season and his id over the voice count, so it is the
    same on every rewrite and every week of the season."""
    digest = hashlib.sha256(f"{season}:{player_id}".encode()).digest()
    return VOICES[int.from_bytes(digest[:8], "big") % len(VOICES)]


def _brief(voice: Voice, sheet: WeekSheet) -> tuple[str, str]:
    """The voice's brief and reminder for `sheet`: its angles' pair on a sheet with angles (the matchup voice's
    only when no matchup fact bites), else its own."""
    held = voice.angles_brief is not None and voice.angles_reminder is not None
    matchup_bites = voice.key == "matchup" and rank_bites(sheet.allowed)
    if angles_on() and sheet.angles and held and not matchup_bites:
        return voice.angles_brief or voice.brief, voice.angles_reminder or voice.reminder
    return voice.brief, voice.reminder


def voice_section(sheet: WeekSheet, on: bool | None = None) -> list[str]:
    """The ask's voice part for `sheet`'s player: his voice's brief, or nothing when the voices are off
    (`on`, read from `VOICES_ON` at the call when not given)."""
    if not (VOICES_ON if on is None else on):
        return []
    return [f"{_HEADER}\n{_brief(voice_for(sheet.season, sheet.player_id), sheet)[0]}"]


def voice_reminder(sheet: WeekSheet, on: bool | None = None) -> list[str]:
    """A correction's voice part for `sheet`'s player (Lane 282): his voice's name and reminder, or nothing
    when the voices are off (`on`, read from `VOICES_ON` at the call when not given)."""
    if not (VOICES_ON if on is None else on):
        return []
    voice = voice_for(sheet.season, sheet.player_id)
    return [f"Keep the read in its voice, {voice.name}, inside every rule above.\n{_brief(voice, sheet)[1]}"]
