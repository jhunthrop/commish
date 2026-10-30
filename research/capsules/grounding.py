"""EVERY NUMBER AND EVERY NAME A CAPSULE PRINTS MUST TRACE TO ITS FACT SHEET.

Ported from `research-ts/src/capsules/number-grounding.ts` and the name half of `validate.ts`. A
number traces when it is a ledger value, its truncation, ceiling or floor, its magnitude, its
percent (for a fraction), or an honest rounding of any of those to zero, one or two decimals; a
round-number reading ("about 280") of a number the sheet prints traces too. A name traces when the
whole multi-word phrase is on the name ledger, or is a trailing part of a ledgered name, after a
sentence verb or starter that merged into it is shed. Names are read in any script and compared on
their folded form (`names.fold_name`), so "Audric Estime" traces to the sheet's "Audric Estimé" (Lane 75).
"""

import math
import re
from collections.abc import Sequence
from typing import Final

from research.capsules.names import fold_name
from research.model.jsmath import js_pow, js_round
from research.pipeline.jscompat import js_number

# A digit run is read whole (possessive), whatever letters follow it ("340yds" is 340, "1.1x" is 1.1),
# so no figure escapes tracing; an ordinal ending is left to `_ORDINAL` ("469th" is 469, never 46) and
# "49ers" is a club, not a number (Lane 52 and its review's H1).
_NUMBER_TOKEN: Final = re.compile(
    r"(?<![A-Za-z0-9])-?[0-9][0-9,]*+(?:\.[0-9]+)?+%?(?!(?:st|nd|rd|th)\b|ers\b)", re.IGNORECASE
)
_CARDINALS: Final = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20,
}  # fmt: skip
_TENS: Final = {
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
}
_UNITS: Final = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
_CARDINAL_WORD: Final = re.compile(rf"\b({'|'.join(_CARDINALS)})\b", re.IGNORECASE | re.ASCII)
_COMPOUND: Final = re.compile(rf"\b({'|'.join(_TENS)})(?:[-\s]({'|'.join(_UNITS)}))?\b", re.IGNORECASE | re.ASCII)
# An ordinal of any size, comma-grouped or not ("469th", "1,000th", "10000th"), read as its whole number
# (the re-review's N1); the digit-run reader leaves every ordinal ending to this one.
_ORDINAL: Final = re.compile(
    r"(?<![A-Za-z0-9,])([1-9][0-9]{0,2}(?:,[0-9]{3})+|[1-9][0-9]*)(st|nd|rd|th)\b", re.IGNORECASE | re.ASCII
)
_LOOSE_UNITS: Final = ((100, 10), (1000, 100))
_EPSILON: Final = 2.220446049250313e-16


def extract_numbers(text: str) -> list[tuple[str, float]]:
    """`extractNumbers`: digits (commas and a percent sign allowed), spelled cardinals to ninety-nine
    and ordinals ("469th" is 469), as (as written, value)."""
    numbers: list[tuple[str, float]] = []
    for raw in _NUMBER_TOKEN.findall(text):
        value = js_number(raw.replace(",", "").removesuffix("%"))
        if math.isfinite(value):
            numbers.append((raw, value))
    for match in _COMPOUND.finditer(text):
        unit = match.group(2)
        numbers.append(
            (match.group(0), _TENS[match.group(1).lower()] + (0 if unit is None else _CARDINALS[unit.lower()]))
        )
    without_compounds = _COMPOUND.sub(" ", text)
    numbers += [(m.group(0), _CARDINALS[m.group(1).lower()]) for m in _CARDINAL_WORD.finditer(without_compounds)]
    numbers += [(m.group(0), js_number(m.group(1).replace(",", ""))) for m in _ORDINAL.finditer(text)]
    return numbers


def round_half_up(value: float, decimals: int) -> float:
    """`roundHalfUp`: half away from zero, an epsilon past the binary tie."""
    factor = js_pow(10, decimals)
    sign = (value > 0) - (value < 0)
    return (sign * js_round(abs(value) * factor + _EPSILON * factor)) / factor


def _loose_readings(entry: float) -> list[float]:
    magnitude = abs(entry)
    out: list[float] = []
    for start, unit in _LOOSE_UNITS:
        if magnitude >= start:
            out += [math.floor(magnitude / unit) * unit, js_round(magnitude / unit) * unit]
    return out


