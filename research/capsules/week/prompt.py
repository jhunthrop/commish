"""THE WEEK READ'S INSTRUCTIONS (Lane 307): an analyst's playbook, the hard limits, and the check pass's ask.

The founder, 2026-10-30, after iterating one read live (Josh Downs, week 8): the reads must "feel like humans
actually wrote them who love fantasy football and have novel and unique thoughts", reached by giving the model
"the tools to do so without giving it bland rules". So the system prompt is the iteration harness's
(`reads-iteration/harness/playbook_test.py`): a voice, how a good fantasy analyst thinks, what makes a read
worth reading, and the hard limits, the accuracy rules the validator holds the read to among them. The wording
rules the checklist writer was given (the four rules reads break most, a figure to a sentence, the opener, the
sentence count, the cap on figures, the voices desk) are gone with the checks that enforced them.

One system prompt for every week read, so a correction is held to what the draft was. The request is the
week's facts (`render.render_week_sheet`), the sentences other pages already carry this week, and the ask; a
correction quotes the attempt, how far it is from its length, and every rule broken on any attempt so far, each
with its sentence (`rule_notes`, Lane 52). The read never states the week's published projection (Lane 275).
The answer is one JSON object: the read, and the writer's own call for it in one word (`CALLS`), which the rules
hold to the sheet (a player who may not be started is never "start", the review's H2).

THE CHECK PASS (`CHECK_RULES`, `check_messages`): after every draft the same model checks each number and claim
against the facts and fixes only what fails, before the validator reads it (`write`).
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.bundle import parse_object
from research.capsules.prompt import NEVER_ON_THE_PAGE
from research.capsules.render_words import week_of
from research.capsules.rule_notes import RuleNote
from research.capsules.validate import word_count
from research.capsules.week.render import render_week_sheet
from research.capsules.week.rules import shown_week_words
from research.capsules.week.sheet import PROJECTION_BASIS, WeekSheet
from research.capsules.week.validate import WEEK_BAND

_LOW, _HIGH = WEEK_BAND
# The words a read is asked for (Lane 307), inside the band: on the first 15 production sheets Sonnet asked for 70
# to 110 wrote 110 to 129 words on 13 of its first drafts, so the ask sits under the cap, and an overrun is asked
# back to the target.
ASKED_WORDS: Final = (75, 95)
TARGET_WORDS: Final = 90
_NUMBER_RULE: Final = {
    "published": (
        "- Never state the published projection, its figure, its change or a judgment of it: the card above the "
        'read prints it. Never name the card, a cell or a tile, and never "our projection", "our number", '
        '"our model" or "we project" for this week: the week\'s number is never ours. Never predict how many '
        "points, targets or touches he will get."
    ),
}
# The four calls, defined (the re-review's F4): the page shows the call beside the read.
CALL_MEANINGS: Final = (
    ("start", "start him this week"),
    ("sit", "keep him out of the lineup this week"),
    ("hold", "no change: keep him where he is, or wait on his status before kickoff"),
    ("none", "no lineup call"),
)
_RETURN: Final = (
    'Return ONE JSON object and nothing else: {"read": "<the read>", "call": "<one word>"}. "call" is what '
    "your read tells a manager who has him to do this week, one word: "
    + ", ".join(f'"{call}" means {meaning}' for call, meaning in CALL_MEANINGS)
    + '. A read that waits on his status before saying start calls itself "hold".'
)


def _quoted(words: Sequence[str]) -> str:
    return ", ".join(f'"{word}"' for word in words)


# The one sentence the coordinator added to the harness's playbook (Lane 307 phase 1).
OWN_ROLE: Final = "Describe the matchup in his own role's numbers."
_RULES_TEXT: Final = f"""You write the weekly read on one fantasy football player for a site whose readers love the game. Write like a sharp fantasy analyst talking to a friend who plays: opinionated, specific, plain spoken.

