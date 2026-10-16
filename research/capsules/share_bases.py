"""EVERY SHARE NAMES ITS OWN BASE: two shares side by side read as one base unless each says its own.

Lane 41's sample put "blitzed on 30% of those charted dropbacks" right after "pressured on 27% of his
dropbacks", where the sheet takes the blitz share from all of his charted dropbacks. Two rules:

- a share hung on "of those", "of them", "of which" or "of these" ("30% of those", "40% of them") is
  refused, whatever the sheet says;
- a share with no base phrase of its own, in the sentence of an earlier share or the one after it, is
  refused when the sheet takes the two from different bases (the sheet's words for each percentage
  it prints, `sheet_bases`). A percentage the sheet does not print is the grounding rule's business.

A base phrase is "of ..." after the percentage, a base noun next to it ("a 96% snap share", "54%
situation-neutral passes", "his snap share is 96%", "a slice of the air yards at 22.5%"), a count
("(54 of 179)"), or the previous share's own base carried by "from", "to", "up", "down" or "between"
("fell from 97% to 89%"). A pair joined by "and", "or" or "to" alone shares the base that trails it
("between 97% and 89% of the snaps", "from 20% to 14% of the targets").

A base a carrier passes along stands as named, whatever the sheet says: "His red-zone share is 22% this
season, up from 13.3% last year" names its base once for one metric on two time bases, even when the
sheet takes the two from different counts. Refusing a passed-along base would flag honest sentences
(ruled for Lane 50's review, M2, not taken).

A bare "share" or "rate" ("a 30% share") still counts as naming a base, though the sheet's metric word
is missing (the review's L2, noted and not taken). Reading it as no base hands 8 live sentences of the
run 2026-10-15T14-2 to the sheet check, among them "a 10.6% share inside the ten" beside a
touchdown-points share, which names its metric after the noun. That is a likely new flag on an honest
sentence, against the ruling's bar of no flag beyond the three known.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final

from research.capsules.grounding import round_half_up
from research.capsules.sentences import split_sentences

_PERCENT: Final = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?:\s?%|\s+percent\b)(?!\s*(?:percentage\s+)?points\b)")
_ANAPHOR: Final = re.compile(r"^\s*,?\s*of\s+(?:those|them|which|these)\b", re.IGNORECASE)
_BASE_NOUN: Final = (
    r"(?:share|rate|snaps?|targets?|touch(?:es)?|carries|air[ -]yards|dropbacks?|passes|plays|attempts|routes)"
)
# A base runs to the clause's end, the next joined clause or the time it covers ("of his charted
# dropbacks and pressured on ...", "of the targets in 2024 to ...").
# A word between a percentage and its base noun ("54% situation-neutral passes", "a 35% slice of"),
# never a joining word or a determiner, which starts a new clause ("49.2% and his target share").
_MODIFIER: Final = r"(?:(?!(?:and|or|but|nor|his|her|their|its|the|to|from|with|on|in|while|as|than)\b)[a-z'-]+\s+)"
_TRAILING_OF: Final = re.compile(
    rf"^\s+{_MODIFIER}{{0,2}}?(?:of|among)\s+((?:(?!\b(?:and|but|while|with|which|as|than|to|from|in|by|over|across|during|"
    r"through|since|up|down|this|last|early|late)\b)[^,;:.()%])+)",
    re.IGNORECASE,
)
# The noun with its "share" or "rate" ("snap share", not "snap" with "share" left for the next share).
_TRAILING_NOUN: Final = re.compile(rf"^\s+({_MODIFIER}{{0,2}}?{_BASE_NOUN}(?:\s+(?:share|rate))?)\b", re.IGNORECASE)
_TRAILING_COUNT: Final = re.compile(r"^\s*,?\s*\(?\s*\d+(?:\.\d+)? of \d+")
# A base named before the percentage: a word or two, the noun, and what it is of ("red-zone share of
# his own touches").
_LEADING_PHRASE: Final = re.compile(
    rf"(?:[a-z'-]+\s+){{0,2}}{_BASE_NOUN}(?:\s+{_BASE_NOUN})*\b(?:\s+of\s+(?:[a-z'-]+\s+){{0,2}}[a-z'-]+)?",
    re.IGNORECASE,
)
_CLAUSE_BREAK: Final = re.compile(r"[,;:(]")
_CARRIERS: Final = frozenset({"to", "from", "up", "down", "between"})
# The time a figure covers, read past when a carrier joins two readings of it ("from 24% in 2024 to ...").
_TIME_WORDS: Final = frozenset({
    "in", "at", "by", "over", "across", "during", "the", "of", "a", "that", "same", "early", "late", "week",
    "weeks", "season", "year", "stretch", "month", "first", "last", "final", "start", "end", "half", "back",
})  # fmt: skip
_STOP_WORDS: Final = frozenset({
    "his", "her", "their", "the", "a", "an", "all", "own", "team's", "of", "is", "was", "share", "rate",
})  # fmt: skip
_BASE_QUALIFIERS: Final = frozenset({"charted", "tracked", "contested"})
_STOP_TAIL: Final = re.compile(r"\s+(?:in|over|across)\s+(?:his|the)\s+games?$")
_ANAPHORS: Final = '"of those", "of them" or "of which"'
_COUNT_BASE: Final = "(count)"
# The words that join a pair of shares sharing the base that trails the second ("97% and 89% of the snaps").
_PAIR_JOINS: Final = frozenset({"and", "or", "to"})


@dataclass(frozen=True, slots=True)
class Share:
    """One percentage in a sentence: its value as written, where it sits, and the base it names."""

    raw: str
    value: float
    decimals: int
    start: int
    end: int
    # The words of its own base phrase, normalized; None when it names none.
    base: str | None
    # The end of its base phrase (its own end when it names none): the next share's left edge.
    base_end: int
    # Hung on "of those", "of them", "of which" or "of these".
    anaphoric: bool
    # Its base is the phrase right after it ("of the snaps", "snap share").
    trailing: bool = False
    # Its base is borrowed from the next share in a pair ("97% and 89% of the snaps").
    paired: bool = False


def _singular(word: str) -> str:
    if word.endswith("ies"):
        return word[:-3] + "y"
    if word.endswith(("sses", "ches", "shes", "xes")):
        return word[:-2]
    return word[:-1] if word.endswith("s") and not word.endswith("ss") else word


def _normalized(words: str) -> str:
    """A base as what it is counted out of: its last noun, with a qualifier that names a different
    count ("charted dropbacks" against "dropbacks"). What the share counts ("red-zone", "inside-ten")
    is not its base: "red-zone touch share" and "inside-ten touch share" are both out of his touches."""
    text = _STOP_TAIL.sub("", words.strip().lower()).replace("-", " ")
    kept = [_singular(w) for w in re.findall(r"[a-z0-9']+", text) if w not in _STOP_WORDS and re.search("[a-z]", w)]
    if not kept:
        return ""
    return " ".join([*(w for w in kept[:-1] if w in _BASE_QUALIFIERS), kept[-1]])


def _trailing_base(after: str) -> tuple[str | None, int]:
    """The base phrase right after a percentage, and how far it runs."""
    bare: tuple[str | None, int] | None = None
    for pattern in (_TRAILING_NOUN, _TRAILING_OF):
        match = pattern.match(after)
        if match is not None:
            base = _normalized(match.group(1))
            if base:
                return base, match.end()
            # A bare "share" or "rate": read on for "of ..." after it, else it stands as named (L2, not taken).
            bare = bare or (base, match.end())
    count = _TRAILING_COUNT.match(after)
    if count is not None:
        return _COUNT_BASE, count.end()
    return bare or (None, 0)


def _leading_base(window: str, previous: Share | None) -> str | None:
    """A base noun in the clauses before a percentage, read back past a clause that holds only time or
    a carrier ("which jumped from"), or the previous share's base carried by a carrier alone."""
    for clause in reversed(_CLAUSE_BREAK.split(window)):
        named = list(_LEADING_PHRASE.finditer(clause))
        if named:
            return _normalized(named[-1].group(0))
        words = set(re.findall(r"[a-z]+", clause.lower())) - _TIME_WORDS
        if not words:
            continue
        if words <= _CARRIERS and previous is not None and previous.base is not None:
            return previous.base
        if not words & _CARRIERS:
            return None
    return None