def is_loose_reading_of(value: float, printed: Sequence[float]) -> bool:
    """`isLooseReadingOf`: "about 280" for a printed 284."""
    return any(abs(value) in _loose_readings(entry) for entry in printed)


def is_derived_from_ledger(value: float, ledger: Sequence[float], allow_magnitude: bool = True) -> bool:
    """`isDerivedFromLedger`."""
    for entry in ledger:
        if value == entry or value in (math.trunc(entry), math.ceil(entry), math.floor(entry)):
            return True
        magnitudes = [abs(entry)] if allow_magnitude else []
        percents = [entry * 100, *(m * 100 for m in magnitudes)] if abs(entry) <= 1 else []
        for candidate in (entry, *percents, *magnitudes):
            if candidate == value or value in (
                round_half_up(candidate, 0),
                round_half_up(candidate, 1),
                round_half_up(candidate, 2),
            ):
                return True
    return False


def prompt_numbers(prompt_text: str) -> list[float]:
    return [value for _, value in extract_numbers(prompt_text)]


# --- names ------------------------------------------------------------------------------------

_IN_NAME_ABBREVIATIONS: Final = frozenset({"St", "Jr", "Sr", "Mr", "Mrs", "Ms", "Dr"})
_INITIALS: Final = re.compile(r"^[A-Z](?:\.[A-Z])*$")
COMMON_SENTENCE_STARTERS: Final = frozenset(
    [
        "He",
        "She",
        "It",
        "They",
        "This",
        "That",
        "The",
        "A",
        "An",
        "His",
        "Her",
        "Their",
        "There",
        "But",
        "And",
        "Yet",
        "So",
        "Still",
        "Also",
        "However",
        "Meanwhile",
        "Now",
        "Then",
        "When",
        "Where",
        "While",
        "If",
        "After",
        "Before",
        "Once",
        "Since",
        "Because",
        "Until",
        "Whenever",
        "Every",
        "Each",
        "What",
        "Which",
        "Whether",
    ]
)
_FIRST_PERSON: Final = re.compile(r"^I(?:['\u2019][a-z]+)?$")
_POSITION_CODES: Final = frozenset(
    [
        "QB",
        "RB",
        "WR",
        "TE",
        "K",
        "DEF",
        "DST",
        "FLEX",
        "ADP",
        "PPR",
        "NFL",
        "TD",
        "TDS",
        "Q",
        "O",
        "D",
        "IR",
        "PUP",
        "NFI",
        "SUSP",
        "DNP",
        "LP",
        "FP",
    ]
)
_SENTENCE_VERBS: Final = frozenset(
    [
        "Buy",
        "Sell",
        "Draft",
        "Target",
        "Avoid",
        "Fade",
        "Stash",
        "Trust",
        "Start",
        "Sit",
        "Take",
        "Grab",
        "Pick",
        "Rank",
        "Pass",
        "Wait",
        "Roster",
        "Hold",
        "Bet",
        "Watch",
        "Ride",
        "Ditch",
        "Cut",
        "Drop",
        "Add",
        "Claim",
        "Rostering",
        # Lane 303 (B306): the call's imperatives before a surname ("Keep Engram", "Leave Rudolph", "Bench
        # Palmer", "Play Daniels").
        "Keep",
        "Leave",
        "Bench",
        "Play",
    ]
)
# Lane 303 (B306): an injury designation is a word of the report, never half a name ("He's Questionable" read
# as "He Questionable"); it breaks a Titlecase run as a position code does. So "Fakename Out" leaves the lone
# surname "Fakename", which is never checked: the lone-word policy of `proper_name_phrases` (a lower-case "out" never
# joined a run either), no new class (the Lane 303 review's L4).
_DESIGNATIONS: Final = frozenset(["Questionable", "Doubtful", "Out", "Probable"])
# A word of letters in any script, and the apostrophes, stops and hyphens a name holds; a name word is
# one of these whose first letter is a capital (Lane 75: an ASCII class cut "Estimé" to "Estim").
_WORD: Final = re.compile(r"\b[^\W\d_](?:[^\W\d_]|['\u2019.-])*")
_CLITIC: Final = re.compile(r"['\u2019]s$|['\u2019]$", re.IGNORECASE)


