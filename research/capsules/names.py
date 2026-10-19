"""HOW A NAME IS COMPARED: the one normaliser every capsule and week-read rule compares names with.

The sheet may print a name with its diacritics ("Audric Estimé", as nflverse spells him) and a writer may
keep the accent or drop it. A name is compared on NFKD-normalised, accent-stripped, case-folded text,
whole name (Lane 75): "Audric Estime" is "Audric Estimé", "Audric Estim" is not. A rule that finds a name
inside a text reads it with `name_pattern`, which takes each accented letter with or without its accent.

A limit, kept on purpose: NFKD takes accents off letters, not letters of their own, so "ł", "ø" and "đ"
are not folded to "l", "o" and "d". A name holding one traces only as the sheet spells it; no hand-kept
letter map is added.
"""

import re
import unicodedata
from typing import Final

# The combining diacritical marks a decomposed accent writes after its letter ("e" and U+0301).
_COMBINING_MARKS: Final = "[\u0300-\u036f]*"


def strip_accents(text: str) -> str:
    """`text` NFKD-normalised with its combining marks dropped, case kept."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def fold_name(name: str) -> str:
    """`name` for comparison only: NFKD-normalised, its accents stripped, case folded."""
    return strip_accents(name).casefold()


def _letter_pattern(letter: str) -> str:
    bare = strip_accents(letter)
    if bare == letter:
        return re.escape(letter)
    return f"(?:{re.escape(letter)}|{re.escape(bare)}{_COMBINING_MARKS})"


def name_pattern(name: str) -> str:
    """A regex source matching `name` as written with or without each accent (a precomposed or a
    decomposed one alike). Case is the caller's flag."""
    return "".join(_letter_pattern(letter) for letter in unicodedata.normalize("NFC", name))
