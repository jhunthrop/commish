"""HOW A READ IS CUT INTO SENTENCES, AND HOW A FIXED PHRASE IS FOUND IN ONE: the single source every
capsule rule reads with (the validator, the claims, the form checks, the page gate, the span gate)."""

import re
from typing import Final

_SENTENCE_END: Final = re.compile(r"(?<=[.!?])\s+")
# A name's suffix ("Harold Fannin Jr.", "Kyle Pitts Sr.", "Luther Burden III.") ends no sentence when the text runs
# on in lower case ("Harold Fannin Jr. is listed first"): the Lane 300 pairs cut "Harold Fannin Jr." off as a
# sentence of its own and refused the read's opener. Before a capital it ends one ("... start Michael Pittman Jr. He").
_SUFFIX: Final = re.compile(r"(?:^|\s)(?:Jr|Sr|II|III|IV|V)\.$")
# An abbreviation inside a name never ends a sentence: "Amon-Ra St. Brown", initials ("J.K. Dobbins", "C.J. Stroud").
_INSIDE_A_NAME: Final = re.compile(r"(?:^|[\s(\"'])(?:St|(?:[A-Z]\.)*[A-Z])\.$")
_RUNS_ON: Final = re.compile(r"^[a-z0-9]")


def _ends_here(before: str, after: str) -> bool:
    """Whether a full stop and the space after it end a sentence: never inside a name, never after a name's
    suffix the text runs on from."""
    if _INSIDE_A_NAME.search(before):
        return False
    return not (_SUFFIX.search(before) and _RUNS_ON.match(after))


def split_sentences(text: str) -> list[str]:
    """The text's sentences, split after a full stop, a question or an exclamation (never inside a name or after
    a name's suffix the text runs on from, `_ends_here`); blanks dropped."""
    out: list[str] = []
    start = 0
    for match in _SENTENCE_END.finditer(text):
        if _ends_here(text[start : match.start()], text[match.end() :]):
            out.append(text[start : match.start()])
            start = match.end()
    out.append(text[start:])
    return [sentence for sentence in out if sentence.strip() != ""]


def phrase_pattern(phrase: str) -> re.Pattern[str]:
    """`phrase` found whole and case folded, a hyphen and a space read as the same ("run-up", "run up")."""
    words = r"[\s-]+".join(re.escape(word) for word in re.split(r"[\s-]+", phrase))
    return re.compile(rf"(?<![A-Za-z]){words}(?![A-Za-z])", re.IGNORECASE)
