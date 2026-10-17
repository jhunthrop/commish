"""THE WEEK READ'S INSTRUCTIONS: the writer's voice and word lists (`capsules.prompt`), the week's own rules.

One system prompt for every week read, so a correction is held to what the draft was. The request is the
week's facts (`sheet.render_week_sheet`), the sentences other pages already carry this week, and the ask;
a correction quotes the attempt and every rule broken on any attempt so far, each with its sentence
(`rule_notes`, Lane 52). The prompt states the week, the kickoff (on the sheet), and that the week's number
is a published projection, never ours, while `sheet.PROJECTION_BASIS` says so.
"""

from collections.abc import Sequence
from typing import Final

from research.capsules.prompt import NEVER_ON_THE_PAGE
from research.capsules.render_words import week_of
from research.capsules.rule_notes import RuleNote
from research.capsules.validate import word_count
from research.capsules.week.rules import MAX_SENTENCES, MIN_SENTENCES, shown_week_words
from research.capsules.week.sheet import PROJECTION_BASIS, WeekSheet, render_week_sheet
from research.capsules.week.validate import WEEK_BAND

_LOW, _HIGH = WEEK_BAND
# The words to aim at: the probe's first drafts ran 136 to 151 words when told only the band.
_TARGET: Final = 80
_NUMBER_RULE: Final = {
    "published": (
        "- The week's number is the published projection: a projection published for the week, never ours. Every "
        "sentence that quotes its figure says it is the published projection, and you name it at least once when "
        'the facts carry one. Never "our projection", "our number", "our model" or "we project" for this week. '
        "The only thing of ours is our board: his place in our order, as the facts give it."
    ),
}


def _quoted(words: Sequence[str]) -> str:
    return ", ".join(f'"{word}"' for word in words)


WEEK_RULES: Final = f"""You write the week-ahead read on one player's page for a fantasy football manager setting his lineup for the week in front of him. You sound like a sharp analyst talking to a friend in the same league: direct, specific, opinionated, never a lab report and never a style guide.

THE READ
- {MIN_SENTENCES} to {MAX_SENTENCES} short sentences, about {_TARGET} words in all and never more than {_HIGH}: count them before you answer. One paragraph, about the week the facts name and nothing else. Pick the two or three facts that decide his week (his game, his status, the published projection and what moved it, the matchup, the weather, his role) and build on those. Leave the rest unquoted.
- Open on the fact that matters most for him this week. Never open with a set-up phrase, a greeting, a question, or his name followed by a verdict.
- Every read on this site is written from facts like these, and no sentence may sit on two players' pages: put his name, his club, his opponent or his own numbers in each sentence, and never a sentence that would fit another player.
- End on what a manager who has him does this week, in his own terms: start him, sit him, keep him on the bench, find a fill-in for the week.
- A player who cannot play this week (on his bye, out, on a season-long list) is never recommended for this week. Say he does not play, and what that means for a roster that has him: who fills the spot this week, whether he stays on the roster, his next game.
- A Questionable or Doubtful player: say what a manager waits on before his kickoff, in words of your own.

THE NUMBER
{_NUMBER_RULE[PROJECTION_BASIS]}

NUMBERS, TIME AND WORDS
- Use ONLY the numbers and names in the facts. Never invent a stat, an injury, a teammate or any figure. Quote a number as the facts give it, or as a plain rounding of it, never a figure you worked out.
- Each number goes with its basis and its unit as the facts give them: points (PPR), points a game, a rank and among how many, degrees, mph, a percent chance.
- A rank against his position reads as the facts give it, 1st allowed the fewest, said the way a person would: "26th of 32 against receivers", never a code.
- Name every week with its season: "week 6 of 2026", never a bare "week 6". "This week" is fine. Never a date or the name of a month. A week still to play is only looked ahead to.
- Fantasy football words, never a trading or a betting word. The game's expected points are an expected score and nothing more. Never a provider, a data source or a rival product by name. Never a tip and never "remember to".
- Speak for the board as "we" when you need to, never "I", "me" or "my". The facts are yours alone: never mention a sheet.
- Write like you talk. Contractions are welcome. Never an em-dash, never a semicolon.

{NEVER_ON_THE_PAGE}
- This read's own words: {_quoted(shown_week_words())}."""


def _avoid_section(avoid: Sequence[str]) -> list[str]:
    if not avoid:
        return []
    listed = "\n".join(f'- "{sentence}"' for sentence in avoid)
    return [
        f"These sentences are already on other players' pages this week. Never write them or a near copy:\n{listed}"
    ]


def week_prompt(sheet: WeekSheet, avoid: Sequence[str]) -> str:
    """The first ask: the week's facts, the sentences other pages carry, the read to write."""
    return "\n\n".join(
        [
            f"Facts for the week:\n{render_week_sheet(sheet)}",
            *_avoid_section(avoid),
            f"Write the week-ahead read for {sheet.name} for {week_of(sheet.week, sheet.season)}. Return only the "
            "read: plain text, one paragraph, no heading, no quotes.",
        ]
    )


def length_move(words: int) -> str | None:
    """What a read out of its band is told to do, counted for it (Lane 52's length correction): a writer told
    only the band kept a 137-word read at 137 words through three corrections in the recorded run."""
    if words > _HIGH:
        return (
            f"It is {words} words, {words - _HIGH} over the {_HIGH}-word cap. Cut about {words - _TARGET} words: drop "
            "the sentence that carries the least for this week, and shorten the others."
        )
    if words < _LOW:
        return f"It is {words} words, under the {_LOW}-word floor. Add one sentence of fact from the week's facts."
    return None


def week_correction(sheet: WeekSheet, body: str, ledger: Sequence[RuleNote], avoid: Sequence[str]) -> str:
    """A rewrite: the facts, the attempt, how far it is from its length, every rule broken so far with its
    sentence, a plain-text return."""
    lines = "\n".join(note.line() for note in ledger)
    move = length_move(word_count(body))
    return "\n\n".join(
        [
            f"Facts for the week:\n{render_week_sheet(sheet)}",
            *_avoid_section(avoid),
            f'You wrote this read:\n"""{body}"""',
            *([] if move is None else [move]),
            f"Write it again, {MIN_SENTENCES} to {MAX_SENTENCES} short sentences, about {_TARGET} words and never "
            f"more than {_HIGH}, keeping what was right. Every rule this read has broken so far, on this attempt and "
            f"the ones before it. What you return breaks none of them and brings none of them back:\n{lines}",
            "Return only the corrected read: plain text, no quotes, no heading.",
        ]
    )
