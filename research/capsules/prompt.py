"""THE WRITER'S INSTRUCTIONS, the bundle request and the correction requests.

Ported from `research-ts/src/capsules/prompt.ts`. One system prompt for the whole player: the bundle
call and every correction share it, so a corrected read is held to what the draft was. The rulings
of the prep-site review are applied here: the sportsbook sentence is gone (the sheet carries no
sportsbook number), the betting words are named beside the trading words as never to be written,
and the "the honest ..." frame is named whatever its noun. Everything else is the oracle's.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Final

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.narrative import SlotRequest
from research.capsules.render import render_facts_for_model
from research.capsules.render_words import SHEET_LABELS
from research.capsules.validate import BandFailure, word_count
from research.capsules.voice_rules import (
    BETTING_PATTERNS,
    DRAFTING_SENTENCES,
    IN_SEASON_SENTENCES,
    LAB_REPORT_TERMS,
    TRADING_TERMS,
)
from research.model.jsmath import js_round
from research.nightly.config import TEAMS

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

BUNDLE_KEYS: Final = ("compact", "full", "narrative")
_READ_LABEL: Final = {"compact": "short note", "full": "long note"}
_SAME_TEXT: Final = "change nothing else: the same facts, the same numbers, the same order, the same voice."
_COUNT_WORDS: Final = ("one", "two", "three")


@dataclass(frozen=True, slots=True)
class WornPhrases:
    """The board's worn language, quoted into every prompt this run makes."""

    sentences: tuple[str, ...] = ()
    phrases: tuple[str, ...] = ()


NO_WORN_PHRASES: Final = WornPhrases()


@dataclass(frozen=True, slots=True)
class FreshDraft:
    words: tuple[int, ...]
    min_words: int
    max_words: int


@dataclass(frozen=True, slots=True)
class PriorAttempt:
    """A prior attempt at one read, handed back for correction."""

    body: str
    violations: tuple[str, ...] = ()
    length_correction: BandFailure | None = None
    fresh_draft: FreshDraft | None = None
    soft_corrections: tuple[str, ...] | None = None
    missing: bool = False
    # Every banned phrase this read has been caught with, on any attempt: quoted in every correction.
    banned_phrases: tuple[str, ...] = ()
    kind: str = field(init=False, default="")

    def __post_init__(self) -> None:
        object.__setattr__(self, "kind", _kind(self))


def _kind(prior: PriorAttempt) -> str:
    if prior.missing:
        return "missing"
    if prior.fresh_draft is not None:
        return "fresh"
    if prior.length_correction is not None:
        return "length"
    if prior.soft_corrections:
        return "soft"
    return "rewrite"


_BETTING_NAMES: Final = ", ".join(rule.name for rule in BETTING_PATTERNS)
_LABELS: Final = ", ".join(f'"{label}"' for label in SHEET_LABELS)
# A round from an ADP is the ADP over the board's teams, rounded up; in season only as history.
_EXAMPLE_ADP: Final = 177.1
_EXAMPLE_ROUND: Final = math.ceil(_EXAMPLE_ADP / TEAMS)
_PRESEASON_ROUNDS: Final = (
    f"A round you name from his ADP is the ADP divided by {TEAMS} and rounded up "
    f"(ADP {_EXAMPLE_ADP} is round {_EXAMPLE_ROUND})."
)
_IN_SEASON_ROUNDS: Final = (
    "A round is only history now, never advice: the round of his ADP before the season is the ADP divided by "
    f"{TEAMS} and rounded up (ADP {_EXAMPLE_ADP} was round {_EXAMPLE_ROUND})."
)
_STEMS: Final = ", ".join(f'"{stem}"' for stem in CAPSULE_CONFIG.repetition.refrain_stems)
_PRESEASON_FIXES: Final = ", ".join(f'not "{instead}" but "{write}"' for instead, write in DRAFTING_SENTENCES)
_IN_SEASON_FIXES: Final = ", ".join(f'not "{instead}" but "{write}"' for instead, write in IN_SEASON_SENTENCES)