How a good fantasy analyst thinks (use what applies, never walk the list):
- Opportunity beats efficiency. Targets, carries, snaps and red-zone work predict next week better than yards per touch. Touchdowns on thin volume rarely last.
- Role changes are the loudest signal. A teammate hurt, returning or added changes who gets the work. Ask who absorbs it.
- Game script drives volume. Teams expected to trail throw more as the game goes on. Teams expected to lead run late. The expected score says how many scoring chances there are.
- Matchups work at the role level. A defense that stops the run pushes offenses to throw, which helps pass catchers and hurts the lead back. A soft pass defense helps whoever gets the targets.
- Separate noise from signal. One bad game on low team volume is the game plan, not the player. A share falling for three weeks is a trend.
- Floor and ceiling matter. Steady volume makes a safe flex. Boom-or-bust players win some weeks and lose others.
- Talk about him in his own role. A receiver's week is his targets, routes and where he lines up. A back's week is his carries, catches and goal-line work. Open on his work, then bring in the team and the matchup as the reason it changes. {OWN_ROLE}
- The decision sets the read. For a locked-in starter, skip whether to start him and go straight to what sets his ceiling or his risk this week. For a borderline player make the full case.

What makes a read worth reading:
- Find the one thing that decides his week and build the read around it. Connect facts the stat line alone does not connect.
- If the obvious read is wrong, say so and show why.
- Say what would change the call if something specific happens.
- Leave out anything ordinary. Do not tour the facts.
- Open on the fact itself, never on a frame about the read ("the question is", "the week turns on", "he's a lock, so").

Hard limits:
- Every number you state must come from the facts given, exactly as they give it. Never invent a stat, a ranking, a quote, a teammate or an injury, and never a figure you worked out yourself.
- A rank, a place among his peers or how unusual a fact is, only as the facts state it and of the fact that states it. His place on the depth chart only as the facts list it. A game's points only for the week the facts give them.
{_NUMBER_RULE[PROJECTION_BASIS]}
- His place in our order says which order it is: "in our preseason order" or "in our rest-of-season order", as the facts name it.
- A player who may not be started this week (on his bye, Out, Doubtful, on a season-long list) is never recommended to start, in any wording: his call is sit, hold or none. If he cannot play, say he does not play and what that means for a roster that has him. A Questionable player: say what a manager waits on before his kickoff.
- The injury report only as the facts name it, by the day they give ("on Friday's report"). Before this week's game status report is out, name it only as still to come ("once Friday's report is out"), never for what it says. The kickoff forecast only as the facts give it.
- Weeks as "week 7". Never a date or the name of a month. A week still to play is only looked ahead to.
- Fantasy words, never a trading word or a betting word: no line, spread, favorite, favored or underdog. The game's expected points are an expected score.
- Never a data provider or a rival product by name. Name clubs by name, never by their code. Speak for the site as "we" when you need to, never "I", "I'd" or "me". Never mention the facts or a sheet.
- No semicolons. No em dashes or en dashes.
- One paragraph of {ASKED_WORDS[0]} to {ASKED_WORDS[1]} words, never more than {_HIGH}. Count them before you answer.

{NEVER_ON_THE_PAGE}
- This read's own words: {_quoted(shown_week_words())}.

{_RETURN}"""
WEEK_RULES: Final = _RULES_TEXT


def week_rules() -> str:
    """The week read's system prompt."""
    return WEEK_RULES


# THE CHECK PASS (Lane 307, the harness's CHECK): the writer's own model reads its draft against the facts and
# fixes only the words a fact does not support.
CHECK_RULES: Final = (
    "You check a fantasy football read against its facts. For every number and every factual claim in the read, "
    "find the fact line that supports it. A claim fails if no line supports it, if it puts a figure in the wrong "
    'week or window, or if it turns "none recently" into "none all season". If every claim holds, return the read '
    "unchanged. If any fails, fix only those words, keep the voice, keep the call, keep it under "
    f"{_HIGH} words, no semicolons, no dashes. Return only the read."
)


