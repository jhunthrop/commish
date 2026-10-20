"""THE WEEK READ'S INSTRUCTIONS: the writer's voice and word lists (`capsules.prompt`), the week's own rules.

One system prompt for every week read, so a correction is held to what the draft was. The request is the
week's facts (`render.render_week_sheet`), the sentences other pages already carry this week, and the ask;
a correction quotes the attempt, how far it is from its length, and every rule broken on any attempt so
far, each with its sentence (`rule_notes`, Lane 52). The prompt states the week, the kickoff (on the
sheet), and that the week's number is a published projection, never ours, while `sheet.PROJECTION_BASIS`
says so. The answer is one JSON object: the read, and the writer's own call for it in one word (`CALLS`),
which the rules hold to the sheet (a player who may not be started is never "start", the review's H2).
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
from research.capsules.week.rules import MAX_FIGURES, MAX_SENTENCES, MIN_SENTENCES, shown_week_words
from research.capsules.week.sheet import PROJECTION_BASIS, WeekSheet
from research.capsules.week.validate import WEEK_BAND

_LOW, _HIGH = WEEK_BAND
# The words to aim at, well under the cap of 80 (Lane 100, B44): the recorded model ran 91 to 104 words
# against a target of 80.
TARGET_WORDS: Final = 60
_NUMBER_RULE: Final = {
    "published": (
        "- The week's number is the published projection: a projection published for the week, never ours. Name "
        'it once, with its figure exactly as the facts print it, in the sentence that names it: "the published '
        'projection has him at 23 points". Never put another figure on it, never say "published" without its '
        'figure, and never "our projection", "our number", "our model" or "we project" for this week. State it and '
        'never grade it: no "light", "heavy", "high", "low", "generous", "conservative", "too" or '
        '"only" beside it, no "looks" or "feels" about it. No round of our weekly number has passed to back a '
        "judgment of it. Say what you see in the matchup or in his rate, in a sentence of its own."
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
    + "; ".join(f'"{call}" means {meaning}' for call, meaning in CALL_MEANINGS)
    + '. A read that waits on his status before saying start calls itself "hold".'
)


def _quoted(words: Sequence[str]) -> str:
    return ", ".join(f'"{word}"' for word in words)


WEEK_RULES: Final = f"""You write the week-ahead read on one player's page for a fantasy football manager setting his lineup for the week in front of him. You sound like a sharp analyst talking to a friend in the same league: direct, specific, opinionated, never a lab report and never a style guide.

THE READ
- {MIN_SENTENCES} to {MAX_SENTENCES} short sentences, about {TARGET_WORDS} words in all and never more than {_HIGH}: count them before you answer. One paragraph, about the week the facts name and nothing else. Pick the two or three facts that decide his week (his game, his status, the published projection, the matchup, the weather, his role) and build on those. Leave the rest unquoted.
- The read sits under his player card, whose cells already print his numbers: the published projection and its change, the opponent's rank, his points a game, each game's points, his rest-of-season points, the expected score and the weather. Say what those cells cannot: why his week looks the way it does (his status, his role, the matchup, the weather) and what a manager who has him does this week. Never retell the cells: quote at most {MAX_FIGURES} figures in all.
- Open on the fact that matters most for him this week. Never open with a set-up phrase, a greeting, a question, or his name followed by a verdict. Name him in the read.
- Every read on this site is written from facts like these, and no sentence may sit on two players' pages, even with the names and numbers swapped: build each sentence your own way for this player, never a sentence shape that would fit another player.
- End on what a manager who has him does this week, in his own terms: start him, sit him, keep him on the bench, find a fill-in for the week.
- A player who may not be started this week (on his bye, Out, Doubtful, on a season-long list) is never recommended to start, in any wording: his call is sit, hold or none. If he cannot play, say he does not play and what that means for a roster that has him: who fills the spot this week, whether he stays on the roster, his next game.
- A Questionable player: say what a manager waits on before his kickoff, in words of your own.

THE NUMBER
{_NUMBER_RULE[PROJECTION_BASIS]}
- His place in our order says which order it is: "in our preseason order" or "in our rest-of-season order", as the facts name it.

NUMBERS, TIME AND WORDS
- Use ONLY the numbers and names in the facts. Never invent a stat, an injury, a teammate or any figure. Quote a number exactly as the facts give it, never a rounding of it and never a figure you worked out. Every figure in the facts is one the page prints as a cell: name it the way the cell does ("242.5 PPR points for the rest of the season", "30.7 PPR points a game this season", "the published projection has him at 18.4 points").
- Every figure carries its unit right after it: "32 points", "19.5 points", "25.9 PPR points a game", "28th of 32 against receivers", "61 degrees", "14 mph", "a 30% chance". Never a bare figure, never "32 to 19.5".
- A rank against his position reads as the facts give it, 1st allowed the fewest, said the way a person would, never a code.
- Name the season once, with the first week you name ("week 6 of 2026"), and every week after it without the year ("week 5", "week 7"). Never the year twice. "This week" is fine. Never a date or the name of a month. A week still to play is only looked ahead to.
- The injury report is the one the facts name, by its day ("on Monday's report"), never "the latest".
- Name clubs by name as the facts give them beside the code ("the Cardinals", "Arizona"), never by their code ("ARI").
- Fantasy football words, never a trading or a betting word. The game's expected points are an expected score and nothing more. Never a provider, a data source or a rival product by name. Never a tip and never "remember to".
- Speak for the board as "we" when you need to, never "I", "me" or "my". The facts are yours alone: never mention a sheet.
- Write like you talk. Contractions are welcome. Never an em-dash, never a semicolon.

{NEVER_ON_THE_PAGE}
- This read's own words: {_quoted(shown_week_words())}.

{_RETURN}"""


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
    only the band kept a 137-word read at 137 words through three corrections in the recorded run."""
    if words > _HIGH:
        return (
            f"It is {words} words, {words - _HIGH} over the {_HIGH}-word cap. Cut about {words - TARGET_WORDS} words: "
            "drop the sentence that carries the least for this week, and shorten the others."
        )
    if words < _LOW:
        return f"It is {words} words, under the {_LOW}-word floor. Add one sentence of fact from the week's facts."
    return None


def week_correction(sheet: WeekSheet, body: str, ledger: Sequence[RuleNote], avoid: Sequence[str]) -> str:
    """A rewrite: the facts, the attempt, how far it is from its length, every rule broken so far with its
    sentence, the answer's shape."""
    lines = "\n".join(note.line() for note in ledger)
    move = length_move(word_count(body))
    return "\n\n".join(
        [
            f"Facts for the week:\n{render_week_sheet(sheet)}",
            *_avoid_section(avoid),
            f'You wrote this read:\n"""{body}"""',
            *([] if move is None else [move]),
            f"Write it again, {MIN_SENTENCES} to {MAX_SENTENCES} short sentences, about {TARGET_WORDS} words and "
            f"never more than {_HIGH}, keeping what was right. Every rule this read has broken so far, on this "
            "attempt and the ones before it. What you return breaks none of them and brings none of them back:"
            f"\n{lines}",
            _RETURN,
        ]
    )