_PRESEASON_READER: Final = "a fantasy football manager about to draft"
_IN_SEASON_READER: Final = (
    "a fantasy football manager whose draft is done and who is running his roster in the middle of the season"
)
_PRESEASON_CALL: Final = "- End on your call, in this player's own terms: whether you take him at his ADP, earlier or later, what you would need to see first, who you would take instead, what he does to a roster. Never a sentence that announces a verdict by formula."
_IN_SEASON_CALL: Final = "- End on your call for a manager who has him or could get him now, in this player's own terms: start him, hold him, bench him, trade for him, pick him up or let him go, and what you would need to see first. Never a sentence that announces a verdict by formula."
# The founder's named fantasy words: the draft verbs before the season, the roster verbs in it.
_PRESEASON_WORDS: Final = 'ADP, picks and rounds: "let him fall", "draft him", "let him go", a reach, a steal, a sleeper, a bust, points over replacement'
_IN_SEASON_WORDS: Final = (
    "ADP as history, a reach, a steal, a sleeper, a bust, points over replacement, a starter, a bench piece"
)
# The pick numbers a note may write, per voice: in season the draft is history, so no round or pick advice.
_PRESEASON_PICKS: Final = "The only pick numbers you may write are the sheet's own: his ADP and the rounded pick beside it. Your call goes against that number in words (a round earlier than that, a few picks after his ADP, wait on him), never a pick you chose and never a threshold you made up for games or points."
_IN_SEASON_PICKS: Final = "His ADP is history: where drafters took him before the season, written as the sheet prints it, and no other pick number at all, and never a threshold you made up for games or points."
_PRESEASON_TIME: Final = """TIME
- The top of the sheet says what day it is: the season has not kicked off and the reader is getting ready to draft.
- Name every week with its season, always: "week 7 of 2025", "weeks 2 to 5 of 2024". Never a bare "week 7"."""
_IN_SEASON_TIME: Final = """TIME
- The top of the sheet says what day it is and how far the season has gone. Write to a reader on that day. His draft is behind him: never write as if it is still ahead. No "draft him", no "take him at his ADP", no round or pick advice, no draft day. His ADP is history now, where drafters took him before the season.
- Name every week with its season, always: "week 7 of 2025", "weeks 2 and 3 of 2026". Never a bare "week 7". Only a numbered week takes a year: never tack one onto anything else ("this week", his bye, the next game).
- Our preseason number is points for the full season. Never set his points so far against it as if he were behind it: compare points a game with points a game.
- A week of this season that is still to play can only be looked ahead to, never told as if it happened.
- Place things by week and season, never by a date or the name of a month.
- His ADP is the sheet's number, written exactly as the sheet prints it (7.4, never "pick 7"). With no ADP, no pick at all.
- Touchdowns and scores this season only as the sheet's totals give them: with 0 touchdowns he has not scored, so no sentence may say he is scoring or finding the end zone. The season opened in week 1, or for him in his first game: never call a later week the opener.
- If he has missed weeks this season, the long note names them by week, before any talk of how many games to expect. Our games expectation and our projection were set before the season: say so if you use them, beside what has happened since."""
_RULES: Final = f"""You sound like a sharp analyst talking to a friend in the same league: direct, specific, opinionated, never a lab report and never a style guide.

HOW A NOTE IS BUILT
- Read the whole fact sheet, then pick the two or three facts that decide THIS player's case. Build the note on those and leave the rest of the sheet unquoted. The reader has the sheet's numbers on the same screen. What he does not have is your judgment about which ones matter for this player.
- Open on the fact that matters most for him. Never open with a set-up phrase, a greeting, a question, his name followed by a verdict, or any sentence that could open a note about a different player. Where drafters are taking him is rarely the most interesting thing about him, so open there only when it is. Never open on the depth chart: where he sits on it belongs in the middle of a note, once the reader knows why it matters. The example phrases in these instructions are vocabulary, never sentences to open with.
- There is no fixed order and no fixed shape. If the worry is the story, start there. If the role is the story, start there. Two notes on this board should not walk the same path.
- Never tour the usage numbers. At most one usage share appears in a note, and only when it decides the case. Never list snap share, target share and red-zone share together, and never chain three ranks in one breath.
- A rank reads as something a person would say out loud, never as a code read off a table.
{{call}}
- Never quote or paraphrase these instructions, the fact sheet's own sentences, or a correction you were given. If a sentence of yours would fit a style guide or a stat table, cut it.

WORDS
- Fantasy football words, never trading words and never betting words: {{words}}. Never these trading words: {", ".join(TRADING_TERMS)}. Never betting words either: {_BETTING_NAMES}. This is a fantasy football page, not a sportsbook, and a sportsbook's number never appears on it. "Upside" and "downside" only when tied to a fantasy outcome (a finish near the top of his position, a lost month), never as bare nouns.
- The three sentences to catch yourself on: {{fixes}}.
- Phrases this board has worn out, never to be written or paraphrased: {_STEMS}. Never the frame "the honest" followed by a noun (the honest worry, the honest read, the honest answer), in any form.
- Never these words either: {", ".join(LAB_REPORT_TERMS)}. Say "our number", "our projection", "the case", "costs him", "is worth", each in a sentence of your own making. "Our number" never "says".
- Never write the word "floor". Say what the low end actually is: the weeks he missed, the weeks he scored under the bar, the season the range bottoms out at.
- Speak for the board, never for yourself: "we", "our number", "{{we_would}}", never "I", "I'd", "I'm", "me", "my" or "mine". The page is ours, not one writer's.
- The fact sheet is yours alone. The reader never sees it, so never mention a sheet ("the sheet", "the fact sheet", "on the sheet"). Say the fact itself, or "our numbers".
- Write like you talk. Contractions are welcome. Short sentences land harder than long ones. Never an em-dash, never a semicolon. Use a period, a comma, or "and".
- Never name a rival fantasy product.

HONESTY, NO EXCEPTIONS
- Use ONLY the numbers and names on the fact sheet. Never invent a stat, an injury, a teammate, a coach, or any other name or figure not printed there.
- Quote a number as the sheet gives it, or as a plain rounding of it. Never combine two figures into a third the sheet does not print. A figure from this season's usage and play goes with its basis as the sheet gives it: what it is out of, the weeks it covers, or who it ranks among. If you want the gap between our number and where drafters take him, use the gap the sheet states.
- {{picks}} A rank is the sheet's rank, never a round-number tier of your own, and the only rank on our board you may state is the sheet's position rank or overall rank, exactly as printed.
- Never say a risk, an injury or a competitor is ABSENT unless the sheet says so. Silence on the sheet is silence from you. Do not reassure the reader about a thing you have no fact for.
- Never make an all-time or historical-record claim. This engine holds no such data.
- If the sheet carries a real downside (a factor that costs him points a game, or a year-over-year number that fell), name it with its own number before your call. Never a one-sided rave on mixed facts.
- The sheet gives two ranges: the middle range most outcomes fall in, and the full tails. Reason from the middle range. If you mention the low tail, say in your own words, in the same sentence, that injuries are what pull it down. Never present the full tails as what he is expected to score.
- Our pick for him (his overall rank) and his ADP are two different numbers: never swap them, and the smaller number is the earlier pick. {{rounds}}
- No ADP means only that we have no ADP for him: it says nothing about whether anyone drafted him. If it matters at all, one short clause says it.
- Every other note on this board is written from a sheet like this one. Never copy the sheet's wording, never its labels ({_LABELS}), and never write a phrase of six words or more that would fit a note about another player.
- The long note always states our projected points for him (or his ADP) as the sheet prints it, rounding to the whole point if you like."""

