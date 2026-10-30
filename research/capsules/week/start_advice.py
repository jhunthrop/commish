"""WORDS THAT TELL A MANAGER TO START HIM (the Lane 72 review's H2 and the re-review's F1): the phrase
backstop beside the writer's own call and the judge (`judge`).

A phrase list cannot be complete, so it is the third guard, not the only one. It reads:
- a start verb on him, his name or a pronoun ("start him", "fire Gibbs up", "ride with him", "go with
  him"), unless a negation stands in its own clause ("do not start him");
- a negation that recommends ("no reason not to start him", "don't hesitate to", "can't go wrong if you
  start him", "nothing should stop you from starting him"), read as the recommendation it is;
- the lineup said positively ("slide him into your flex", "keep him active", "he belongs in your lineup",
  "a locked-in starter for you"), unless the clause says what the lineup loses ("a zero in your lineup");
- a negated bench ("don't sit him", "never bench him"), which recommends starting him.
"""

import re
from typing import Final

from research.capsules.names import name_pattern

_CLAUSE_BREAK: Final = re.compile(r"[,;:.!?]|\b(?:but|so|and then|then)\b", re.IGNORECASE)
_NEGATION: Final = re.compile(r"\b(?:not|never|no|don't|do not|can't|cannot|won't|shouldn't)\b|n't\b", re.IGNORECASE)
# A negation that recommends: its clause asks him into the lineup however it is worded.
_DOUBLE_NEGATION: Final = re.compile(
    r"\bno reason not to\b|\b(?:don't|do not|never) hesitate\b|\bcan(?:'t|not) go wrong\b|"
    r"\bnothing (?:should |will |can )?stops? you\b|\bwouldn't think twice\b",
    re.IGNORECASE,
)
_VACANCY: Final = re.compile(r"\b(?:zero|nothing|hole|empty|out of|loses?)\b", re.IGNORECASE)
_SUFFIXES: Final = frozenset({"Jr", "Sr", "II", "III", "IV"})


def name_forms(name: str) -> list[str]:
    """His whole name, without a suffix, his first name and his surname."""
    words = [w for w in name.split() if w.rstrip(".") not in _SUFFIXES]
    return list(dict.fromkeys([name, " ".join(words), words[0], words[-1]])) if words else [name]


def _him(name: str) -> str:
    return "|".join(["him", "them", *(name_pattern(form) for form in name_forms(name))])


def _affirm(name: str) -> re.Pattern[str]:
    him = _him(name)
    return re.compile(
        rf"\b(?:start(?:ing)?|play(?:ing)?|use|using|deploy|trust|plug in|slot in|lock in)\s+(?:{him})\b|"
        rf"\bfire\s+(?:up\s+)?(?:{him})(?:\s+up)?\b|\b(?:ride|roll|go|stick)\s+with\s+(?:{him})\b|"
        rf"\b(?:put|keep|leave|slot|slide|plug|lock|get|have|drop)\s+(?:{him})\s+(?:back\s+)?(?:in|into)\s+"
        r"(?:your\s+|the\s+)?(?:starting\s+)?(?:lineups?|flex)\b|"
        rf"\bkeep\s+(?:{him})\s+active\b|\bbelongs?\s+in\s+(?:your|the)\s+(?:starting\s+)?lineup\b|"
        r"\bmust[- ]start\b|\bworth a start\b|\bin your (?:starting )?lineup this week\b|"
        r"\b(?:locked[- ]in\s+|weekly\s+|every-week\s+)?starter for you\b",
        re.IGNORECASE,
    )


def _negated_bench(name: str) -> re.Pattern[str]:
    return re.compile(rf"\b(?:don't|do not|never|no need to)\s+(?:bench|sit)\s+(?:{_him(name)})\b", re.IGNORECASE)


def _clause_around(sentence: str, start: int, end: int) -> tuple[str, str]:
    """The clause before a match (from the last break) and the whole clause holding it."""
    before = sentence[:start]
    breaks = list(_CLAUSE_BREAK.finditer(before))
    head = before[breaks[-1].end() :] if breaks else before
    after = _CLAUSE_BREAK.search(sentence, end)
    tail = sentence[end : after.start() if after else len(sentence)]
    return head, head + sentence[start:end] + tail


def start_advice_in(sentence: str, name: str) -> str | None:
    """The words in `sentence` that tell a manager to start the player `name`, or None."""
    negated = _negated_bench(name).search(sentence)
    if negated is not None:
        return negated.group(0)
    for match in _affirm(name).finditer(sentence):
        head, clause = _clause_around(sentence, match.start(), match.end())
        if _DOUBLE_NEGATION.search(head):
            return match.group(0)
        if _NEGATION.search(head):
            continue
        if match.group(0).lower().startswith("in your") and _VACANCY.search(clause):
            continue
        return match.group(0)
    return None


# WORDS THAT TELL A MANAGER TO SIT HIM (Lane 302 fix round 2, the review's M1): the mirror the decided call needs now
# that the writer no longer picks it. A start read never benches him and a hold read never settles the week either way.
def _sit(name: str) -> re.Pattern[str]:
    him = _him(name)
    return re.compile(
        rf"\b(?:sit|sitting|bench|benching|fade|fading)\s+(?:{him})\b|"
        rf"\b(?:leave|keep|put|stash)\s+(?:{him})\s+(?:on\s+(?:your\s+|the\s+)?bench|benched|out\s+of\s+(?:your\s+|the\s+)?"
        r"(?:starting\s+)?(?:lineups?|flex))\b|"
        r"\bstart\s+(?:someone|somebody|anyone|another\s+\w+)\s+(?:else\s+)?(?:over|instead\s+of|ahead\s+of)\b|"
        r"\bstart\s+(?:someone|somebody)\s+else\b",
        re.IGNORECASE,
    )


def sit_advice_in(sentence: str, name: str) -> str | None:
    """The words in `sentence` that tell a manager to sit the player `name` (unless a negation stands in their
    clause: "don't sit him" recommends starting him, `start_advice_in`), or None."""
    for match in _sit(name).finditer(sentence):
        head, _clause = _clause_around(sentence, match.start(), match.end())
        if _NEGATION.search(head):
            continue
        return match.group(0)
    return None


# A sentence that makes its advice wait on something: a hold's read may say what turns it to a start or a sit.
CONDITIONAL: Final = re.compile(
    r"\b(?:if|until|unless|once|when|whether|wait\w*|before|in case|depending|pending|should he)\b", re.IGNORECASE
)