def shares_in(sentence: str) -> list[Share]:
    """Every percentage in one sentence, left to right, each with the base it names."""
    shares: list[Share] = []
    for match in _PERCENT.finditer(sentence):
        after = sentence[match.end() :]
        anaphor = _ANAPHOR.match(after)
        previous = shares[-1] if shares else None
        if anaphor is not None:
            base, base_end = None, match.end() + anaphor.end()
        else:
            trailing, length = _trailing_base(after)
            left = previous.base_end if previous is not None else 0
            base = trailing if trailing is not None else _leading_base(sentence[left : match.start()], previous)
            base_end = match.end() + length
        raw = match.group(1)
        decimals = len(raw.split(".")[1]) if "." in raw else 0
        trailed = anaphor is None and base_end > match.end() and base is not None
        shares.append(
            Share(
                match.group(0),
                float(raw),
                decimals,
                match.start(),
                match.end(),
                base,
                base_end,
                anaphor is not None,
                trailed,
            )
        )
    return _paired(sentence, shares)


def _paired(sentence: str, shares: list[Share]) -> list[Share]:
    """A share naming no base takes the trailing base of the next share when only "and", "or" or "to"
    stand between them, read right to left so a run of three shares down to one base reads whole."""
    out = list(shares)
    for index in range(len(out) - 2, -1, -1):
        share, after = out[index], out[index + 1]
        words = re.findall(r"[a-z]+", sentence[share.end : after.start].lower())
        if share.base is None and not share.anaphoric and after.trailing and words and set(words) <= _PAIR_JOINS:
            out[index] = replace(share, base=after.base, trailing=True, paired=True)
    return out


