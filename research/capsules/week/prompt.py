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
from research.capsules.rule_notes import RuleNote, note_of
from research.capsules.sentences import split_sentences
from research.capsules.validate import word_count
from research.capsules.week.render import render_week_sheet
from research.capsules.week.rules import MAX_FIGURES, MAX_SENTENCES, MIN_SENTENCES, shown_week_words
from research.capsules.week.sheet import PROJECTION_BASIS, WeekSheet
from research.capsules.week.validate import SHARED_SENTENCE, WEEK_BAND, sentence_shape

_LOW, _HIGH = WEEK_BAND
# The words to aim at, well under the cap (80 at Lane 100, B44; 95 since Lane 117 fix round 3): the recorded model ran 91 to 104 words
# against a target of 80, and the first nightly with the cap at 80 and a target of 60 ran 114 of 354 reads
# to 81 to 91 words (Lane 117, B95). The prompt asks for a range inside the band, and its middle.
TARGET_WORDS: Final = 60
ASKED_WORDS: Final = (45, 70)
# The shape that lands near the target: a writer told a sentence's length keeps to it better than one told a
# total (the Lane 117 replay).
SENTENCE_WORDS: Final = 15
_NUMBER_RULE: Final = {
    "published": (
        "- The week's number is the published projection: a projection published for the week, never ours. Name "
        "it once, with its figure exactly as the facts print it, as a cell placed inside a sentence about this "
        "player's week (his matchup, his role, his status), never a sentence that only states it. Never put another "
        'figure on it, never say "published" without its figure, and never "our projection", "our number", "our model" or "we project" for this week. State it and '
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


# Lane 264 (B267): the sentences other pages carry, in the form the shape check compares (`sentence_shape`),
# so the writer sees what "the same sentence with the names and numbers swapped" means.
AVOID_LEAD: Final = (
    "Sentence shapes already on other players' pages this week, as the check compares them: lower case, "
    "punctuation dropped, x for every capitalised word (a name, a club, a sentence's first word), # for every "
    "number. A sentence of yours with one of these shapes is refused, so build yours another way:"
)


def _quoted(words: Sequence[str]) -> str:
    return ", ".join(f'"{word}"' for word in words)


WEEK_RULES: Final = f"""You write the week-ahead read on one player's page for a fantasy football manager setting his lineup for the week in front of him. You sound like a sharp analyst talking to a friend in the same league: direct, specific, opinionated, never a lab report and never a style guide.

THE RULES READS BREAK MOST (each stated here once)
- One figure to a sentence. The published projection, the opponent's rank and his points a game each get a sentence of their own.
- The published projection is a cell you place inside a sentence about this player's week (his matchup, his role, his status), named the published projection with its figure. Never a sentence that only states it.
- The season once, with the first week you name, whichever week that is (his game, the status report's week, "through week 7", weeks he missed): write that first one "week 8 of 2026", every later week without the year. Right: "Questionable on the injury list as of Tuesday 6:00 pm Central, before week 8 of 2026's game status report on Friday", then "week 7". Wrong: "before week 8's game status report" ahead of the year, a read with weeks and no year at all, or "week 8 of 2026" then "week 7 of 2026" (the year twice).
- The first sentence carries the call ("Start him", "Sit Cam Ward"), a figure with its unit, or his status in the facts' words ("no designation", "Questionable", "Out", "on his bye"). Right: "Jaylen Warren has no designation for his home game against Cleveland." Wrong: "Ty Johnson is buried third among Bills backs." (no call, figure or status). Never open on a scene or a clause before a colon. Name him in the read.
- Every number is a figure the facts print, word for word, and a count in words is a number: never "three straight games" unless the facts print that count.
- The injury report exactly as the facts' injury report line names it ("on the injury list as of Tuesday 6:00 pm Central"), never "the latest" or a report by a day the facts do not name that way ("Friday's report", "Tuesday's list").
- No sentence may sit on two players' pages, even with the names and numbers swapped: the check masks every name and number, so "Keep him on your bench and find a fill-in for the week." is one sentence on every page that writes it. Build each sentence, the status and the closing call above all, on what only he has.

THE READ
- {MIN_SENTENCES} to {MAX_SENTENCES} short sentences, {ASKED_WORDS[0]} to {ASKED_WORDS[1]} words in all, about {TARGET_WORDS}, and never more than {_HIGH}: four sentences of about {SENTENCE_WORDS} words each is the shape. Count the words before you answer. One paragraph, about the week the facts name and nothing else. Pick the two or three facts that decide his week (his game, his status, the published projection, the matchup, the weather, his role) and build on those. Leave the rest unquoted.
- The read sits under his player card, whose cells already print his numbers: the published projection and its change, the opponent's rank, his points a game, each game's points, his rest-of-season points, the expected score and the weather. Say what those cells cannot: why his week looks the way it does (his status, his role, the matchup, the weather) and what a manager who has him does this week. Never retell the cells: quote at most {MAX_FIGURES} figures in all.
- End on what a manager who has him does this week, in his own terms: start him, sit him, keep him on the bench, find a fill-in for the week.
- A player who may not be started this week (on his bye, Out, Doubtful, on a season-long list) is never recommended to start, in any wording: his call is sit, hold or none. If he cannot play, say he does not play and what that means for a roster that has him: who fills the spot this week, whether he stays on the roster, his next game.
- A Questionable player: say what a manager waits on before his kickoff, in words of your own.

THE NUMBER
{_NUMBER_RULE[PROJECTION_BASIS]}
- His place in our order says which order it is: "in our preseason order" or "in our rest-of-season order", as the facts name it.

NUMBERS, TIME AND WORDS
- Use ONLY the numbers and names in the facts. Never invent a stat, an injury, a teammate or any figure. Quote a number exactly as the facts give it, never a rounding of it and never a figure you worked out. Every figure in the facts is one the page prints as a cell: name it the way the cell does ("242.5 PPR points for the rest of the season", "30.7 PPR points a game this season", "37.7 points in his last game", "26th of 32 against receivers"), and the published projection by that name with its figure. On his bye this week has no figure, and the week after it has none in the facts.
- Every figure carries its unit right after it: "32 points", "19.5 points", "25.9 PPR points a game", "28th of 32 against receivers", "61 degrees", "14 mph", "a 30% chance". Never a bare figure, never "32 to 19.5".
- A rank against his position reads as the facts give it, 1st allowed the fewest, said the way a person would, never a code. "The most" is only the last rank and "the fewest" only the first: say a rank in the words the facts give for it.
- "This week" is fine. Never a date or the name of a month. A week still to play is only looked ahead to.
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
    listed = "\n".join(f'- "{shape}"' for shape in dict.fromkeys(sentence_shape(s) for s in avoid))
    return [f"{AVOID_LEAD}\n{listed}"]


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


# The week's own statements for the rules a correction names most (Lane 264, B267), in place of the season
# read's: that read carries the season on every week and lets a number round, the week read neither.
SEASON_ONCE_NOTE: Final = (
    "Name the season once, with the first week the read names, whichever week that is "
    '("week 8 of 2026", "before week 8 of 2026\'s game status report"), and every later week without it ("week 7").'
)
SEASON_TWICE_NOTE: Final = (
    'Keep "of {season}" on the first week the read names and strike it from every later week ("week 7", '
    'never "week 7 of {season}").'
)
UNTRACED_NUMBER_NOTE: Final = (
    'Every number is a figure the facts print, word for word, and a count in words ("three", "two") is a number: '
    "leave out a count the facts do not give."
)
OPENER_NOTE: Final = (
    'Open on the call ("Start him", "Sit him"), a figure with its unit, or his status in the facts\' words '
    '("no designation", "Questionable", "Out"). A depth chart place ("third among the backs") is none of them.'
)
SHAPE_NOTE: Final = (
    'Its shape as the check compares it is "{shape}", and another page carries that shape. Build the sentence '
    "another way, on a fact only he has."
)
REPORT_SEASON_NOTE: Final = (
    "When no earlier sentence names the season, that week carries it (\"before week 8 of {season}'s game status "
    'report").'
)
_REPORT_DAY: Final = "a report the facts do not name"
_IN_SENTENCE: Final = ' in the sentence "'
_SEASON_COUNT: Final = "The read names the season"
_TIME_FRAME: Final = "time frame (a week without its season)"
_UNTRACED: Final = "an untraced number"
_OPENER: Final = "opens without the call, a figure or his status"


def _sentence_note(violation: str, note: RuleNote) -> RuleNote:
    """A week rule's violation the shared reader keeps whole, split into its rule, its sentence and its
    remedy, so the correction quotes the sentence once."""
    if note.sentence is None or note.statement != violation:
        return note
    head, found, tail = violation.partition(f'{_IN_SENTENCE}{note.sentence}"')
    if not found:
        return note
    rule = head.rstrip(",").removeprefix("The text ").strip()
    return RuleNote(rule, note.sentence, tail.removeprefix(".").strip() or violation)


def _season_sentence(body: str, season: int) -> str | None:
    """The second sentence of `body` that names `season`: the first one the season must leave."""
    carrying = [s.strip() for s in split_sentences(body) if str(season) in s]
    return carrying[1] if len(carrying) > 1 else None


def week_note(sheet: WeekSheet, violation: str, body: str) -> RuleNote:
    """One violation of the draft `body` as the correction states it: the sentence it broke, word for word,
    and the week's own wording of the rule."""
    if violation.startswith(_SEASON_COUNT):
        rule = violation.split(". ", 1)[0].removeprefix("The read ")
        twice = SEASON_TWICE_NOTE.format(season=sheet.season)
        return RuleNote(rule, _season_sentence(body, sheet.season), twice)
    note = _sentence_note(violation, note_of(violation, body))
    statement = _week_statement(sheet, violation, note)
    return note if statement is None else RuleNote(note.rule, note.sentence, statement)


def _week_statement(sheet: WeekSheet, violation: str, note: RuleNote) -> str | None:
    """The week's own statement for `note`'s rule, None where the shared one stands."""
    if note.rule.startswith(_TIME_FRAME):
        return SEASON_ONCE_NOTE
    if note.rule.startswith(_UNTRACED):
        return UNTRACED_NUMBER_NOTE
    if note.rule == _OPENER:
        return OPENER_NOTE
    if note.rule.endswith(_REPORT_DAY):
        return f"{note.statement} {REPORT_SEASON_NOTE.format(season=sheet.season)}"
    if violation.startswith(SHARED_SENTENCE) and note.sentence is not None:
        return SHAPE_NOTE.format(shape=sentence_shape(note.sentence))
    return None


def week_notes(sheet: WeekSheet, attempts: Sequence[tuple[str, Sequence[str]]]) -> tuple[RuleNote, ...]:
    """Every rule the attempts broke (`week_note`), each (rule, sentence) once, in the order first broken."""
    first: dict[tuple[str, str | None], RuleNote] = {}
    for body, violations in attempts:
        for violation in violations:
            note = week_note(sheet, violation, body)
            first.setdefault((note.rule, note.sentence), note)
    return tuple(first.values())


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
            f"Write it again, {MIN_SENTENCES} to {MAX_SENTENCES} short sentences, {ASKED_WORDS[0]} to "
            f"{ASKED_WORDS[1]} words and never more than {_HIGH}, keeping what was right. Every rule this read has broken so far, on this "
            "attempt and the ones before it. What you return breaks none of them and brings none of them back:"
            f"\n{lines}",
            _RETURN,
        ]
    )