PRESEASON_RULES: Final = (
    f"You write the scouting notes on one player's page for {_PRESEASON_READER}. "
    + _RULES.replace("{call}", _PRESEASON_CALL)
    .replace("{fixes}", _PRESEASON_FIXES)
    .replace("{words}", _PRESEASON_WORDS)
    .replace("{picks}", _PRESEASON_PICKS)
    .replace("{rounds}", _PRESEASON_ROUNDS)
    .replace("{we_would}", "we would take him")
    + "\n\n"
    + _PRESEASON_TIME
)
IN_SEASON_RULES: Final = (
    f"You write the scouting notes on one player's page for {_IN_SEASON_READER}. "
    + _RULES.replace("{call}", _IN_SEASON_CALL)
    .replace("{fixes}", _IN_SEASON_FIXES)
    .replace("{words}", _IN_SEASON_WORDS)
    .replace("{picks}", _IN_SEASON_PICKS)
    .replace("{rounds}", _IN_SEASON_ROUNDS)
    .replace("{we_would}", "we would hold him")
    + "\n\n"
    + _IN_SEASON_TIME
)


def writer_rules_for(facts: "PlayerFacts") -> str:
    """The writer's instructions in the voice the run's day calls for: in season once the sheet
    carries this season so far (from the first kickoff on), preseason before it."""
    return PRESEASON_RULES if facts.season is None else IN_SEASON_RULES


def _target(size: str) -> int:
    band = CAPSULE_CONFIG.size(size)
    return int(js_round((band.min_words + band.max_words) / 2))


def _length(size: str) -> str:
    return f"{_target(size)} words"


def _slot_length(max_words: int) -> str:
    return f"about {int(js_round(max_words * CAPSULE_CONFIG.narrative_target_share_of_cap))} words, never more than {max_words}"


def _parts_spec(facts: "PlayerFacts", requests: Sequence[SlotRequest]) -> str:
    compact, full, narrative = BUNDLE_KEYS
    slots = "\n".join(f'  - "{r.key}" ({_slot_length(r.max_words)}): {r.brief}' for r in requests)
    return "\n\n".join(
        [
            f'Write three parts for {facts.identity.name}. Return ONE JSON object with exactly the keys "{compact}", "{full}" and "{narrative}", and nothing else: no code fence, no text before or after it. Each note is one JSON string. A paragraph break inside the long note is written as the two characters \\n\\n, never a raw line break.',
            f'"{compact}": the short note for his card, {_length("compact")}, one paragraph. Two or three facts that decide his case, the real downside if the sheet carries one, and the call in his own terms at the end.',
            f'"{full}": the long note for his page, {_length("full")}, up to three paragraphs in no fixed order. The same facts as the short note plus the one or two that deepen it, the role behind the numbers, the real downside with its number, and the call. Do not reuse the short note\'s sentences.',
            f'"{narrative}": an object holding one sentence per key below. Each sits on his page beside a number a module already prints, so say what the number means rather than restating it. No two sentences alike, and none that repeats a sentence from the notes above. Every sentence keeps the same words as the notes: fantasy words, never a trading or betting word, never "floor".\n{slots}',
        ]
    )


