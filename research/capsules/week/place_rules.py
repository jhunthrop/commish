"""A PLACE AMONG HIS PEERS, AND HOW UNUSUAL A FACT IS, ONLY AS ITS OWN FACT STATES THEM (Lane 300, the final review's
H1 and L6).

A read may say where he ranks among his position's peers ("the 3rd-highest among wide receivers") or
how unusual a fact is ("far out of the ordinary") only as the usage fact it is about states it. Each claim is
bound to its fact the way an angle's figure is (`angle_rules._figure_violation`): by the measure its clause names,
or, when its clause names none, the measures its sentence names. A claim no bound fact states is refused, so the
snap share's place is never said of the target share, and a place no fact holds is never said at all.

A place is read in every form the writer uses (the final review's probes and pairs j to l):
- an end with an optional ordinal: highest, lowest, deepest, shortest, and their plain words most, fewest, least,
  heaviest, lightest, biggest, largest, smallest ("the 2nd-most", "the heaviest share");
- an ordinal among his peers ("6th among wide receivers", "6th among the receivers we rank");
- a top group ("a top-two share", "top 5");
- the first place said in words ("leads all receivers", "more than any receiver").

Only a sentence that places him among peers is read ("among", "we rank", "in the league", "of the week", "than
any", "leads all"), and never one about what an opponent allows (the opponent's rank is `rules`' to judge).
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.week.angle_candidates import Measure
from research.capsules.week.angle_rules import _clause, _named
from research.capsules.week.angles import Angle
from research.capsules.week.sheet import WeekSheet

_HIGH: Final = ("highest", "deepest", "most", "heaviest", "biggest", "largest")
_LOW: Final = ("lowest", "shortest", "fewest", "least", "lightest", "smallest")
_WORD_ORDINALS: Final = {"second": 2, "third": 3, "fourth": 4, "fifth": 5}
_NUMBER_WORDS: Final = {"two": 2, "three": 3, "four": 4, "five": 5, "ten": 10}
# An end said of him; never "at least", "most of the week", "most of his snaps" (the round 5 re-review's H1).
_END: Final = re.compile(
    r"(?<!\bat )\b(?:(\d+)(?:st|nd|rd|th)[- ]|(second|third|fourth|fifth)[- ])?(" + "|".join((*_HIGH, *_LOW)) + r")\b"
    r"(?!\s+of\b)",
    re.IGNORECASE,
)
# "6th among the receivers we rank" (a rank among his club's receivers, "2nd among the Rams' receivers", is his
# depth-chart place, Lane 299's to judge: the round 5 re-review's M1).
_TOP: Final = re.compile(r"\btop[- ](\d+|two|three|four|five|ten)\b", re.IGNORECASE)
_FIRST: Final = re.compile(r"\bleads?\s+all\b|\bmore\s+than\s+any\b", re.IGNORECASE)
# A peer group: players at his position ("among the wide receivers", "than any receiver", "leads all backs") or
# "we rank"; never a bare "among", "of the week" or "in the league" (the round 5 re-review's H1). A club's players
# ("among the Rams' receivers") are his depth chart, never his peers.
_POSITIONS: Final = r"(?:wide receivers?|receivers?|wideouts?|running backs?|backs?|tight ends?|quarterbacks?|players?)"
# "6th among wide receivers", and Lane 300's "6th among the receivers we rank": a position's peers, never his club's
# ("2nd among the Rams' receivers" is his depth-chart place, Lane 299's to judge: the round 5 re-review's M1).
_ORDINAL_AMONG: Final = re.compile(
    rf"\b(\d+)(?:st|nd|rd|th)\s+[Aa]mong\s+(?:all\s+)?(?:the\s+)?(?:[a-z-]+\s+)?{_POSITIONS}\b"
)
# The peer group a place is said among (Lane 307: "among wide receivers", the sheet's words, or Lane 300's "among
# the wide receivers we rank").
_AMONG_RANKED: Final = re.compile(
    rf"\b[Aa]mong\s+(?:all\s+)?(?:the\s+)?((?:[a-z-]+\s+)?{_POSITIONS})(?:\s+we\s+rank)?\b"
)
_PEERS: Final = re.compile(
    r"\b[Ww]e rank\b|\bon our board\b|"
    rf"\b[Aa]mong\s+(?:all\s+)?(?:the\s+)?(?:[a-z-]+\s+)?{_POSITIONS}\b|"
    rf"\b[Tt]han\s+any(?:\s+other)?\s+(?:[a-z-]+\s+)?{_POSITIONS}\b|"
    rf"\b[Ll]eads?\s+all\s+(?:the\s+)?(?:[a-z-]+\s+)?{_POSITIONS}\b",
)
# The week's clubs, for the expected score's place ("the highest expected score of the week").
_WEEK_PEERS: Final = re.compile(r"\bexpected\b[^.]*\bof the week\b|\bof the week\b[^.]*\bexpected\b", re.IGNORECASE)
_ALLOWS: Final = re.compile(
    r"\b(?:allow\w*|gives? up|giving up|gave up|surrender\w*|generous|stingy|stingiest)\b", re.IGNORECASE
)
_PLACE_WORDS: Final = re.compile(
    r"\b(?:the\s+)?(?:(\d+)(?:st|nd|rd|th)-|(second|third)-)?(highest|lowest|deepest|shortest)\b"
)
_LEVELS: Final = re.compile(r"\b(far out of the ordinary|out of the ordinary)\b", re.IGNORECASE)
_LEVEL_STATED: Final = re.compile(
    r"\((far out of the ordinary|out of the ordinary|ordinary) (?:for a [a-z ]+|this week)\)\.$"
)


@dataclass(frozen=True, slots=True)
class Place:
    """A place among peers: its rank from an end (1 the end itself), the end, and for a top group its size."""

    rank: int
    high: bool
    top: bool = False


def _stated(words: str) -> Place | None:
    """A fact's stated place ("the 3rd-highest", "the second-lowest", "the highest") as a `Place`."""
    m = _PLACE_WORDS.search(words)
    if m is None:
        return None
    rank = int(m.group(1)) if m.group(1) else (_WORD_ORDINALS.get((m.group(2) or "").lower(), 1))
    return Place(rank, m.group(3) in _HIGH)


