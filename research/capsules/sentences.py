"""HOW A READ IS CUT INTO SENTENCES, AND HOW A FIXED PHRASE IS FOUND IN ONE: the single source every
capsule rule reads with (the validator, the claims, the form checks, the page gate, the span gate)."""

import re
from typing import Final

_SENTENCE_END: Final = re.compile(r"(?<=[.!?])\s+")


def split_sentences(text: str) -> list[str]:
    """The text's sentences, split after a full stop, a question or an exclamation; blanks dropped."""
    return [sentence for sentence in _SENTENCE_END.split(text) if sentence.strip() != ""]


def phrase_pattern(phrase: str) -> re.Pattern[str]:
    """`phrase` found whole and case folded, a hyphen and a space read as the same ("run-up", "run up")."""
    words = r"[\s-]+".join(re.escape(word) for word in re.split(r"[\s-]+", phrase))
    return re.compile(rf"(?<![A-Za-z]){words}(?![A-Za-z])", re.IGNORECASE)
