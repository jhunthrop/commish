"""TWO CHECKS ON A READ'S FORM, from the live review of 2026-10-15 (Lane 29).

- **A read ends as a sentence ends** (H1). Puka Nacua's page, the board's number 1, ended "Our number
  still clears the historical expectation for this draft slot by about". Every read, both sizes and
  every narrative sentence, ends in terminal punctuation (a closing quote or bracket may follow), and
  its last words are not a dangling article, conjunction, possessive or "by about". The validator
  hands an unfinished read back like any other failure; the page gate refuses a stored one
  (`pull_figures.capsule_findings`). The cause, a completion cut at its token limit and read as
  whole, is closed in `gateway.GatewayClient.complete`.
- **No facts label in prose** (H2). The sheet's framing words (`render_words.SHEET_LABELS`: "on
  file", "in our records", "where most outcomes fall", ...) copied into a sentence read as a template
  that failed to fill ("since the run-up to the next game", the old injury label) or as stock across
  the board ("report since the run-up to week" on 122 pages). A label in a read is a validator
  failure; the injury line now prints its status as data, and "the run-up to" is a worn phrase.
"""

import re
from typing import Final

from research.capsules.render_words import SHEET_LABELS
from research.capsules.sentences import phrase_pattern, split_sentences

# What may follow the full stop: a closing quote (straight or curly) or bracket.
_CLOSERS: Final = "\"'" + chr(0x201D) + chr(0x2019) + ")\\]"
_TERMINAL: Final = re.compile(rf"[.!?][{_CLOSERS}]*$")
# Words a sentence never ends on: an article, a conjunction, "than", "our" and "your", and a hedge
# waiting for its number ("by about", "at around"). Not a copula, "his" or a bare "of": "no matter how
# thin your bench is", "the job is his" and "the role he is capable of" end where they should.
_DANGLING: Final = re.compile(
    r"(?:\b(?:a|an|the|and|or|but|nor|than|our|your)"
    r"|\b(?:by|at|to|from|of|near|for)\s+(?:about|around|roughly|nearly|almost|some))"
    rf"\s*[.!?][{_CLOSERS}]*$",
    re.IGNORECASE,
)
UNFINISHED_VIOLATION: Final = "The text does not end as a sentence ends"
LABEL_VIOLATION: Final = "The text copies a label of the facts word for word"


_LABELS: Final = tuple((label, phrase_pattern(label)) for label in SHEET_LABELS)


def last_sentence(text: str) -> str:
    sentences = split_sentences(text.strip())
    return sentences[-1] if sentences else ""


def unfinished_ending(text: str) -> str | None:
    """The read's last sentence when it does not end as a sentence ends; None when it does."""
    trimmed = text.strip()
    if trimmed == "":
        return None
    if _TERMINAL.search(trimmed) is None or _DANGLING.search(trimmed) is not None:
        return last_sentence(trimmed)
    return None


def unfinished_violation(text: str) -> str:
    return (
        f'{UNFINISHED_VIOLATION}: its last sentence, "{last_sentence(text)}", is cut off. Finish that sentence with '
        "what it was going to say, ending on a period."
    )


def label_copies(text: str) -> list[str]:
    """Every label of the facts `text` copies word for word, in the renderer's order."""
    normalised = text.replace(chr(0x2019), "'")
    return [label for label, pattern in _LABELS if pattern.search(normalised)]


def label_violation(label: str, text: str) -> str:
    pattern = phrase_pattern(label)
    sentence = next((s for s in split_sentences(text) if pattern.search(s)), text)
    return (
        f'{LABEL_VIOLATION}, "{label}", in the sentence "{sentence}". Say the fact itself in your own words, with '
        "its week and season where it has one, and never the label."
    )