def sheet_bases(sheet: str) -> dict[float, set[str]]:
    """Each percentage the sheet prints, with the base the sheet takes it from (a value printed on more
    than one base carries each)."""
    bases: dict[float, set[str]] = {}
    for line in sheet.splitlines():
        for sentence in split_sentences(line):
            for share in shares_in(sentence):
                if share.base and share.base != _COUNT_BASE:
                    bases.setdefault(share.value, set()).add(share.base)
    return bases


def _bases_of(share: Share, bases: dict[float, set[str]]) -> set[str]:
    """The sheet's bases for a share as written: the sheet's figure itself or a rounding of it."""
    found: set[str] = set()
    for value, names in bases.items():
        if share.value in (value, round_half_up(value, share.decimals)):
            found |= names
    return found


def _anaphor_violation(sentence: str, share: Share) -> str:
    return (
        f'The text hangs the share "{share.raw}" on "of those", "of them" or "of which" in the sentence '
        f'"{sentence}". Name each share\'s own base in full, never {_ANAPHORS} after a share.'
    )


def _unnamed_base_violation(sentence: str, share: Share, earlier: Share, bases: dict[float, set[str]]) -> str | None:
    if share.base is not None or share.anaphoric:
        return None
    mine, theirs = _bases_of(share, bases), _bases_of(earlier, bases)
    if not mine or not theirs or mine & theirs:
        return None
    return (
        f'The share "{share.raw}" names no base of its own and sits beside "{earlier.raw}", which is taken from '
        f'a different base, in the sentence "{sentence}". Name each share\'s own base in full, as in '
        f'"30% of all 179 charted dropbacks".'
    )


def _borrowed_base_violation(sentence: str, share: Share, bases: dict[float, set[str]]) -> str | None:
    """A paired share whose borrowed base is not the one the sheet takes it from ("pressured on 26% and
    30% of his charted dropbacks", where the sheet takes the 26% from all his dropbacks)."""
    mine = _bases_of(share, bases)
    if not share.paired or not mine or share.base in mine:
        return None
    return (
        f'The share "{share.raw}" borrows the base of the share after it, which is not its own, in the sentence '
        f'"{sentence}". Name each share\'s own base in full, as in "30% of all 179 charted dropbacks".'
    )


def _sentence_violation(
    sentence: str, shares: Sequence[Share], previous: Share | None, bases: dict[float, set[str]]
) -> str | None:
    for index, share in enumerate(shares):
        if share.anaphoric:
            return _anaphor_violation(sentence, share)
        earlier = shares[index - 1] if index > 0 else previous
        violation = _borrowed_base_violation(sentence, share, bases)
        if violation is None and earlier is not None:
            violation = _unnamed_base_violation(sentence, share, earlier, bases)
        if violation is not None:
            return violation
    return None


def base_violations(text: str, sheet: str) -> list[str]:
    """Every sentence that puts a share on a base it does not name, one violation per sentence."""
    bases = sheet_bases(sheet)
    violations: list[str] = []
    previous: Share | None = None
    for sentence in split_sentences(text):
        shares = shares_in(sentence)
        violation = _sentence_violation(sentence, shares, previous, bases)
        if violation is not None:
            violations.append(violation)
        previous = shares[-1] if shares else None
    return violations