def check_messages(sheet: WeekSheet, read: str) -> list[dict[str, str]]:
    """The check pass's ask on one draft: the facts the draft was written from, and the draft."""
    return [
        {"role": "system", "content": CHECK_RULES},
        {"role": "user", "content": f"FACTS:\n{render_week_sheet(sheet)}\n\nREAD:\n{read}"},
    ]


@dataclass(frozen=True, slots=True)
class WeekAnswer:
    """The writer's answer: the read and its call; None for a part the answer did not carry."""

    read: str | None
    call: str | None


def parse_week_answer(content: str) -> WeekAnswer:
    """The answer's read and call; an answer that is no JSON object is taken whole as a read with no call."""
    found = parse_object(content)
    if found is None:
        return WeekAnswer(content.strip() or None, None)
    read, call = found.get("read"), found.get("call")
    return WeekAnswer(
        read.strip() if isinstance(read, str) and read.strip() else None,
        call.strip().lower() if isinstance(call, str) else None,
    )


def answer_json(read: str, call: str) -> str:
    """An answer as the writer returns it (the tests' stubs and the recorded fixture)."""
    return json.dumps({"read": read, "call": call})


def _avoid_section(avoid: Sequence[str]) -> list[str]:
    if not avoid:
        return []
    listed = "\n".join(f'- "{sentence}"' for sentence in avoid)
    return [
        "These sentences are already on other players' pages this week. Never write them, a near copy, or the "
        f"same sentence with the names and numbers swapped:\n{listed}"
    ]


def week_prompt(sheet: WeekSheet, avoid: Sequence[str]) -> str:
    """The first ask: the week's facts, the sentences other pages carry, the read to write."""
    return "\n\n".join(
        [
            f"Facts for the week:\n{render_week_sheet(sheet)}",
            *_avoid_section(avoid),
            f"Write the week-ahead read for {sheet.name} for {week_of(sheet.week, sheet.season)}. {_RETURN}",
        ]
    )


def length_move(words: int) -> str | None:
    """What a read out of its band is told to do, counted for it (Lane 52's length correction): a writer told
    only the band kept a 137-word read at 137 words through three corrections in the recorded run. Over the
    cap it names the count and asks for the target (Lane 117, B95, fix round 3): one retry, and a second read
    over the cap is the facts block."""
    if words > _HIGH:
        return (
            f"Your read ran {words} words, over the {_HIGH}-word cap. Write it again at {TARGET_WORDS} words: drop "
            "the sentence that carries the least for this week, and shorten the others. A second read over the cap "
            "is not used."
        )
    if words < _LOW:
        return f"It is {words} words, under the {_LOW}-word floor. Add one sentence of fact from the week's facts."
    return None


def week_correction(sheet: WeekSheet, body: str, ledger: Sequence[RuleNote], avoid: Sequence[str]) -> str:
    """A rewrite: the facts, the attempt, how far it is from its length, every rule broken so far with its
    sentence, and the answer's shape, under the same system prompt as the first ask. The retry writer's ask on a
    written draft is this correction."""
    lines = "\n".join(note.line() for note in ledger)
    move = length_move(word_count(body))
    return "\n\n".join(
        [
            f"Facts for the week:\n{render_week_sheet(sheet)}",
            *_avoid_section(avoid),
            f'You wrote this read:\n"""{body}"""',
            *([] if move is None else [move]),
            f"Write it again in your own voice, one paragraph of {ASKED_WORDS[0]} to {ASKED_WORDS[1]} words and never more than "
            f"{_HIGH}, keeping what was right. "
            "Every rule this read has broken so far, on this attempt and the ones before it. What you return breaks "
            f"none of them and brings none of them back:\n{lines}",
            _RETURN,
        ]
    )
