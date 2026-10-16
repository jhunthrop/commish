"""WHAT A RETRY IS TOLD IT GOT WRONG: each violation as the rule's name, the sentence it was broken
in (word for word), and the rule in one line (Lane 52).

Every correction carries the notes of every attempt at the read so far, not only the last one's:
Lane 50's samples ended 37 of 41 failing reads on a rule the attempt before had not broken (a bare
week fixed, then a betting word; a betting word fixed, then the downside dropped), because each
correction named only what the latest attempt broke. A violation names its sentence where its rule
reads sentence by sentence; one that quotes only a word or a figure (an untraced number, a rank cut
from its basis) is placed in the attempt's sentence that holds it; a rule of the whole note (its
length, its missing downside, its missing page number) has no sentence.
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.claims import (
    ADP_REVERSED,
    ADP_SWAPPED,
    NO_ADP_CLAIM,
    OPENER_CLAIM,
    ROUND_CLAIM,
    SCORING_CLAIM,
)
from research.capsules.corrections import BANNED_TERM_VIOLATION, TENSION_NUMBER, VOICE_RULE_VIOLATION
from research.capsules.multiples import MULTIPLE_VIOLATION
from research.capsules.prose_checks import LABEL_VIOLATION, UNFINISHED_VIOLATION
from research.capsules.season_voice import MISSED_WEEKS_UNNAMED
from research.capsules.sentences import split_sentences
from research.capsules.validate import (
    ADP_FIGURE_VIOLATION,
    COST_WORDS_SHOWN,
    NO_PAGE_NUMBER_VIOLATION,
    RANK_VIOLATION,
    UNFRAMED_FLOOR_VIOLATION,
)
from research.capsules.voice_rules import ALL_TIME_TERMS, EM_DASH, LAB_REPORT_TERMS, SEMICOLON


@dataclass(frozen=True, slots=True)
class RuleNote:
    """One rule a read broke: its name, the sentence it broke it in (None for a rule of the whole
    note), and the rule in one line."""

    rule: str
    sentence: str | None
    statement: str

    def line(self) -> str:
        where = "" if self.sentence is None else f', in "{self.sentence}"'
        return f"- {self.rule}{where}: {self.statement}"


# The sentence a violation names, in the shapes the rules write it.
_NAMED_SENTENCE: Final = re.compile(r'the sentence "(?P<s>.+?)"(?=\.\s+[A-Z]|\.$|\s+(?:says|names|calls)\s)')
_QUOTED: Final = re.compile(r'"(?P<q>[^"]+)"')
_BAND: Final = re.compile(r"^Word count \d+ is outside the required (?P<low>\d+)-(?P<high>\d+) word band\.$")
_COMPETITOR: Final = re.compile(r'^The text names a competitor product \("(?P<name>[^"]+)"\)')
_UNTRACED: Final = re.compile(r'^The (?P<kind>number|name) "(?P<q>[^"]+)" does not trace to any supplied fact\.$')
_RANK_BASIS: Final = re.compile(r'^The text states a rank, "(?P<q>[^"]+)", without who it ranks among\.')
_SHARE_BASE: Final = re.compile(r"^The (?:text hangs the share|share \"[^\"]+\" (?:names no base|borrows the base))")

# What each kind of voice slip is, in one line; the first prefix that fits a kind is its statement.
_VOICE_STATEMENTS: Final = (
    ("set phrase", "A worn or stock phrase is never written, in any form or a near copy."),
    ("doubled word", "Write each word once."),
    ("aside (the first person singular)", "Speak for the board as we, never I, me, my or mine."),
    ("aside (the writer's sheet)", "The reader never sees a sheet, so never mention one."),
    ("aside", "Never an aside to yourself or to an editor."),
    ("betting word", "Fantasy football words only, never a betting word in any sense."),
    ("draft voice", "His draft is behind the reader: in season, roster moves only, never draft advice."),
    (
        "time frame (a week without its season)",
        "Every week carries its season, as in week 6 of 2026, a bye and a stretch of weeks included.",
    ),
    ("time frame (a week still to play told as past)", "A week still to play is only looked ahead to."),
    ("time frame (a month)", "Place things by week and season, never by a month."),
    (
        "time frame (points a game against the season number)",
        "Our preseason number is a season total, so it never shares a sentence with a points-a-game figure. "
        "Set his pace against our preseason pace, a points-a-game figure, instead.",
    ),
)
_CLAIM_STATEMENTS: Final = {
    SCORING_CLAIM: "A scoring claim this season needs a touchdown in this season's totals.",
    OPENER_CLAIM: "The season opened in week 1, or for him in his first game, never a later week.",
    ADP_SWAPPED: "Our pick for him and his ADP are two different numbers, never swapped.",
    ADP_REVERSED: "Of two picks, the smaller number is the earlier one.",
    ROUND_CLAIM: "A round named from his ADP is the ADP over the league's teams, rounded up, and no round without one.",
    NO_ADP_CLAIM: "No ADP means only that we hold none for him, so never say who drafted him or who did not.",
}


def _sentence_holding(body: str, needle: str) -> str | None:
    return next((s for s in split_sentences(body) if needle in s), None)


def _named_sentence(violation: str) -> str | None:
    match = _NAMED_SENTENCE.search(violation)
    return None if match is None else match.group("s")


def _voice_note(violation: str, _body: str) -> RuleNote | None:
    match = VOICE_RULE_VIOLATION.match(violation)
    if match is None:
        return None
    kind, found, sentence = match.group(1), match.group(2), match.group(3)
    statement = next(
        line for prefix, line in (*_VOICE_STATEMENTS, ("", "Rewrite it plainly.")) if kind.startswith(prefix)
    )
    return RuleNote(f'{kind}, "{found}"', sentence, statement)


def _banned_note(violation: str, _body: str) -> RuleNote | None:
    match = BANNED_TERM_VIOLATION.match(violation)
    if match is None:
        return None
    term = match.group(1)
    statement = (
        "Never a lab-report word: say what the number means for him."
        if term in LAB_REPORT_TERMS
        else "Never an all-time or record claim."
        if term in ALL_TIME_TERMS
        else "Fantasy football words only, never a trading word."
    )
    return RuleNote(f'a banned word, "{term}"', match.group(2), statement)


def _mixed_note(violation: str, _body: str) -> RuleNote | None:
    if not violation.startswith("Mixed evidence:"):
        return None
    number = TENSION_NUMBER.search(violation)
    figure = "his downside" if number is None else number.group(1).lstrip("-")
    return RuleNote(
        "mixed evidence uncited",
        None,
        f"The strongest downside appears before the call with its own number and a cost word beside it "
        f'({COST_WORDS_SHOWN}), as in "costs him {figure} points a game".',
    )


def _copy_note(violation: str, body: str) -> RuleNote | None:
    """The copy rules: length, an empty answer, the em-dash and the semicolon, a rival product."""
    band = _BAND.match(violation)
    if band is not None:
        return RuleNote("length", None, f"The note runs {band.group('low')} to {band.group('high')} words.")
    if violation.startswith("The completion was empty"):
        return RuleNote("an empty answer", None, "Answer with the note itself.")
    for mark, name, statement in (
        (EM_DASH, "an em-dash", "Never an em-dash. Use a period, a comma, or and."),
        (SEMICOLON, "a semicolon", "Never a semicolon. Split it into two sentences."),
    ):
        if violation.startswith(f"The text contains {name}"):
            return RuleNote(name, _sentence_holding(body, mark), statement)
    competitor = _COMPETITOR.match(violation)
    if competitor is not None:
        return RuleNote(f'a rival product, "{competitor.group("name")}"', None, "Never name a rival fantasy product.")
    return None


def _prose_note(violation: str, _body: str) -> RuleNote | None:
    """The form rules: the floor, an unfinished ending, a copied label."""
    if violation == UNFRAMED_FLOOR_VIOLATION:
        return RuleNote('the word "floor"', None, 'Never the word "floor": say what the low end actually is.')
    if violation.startswith(UNFINISHED_VIOLATION):
        quoted = _QUOTED.search(violation)
        sentence = None if quoted is None else quoted.group("q")
        return RuleNote("an unfinished sentence", sentence, "Every sentence ends where it was going, on a period.")
    if violation.startswith(LABEL_VIOLATION):
        label = _QUOTED.search(violation)
        name = "a copied label" if label is None else f'a copied label, "{label.group("q")}"'
        return RuleNote(name, _named_sentence(violation), "Never copy the sheet's wording: say the fact itself.")
    return None


def _remedy_after(violation: str, quoted: str) -> str:
    """What a figure rule asks for, after the figure it quotes: 'His ADP is 104.7 or 105. Say exactly that'
    and 'the page has no ADP for him. Say no ADP or pick at all' alike (the review's L3)."""
    rest = violation.split(f'"{quoted}"', 1)[-1].lstrip(".,").strip().removeprefix("and ").strip()
    return rest[:1].upper() + rest[1:] if rest else violation


def _figure_note(violation: str, body: str) -> RuleNote | None:
    """The rules that quote a figure or a name: untraced ones, a rank without its basis, an ADP or a
    board rank that is not his."""
    untraced = _UNTRACED.match(violation)
    if untraced is not None:
        kind, quoted = untraced.group("kind"), untraced.group("q")
        statement = (
            "Every number is one the sheet prints, or a plain rounding of one, never two figures combined."
            if kind == "number"
            else "Every name is one the sheet prints."
        )
        return RuleNote(f'an untraced {kind}, "{quoted}"', _sentence_holding(body, quoted), statement)
    basis = _RANK_BASIS.match(violation)
    if basis is not None:
        quoted = basis.group("q")
        return RuleNote(
            f'a rank without its basis, "{quoted}"',
            _sentence_holding(body, quoted),
            "A usage rank says who it ranks among, as the sheet gives it.",
        )
    for prefix, name in ((ADP_FIGURE_VIOLATION, "an ADP or a pick not his"), (RANK_VIOLATION, "a board rank not his")):
        if violation.startswith(prefix):
            claim = _QUOTED.search(violation)
            quoted = "" if claim is None else claim.group("q")
            remedy = _remedy_after(violation, quoted)
            return RuleNote(f'{name}, "{quoted}"', _sentence_holding(body, quoted) if quoted else None, remedy)
    return None


def _page_note(violation: str, _body: str) -> RuleNote | None:
    """The rules of the page's own facts: the claims, a share's base, his missed weeks, his numbers."""
    rule = next((rule for rule in _CLAIM_STATEMENTS if violation.startswith(f"{rule}: ")), None)
    if rule is not None:
        return RuleNote(rule, _named_sentence(violation), _CLAIM_STATEMENTS[rule])
    if violation.startswith(MULTIPLE_VIOLATION):
        return RuleNote(
            "a multiple the figures do not make",
            _named_sentence(violation),
            "Call one figure double, twice, half or triple another only when the two stand within a tenth of it.",
        )
    if _SHARE_BASE.match(violation):
        return RuleNote(
            "a share without its own base",
            _named_sentence(violation),
            'Each share names its own base in full, never "of those" or "of them" after a share.',
        )
    for prefix, name in (
        (MISSED_WEEKS_UNNAMED, "missed weeks unnamed"),
        (NO_PAGE_NUMBER_VIOLATION, "no number of the page's own"),
    ):
        if violation.startswith(prefix):
            return RuleNote(name, None, violation.removeprefix(prefix).removeprefix(": ").strip())
    return None


_READERS: Final[tuple[Callable[[str, str], RuleNote | None], ...]] = (
    _voice_note,
    _banned_note,
    _mixed_note,
    _copy_note,
    _prose_note,
    _figure_note,
    _page_note,
)


def note_of(violation: str, body: str) -> RuleNote:
    """One violation of the read `body` as a note; one no reader knows is its own statement."""
    for read in _READERS:
        note = read(violation, body)
        if note is not None:
            return note
    return RuleNote(violation.split(". ", 1)[0].rstrip("."), _named_sentence(violation), violation)


def notes_of(attempts: Sequence[tuple[str, Sequence[str]]]) -> tuple[RuleNote, ...]:
    """Every rule the attempts broke, each (rule, sentence) once, in the order they were first broken."""
    first: dict[tuple[str, str | None], RuleNote] = {}
    for body, violations in attempts:
        for violation in violations:
            note = note_of(violation, body)
            first.setdefault((note.rule, note.sentence), note)
    return tuple(first.values())