def _is_abbreviation(bare: str) -> bool:
    return bare in _IN_NAME_ABBREVIATIONS or _INITIALS.match(bare) is not None


def _is_run_break(word: str, next_word: str | None) -> bool:
    if not word.endswith("."):
        return False
    if not _is_abbreviation(word[:-1]):
        return True
    return next_word is not None and next_word in COMMON_SENTENCE_STARTERS


def _is_position_code(bare: str) -> bool:
    code = bare.upper().removesuffix(".")
    return code in _POSITION_CODES or (code.endswith("S") and code[:-1] in _POSITION_CODES)


def proper_name_phrases(text: str) -> list[str]:
    """`extractProperNamePhrases`: every run of two or more Titlecase words, a sentence's period
    ending the run (an in-name abbreviation's does not), position codes and the first person
    breaking it."""
    words: list[tuple[str, int, int]] = []
    for match in _WORD.finditer(text):
        if not match.group(0)[0].isupper():
            continue
        bare = _CLITIC.sub("", match.group(0), count=1)
        if (
            bare == ""
            or _is_position_code(bare)
            or bare.removesuffix(".") in _DESIGNATIONS
            or _FIRST_PERSON.match(bare)
        ):
            continue
        words.append((bare, match.start(), match.end()))
    phrases: dict[str, None] = {}
    i = 0
    while i < len(words):
        j = i
        while (
            j + 1 < len(words)
            and re.fullmatch(r"\s+", text[words[j][2] : words[j + 1][1]]) is not None
            and not _is_run_break(words[j][0], words[j + 1][0])
        ):
            j += 1
        if j > i:
            run = [word for word, _, _ in words[i : j + 1]]
            last = run[-1]
            if last.endswith(".") and not _is_abbreviation(last[:-1]):
                run[-1] = last[:-1]
            phrases.setdefault(" ".join(run), None)
        i = j + 1
    return list(phrases)


def _split(text: str) -> list[str]:
    return text.strip().split()


def _is_grounded(phrase: str, ledger: Sequence[str]) -> bool:
    cleaned = re.sub(r"['\u2019]s?$", "", phrase.strip(), flags=re.IGNORECASE)
    multi = " " in cleaned
    lower = fold_name(cleaned)
    for name in ledger:
        name_multi = " " in name.strip()
        if multi != name_multi:
            continue
        lowered = fold_name(name)
        if lowered == lower:
            return True
        if not multi:
            continue
        name_words, phrase_words = _split(lowered), _split(lower)
        if len(phrase_words) < len(name_words) and " ".join(name_words[len(name_words) - len(phrase_words) :]) == lower:
            return True
    return False


def is_name_grounded(phrase: str, ledger: Sequence[str]) -> bool:
    """`isNameGroundedWithShedding`: the phrase, or the phrase with its leading words shed one by
    one; at two words, a sentence verb before a ledgered surname, or a sentence starter before a
    ledgered word."""
    candidate = phrase.strip()
    while True:
        if _is_grounded(candidate, ledger):
            return True
        words = _split(candidate)
        if len(words) <= 2:  # noqa: PLR2004 - never shed below two words: a lone surname is no proof
            if len(words) == 2 and words[0] in _SENTENCE_VERBS:  # noqa: PLR2004
                surname = fold_name(words[1])
                if any(len(_split(fold_name(n))) >= 2 and surname in _split(fold_name(n))[1:] for n in ledger):  # noqa: PLR2004
                    return True
            if len(words) == 2 and words[0] in COMMON_SENTENCE_STARTERS:  # noqa: PLR2004
                return any(fold_name(n) == fold_name(words[1]) for n in ledger)
            return False
        candidate = " ".join(words[1:])


def sheet_name_begun(phrase: str, ledger: Sequence[str]) -> str | None:
    """The ledgered multi-word name an untraced `phrase` is a cut-off start of ("Audric Estim" of
    "Audric Estimé"), so the refusal can say what the sheet carries; None when it begins none."""
    folded = fold_name(phrase.strip())
    return next(
        (n for n in ledger if " " in n.strip() and fold_name(n) != folded and fold_name(n).startswith(folded)),
        None,
    )