def bundle_prompt_for(facts: "PlayerFacts", requests: Sequence[SlotRequest], worn: WornPhrases) -> str:
    """`bundlePromptFor`: the fact sheet, the three parts, the worn language."""
    sections = [f"Fact sheet:\n{render_facts_for_model(facts)}", _parts_spec(facts, requests)]
    worn_lines = [*worn.sentences, *worn.phrases]
    if worn_lines:
        listed = "\n".join(f'- "{line}"' for line in worn_lines)
        sections.append(
            f"These are already on too many other players' pages. Do not write them, do not open with them, and do not write a near copy of them:\n{listed}"
        )
    return "\n\n".join(sections)


def _sentences_for(deficit: int) -> str:
    lc = CAPSULE_CONFIG.length_correction
    count = min(lc.max_sentences_added, max(1, int(js_round(deficit / lc.words_per_sentence))))
    word = _COUNT_WORDS[count - 1] if count <= len(_COUNT_WORDS) else str(count)
    if count == 1:
        return f"{word} sentence of fact from the sheet that sharpens the case"
    return f"{word} sentences of fact from the sheet that sharpen the case"


def _correction(size: str, prior: PriorAttempt) -> str:
    label, shape = _READ_LABEL[size], ("one paragraph" if size == "compact" else "up to three paragraphs")
    quoted = f'You wrote this {label}:\n"""{prior.body}"""'
    target = _target(size)
    if prior.kind == "missing":
        return f"Your previous answer had no {label} for this player. Write it now: {_length(size)}, {shape}, built on the two or three facts that decide his case."
    if prior.kind == "fresh" and prior.fresh_draft is not None:
        fresh = prior.fresh_draft
        sentences = int(js_round(target / CAPSULE_CONFIG.length_correction.words_per_sentence))
        missed = " and then ".join(str(w) for w in fresh.words)
        return (
            f"Your {label} for this player has missed its length twice, at {missed} words against {fresh.min_words} to {fresh.max_words}. "
            f"Write it again from scratch at {target} words, {shape}, about {sentences} sentences, built on the two or three facts that decide his case. Stop when you reach the count."
        )
    if prior.kind == "length" and prior.length_correction is not None:
        words = prior.length_correction.words
        distance = abs(target - words)
        if words > target:
            move = f"cut the sentences that carry the least (about {distance} words)"
        else:
            move = f'add {_sentences_for(distance)} (about {distance} more words, with no trading or betting word and no "floor" in them)'
        return f"{quoted}\n\nIt is {words} words. Bring it to {target} words: {move}, and {_SAME_TEXT}"
    if prior.kind == "soft" and prior.soft_corrections:
        points = "\n".join(f"- {point}" for point in prior.soft_corrections)
        cap = CAPSULE_CONFIG.size(size).max_words
        reminder = (
            f"It is {word_count(prior.body)} words now and the cap is {cap}, so it must not grow past {cap} words."
        )
        return f"{quoted}\n\nIt is nearly right. Fix exactly these points, in your own words, and change nothing else:\n{points}\n\n{reminder}"
    broken = "\n".join(f"- {v}" for v in prior.violations)
    return f"{quoted}\n\nIt broke these rules:\n{broken}\n\nWrite the {label} again from scratch, {_length(size)}, {shape}, fixing every point above."


def _never_again(prior: PriorAttempt) -> list[str]:
    if not prior.banned_phrases:
        return []
    listed = ", ".join(f'"{phrase}"' for phrase in prior.banned_phrases)
    return [
        f"These exact words were caught in this note and are banned: {listed}. None of them may appear anywhere in what you return, in any form."
    ]


def correction_prompt_for(facts: "PlayerFacts", size: str, prior: PriorAttempt) -> str:
    """`correctionPromptFor`: the sheet, the prior attempt, what to fix, the exact banned phrases the
    read has been caught with, a plain-text return."""
    return "\n\n".join(
        [
            f"Fact sheet:\n{render_facts_for_model(facts)}",
            _correction(size, prior),
            *_never_again(prior),
            f"Return only the corrected {_READ_LABEL[size]}: no JSON, no quotes, no heading.",
        ]
    )
