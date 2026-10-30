"""THE JUDGE (the Lane 72 re-review's F1): a second, separate call that reads a finished read for a player
who may not be started this week (on his bye, Out, Doubtful, on a season-long list) and answers one
question, yes or no. A yes refuses the read, beside the writer's own call and the phrase list
(`start_advice`): a list cannot be complete, a reader's reading can.

The judge sees the read and the player's name and week only, never the writer's rules or the facts, so it
reads the text as a reader would. An answer that is neither yes nor no is read as yes: the guard fails
closed. Its call counts toward the read's four and its cost toward the pass's budget (`write`).
"""

from collections.abc import Mapping
from typing import Final

from research.capsules.config import CAPSULE_MODEL
from research.capsules.render_words import week_of
from research.capsules.week.sheet import WeekSheet

QUESTION: Final = "Would a reader take this text as telling them to start this player this week? Answer yes or no."
_SYSTEM: Final = (
    "You read one short fantasy football text about one player and answer one question about it with one word: "
    "yes or no. Read it as a fantasy manager would, plainly. Judge what the words tell the reader to do, not "
    "whether the advice is sound or possible: read each sentence on its own, and if any one sentence, read alone, "
    "would tell a reader to start him, play him, keep him in a lineup or not bench him this week, in any wording "
    '(a double negative such as "no reason not to start him", or "never bench him", or "don\'t sit him", '
    "included), the answer is yes, even when another sentence says he cannot play. Advice for a later week, "
    "named as that week, is not advice for this week. Only when no sentence does so is the answer no."
)
# A one-word answer, and room for the reasoning the model spends first even with thinking off (caps of 8
# and 64 came back empty, cut inside the reasoning, on the probes of 2026-10-17).
JUDGE_MAX_TOKENS: Final = 512
JUDGE_MIN_WORDS: Final = 1
# The judge's model, a setting (`JUDGE_MODEL_VARIABLE` overrides it). Measured 2026-10-17 on the re-review's
# thirteen start phrasings and three honest bye reads: the writer's model said yes to 11 of 13 with the
# sentence framing below and no to all three honest reads; Haiku (Lane 24's candidate at the same list price)
# said yes to 11 of 13 and yes to one honest read, a false refusal. The writer's model judges.
JUDGE_MODEL: Final = CAPSULE_MODEL
JUDGE_MODEL_VARIABLE: Final = "WEEK_JUDGE_MODEL"


def judge_model(environ: Mapping[str, str]) -> str:
    return environ.get(JUDGE_MODEL_VARIABLE, "").strip() or JUDGE_MODEL


VIOLATION: Final = "A reader would take this read as telling them to start him this week"


def judge_messages(sheet: WeekSheet, text: str) -> list[dict[str, str]]:
    week = week_of(sheet.week, sheet.season)
    user = f'Player: {sheet.name}. This week: {week}.\n\nText:\n"""{text}"""\n\n{QUESTION}'
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}]


def says_start(answer: str) -> bool:
    """The judge's answer as a verdict: True for yes, and for anything that is not plainly no."""
    words = answer.strip().lower().split()
    first = words[0].strip(".!,\"'") if words else ""
    return first != "no"


def judge_violation(sheet: WeekSheet) -> str:
    why = "is on his bye" if sheet.bye else "may not be started on his status"
    return (
        f"{VIOLATION}, and he {why} in week {sheet.week} of {sheet.season}. Rewrite it so no reader could take "
        "it as start advice: say what his week means for a roster that has him, and argue the call the ask gives."
    )