# A fact's measure by its key, for a fact that carries places but no figure (the round 5 re-review's L3).
_KEY_MEASURES: Final = {
    "snap": Measure.SNAPS,
    "target_depth": Measure.DEPTH,
    "target": Measure.TARGETS,
    "carry": Measure.CARRIES,
    "air_yards": Measure.AIR_YARDS,
    "red_zone": Measure.RED_ZONE,
    "expected": Measure.EXPECTED,
}


def _measure(angle: Angle) -> str | None:
    if angle.figures:
        return angle.figures[0].measure
    return next((m for prefix, m in _KEY_MEASURES.items() if angle.key.startswith(prefix)), None)


def _bound(sentence: str, start: int, end: int, sheet: WeekSheet) -> list[Angle]:
    """The facts a claim at `start`:`end` is about: the measures its clause names, else its sentence's."""
    named = _named(_clause(sentence[:start], sentence[end:])) or _named(sentence)
    return [a for a in sheet.angles if _measure(a) in named]


def _held(claim: Place, angles: Sequence[Angle]) -> bool:
    for angle in angles:
        for words, _group in angle.places:
            place = _stated(words)
            if place is None or place.high != claim.high:
                continue
            if (claim.top and place.rank <= claim.rank) or (not claim.top and place.rank == claim.rank):
                return True
    return False


def _claims(sentence: str) -> list[tuple[str, Place, int, int]]:
    out = []
    for m in _END.finditer(sentence):
        rank = int(m.group(1)) if m.group(1) else _WORD_ORDINALS.get((m.group(2) or "").lower(), 1)
        out.append((m.group(0), Place(rank, m.group(3).lower() in _HIGH), m.start(), m.end()))
    out += [(m.group(0), Place(int(m.group(1)), True), m.start(), m.end()) for m in _ORDINAL_AMONG.finditer(sentence)]
    for m in _TOP.finditer(sentence):
        size = int(m.group(1)) if m.group(1).isdigit() else _NUMBER_WORDS[m.group(1).lower()]
        out.append((m.group(0), Place(size, True, top=True), m.start(), m.end()))
    out += [(m.group(0), Place(1, True), m.start(), m.end()) for m in _FIRST.finditer(sentence)]
    return out


def _groups(sheet: WeekSheet) -> set[str]:
    return {
        g.lower().removeprefix("among ").removeprefix("the ").removesuffix(" we rank")
        for a in sheet.angles
        for _, g in a.places
    }


def _violation(what: str, sentence: str, remedy: str) -> str:
    return f'The text {what} in the sentence "{sentence}". {remedy}'


def _remedy(sheet: WeekSheet) -> str:
    said = [f"{_measure(a)}: {w} {g}" for a in sheet.angles for w, g in a.places]
    if not said:
        return "The facts place him among no peers: say nothing of where he ranks among them."
    return "Say his place among his peers only as the fact it is about states it: " + "; ".join(said) + "."


def place_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """Each place among his peers that the fact it is about does not state, in its words and its group."""
    groups = _groups(sheet)
    out = []
    for s in sentences:
        expected = any(a.key == "expected" for a in sheet.angles) and _WEEK_PEERS.search(s)
        if not (_PEERS.search(s) or expected) or _ALLOWS.search(s):
            continue
        bad = [said for said, claim, start, end in _claims(s) if not _held(claim, _bound(s, start, end, sheet))]
        said_groups = (g.group(1).lower().strip() for g in _AMONG_RANKED.finditer(s))
        bad += [f"among {g}" for g in said_groups if not any(x == g or x.endswith(f" {g}") for x in groups)]
        if bad:
            quoted = ", ".join(f'"{b}"' for b in dict.fromkeys(bad))
            out.append(_violation(f"places him among his peers as no usage fact does ({quoted})", s, _remedy(sheet)))
    return out


def _level(angle: Angle) -> str | None:
    m = _LEVEL_STATED.search(angle.text)
    return None if m is None else m.group(1)


def unusual_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """Each "(far) out of the ordinary" said of a fact whose line does not grade it so (the final review's L6)."""
    out = []
    for s in sentences:
        for m in _LEVELS.finditer(s):
            said = m.group(1).lower()
            # With no measure named, any fact graded so; "out of the ordinary" is true of a "far" fact too (the
            # round 5 re-review's M2).
            facts = _bound(s, m.start(), m.end(), sheet) or list(sheet.angles)
            held = {_level(a) for a in facts}
            if said not in held and not (said == "out of the ordinary" and "far out of the ordinary" in held):
                out.append(
                    _violation(
                        f'calls a fact "{said}" where the fact it is about is not graded so',
                        s,
                        "Say how unusual a fact is only as its line grades it, beside what it measures.",
                    )
                )
    return out
