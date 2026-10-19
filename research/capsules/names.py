"""HOW A NAME IS COMPARED: the one normaliser every capsule and week-read rule compares names with.

The sheet prints a name as the page does, diacritics and all ("Audric Estimé"); a writer may keep the
accent or drop it. A name is compared on NFKD-normalised, accent-stripped, case-folded text, whole name
(Lane 75): "Audric Estime" is "Audric Estimé", "Audric Estim" is not. A rule that finds a name inside a
text reads it with `name_pattern`, which takes each accented letter with or without its accent.
"""

import re
import unicodedata
from typing import Final

# The combining diacritical marks a decomposed accent writes after its letter ("e" and U+0301).
_COMBINING_MARKS: Final = "[̀-ͯ]*"


def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def fold_name(name: str) -> str:
    """`name` for comparison only: NFKD-normalised, its accents stripped, case folded."""
    return _strip_accents(name).casefold()


def _letter_pattern(letter: str) -> str:
    bare = _strip_accents(letter)
    if bare == letter:
        return re.escape(letter)
    return f"(?:{re.escape(letter)}|{re.escape(bare)}{_COMBINING_MARKS})"


def name_pattern(name: str) -> str:
    """A regex source matching `name` as written with or without each accent (a precomposed or a
    decomposed one alike). Case is the caller's flag."""
    return "".join(_letter_pattern(letter) for letter in unicodedata.normalize("NFC", name))
