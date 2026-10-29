"""THE ANGLES' OWN RULES (Lane 300, the review's H1): an angle's figure is quoted as what it measures, and a place
among his peers only as an angle states it.

The cells' figure check is by value (`cells.quotable_figures`), so an angle's 32% of the targets could be quoted
as 32% of the snaps, and a writer could say "the highest among the receivers we rank" where no angle placed him.
Two rules, on every sheet:

- A figure that only an angle prints (no cell prints it) must sit beside its measure's words within its clause
  (`MEASURE_WORDS`): "32% of the Rams' targets" for a target share, "9 touchdowns", "11.2 yards downfield". A
  percent may be only an angle's share or the forecast's chance; a bare count may never be an angle's percent
  ("32 targets" for a 32% share).
- A place among his peers ("the 3rd-highest", "the highest ... among the wide receivers we rank", "2nd among",
  "the second-highest of the week") is refused unless an angle on the sheet states those words, among that group.

Each violation names its sentence in the writer's form, so a correction hands it back word for word.
"""

import re
from collections.abc import Callable, Sequence
from typing import Final

from research.capsules.page_figures import page_tenth
from research.capsules.week.angle_candidates import AngleFigure, Measure
from research.capsules.week.cells import card_figures, named_chance
from research.capsules.week.sheet import WeekSheet

# The words that say each measure, near its figure.
MEASURE_WORDS: Final = {
    Measure.SNAPS: re.compile(r"\bsnaps?\b", re.IGNORECASE),
    Measure.TARGETS: re.compile(r"\btargets?\b|\btarget share\b", re.IGNORECASE),
    Measure.CARRIES: re.compile(r"\bcarr(?:y|ies)\b", re.IGNORECASE),
    Measure.AIR_YARDS: re.compile(r"\bair[- ]yards?\b", re.IGNORECASE),
    Measure.RED_ZONE: re.compile(r"\bred[- ]zone\b", re.IGNORECASE),
    Measure.DEPTH: re.compile(r"\byards?\b", re.IGNORECASE),
    Measure.TOUCHDOWNS: re.compile(r"\btouchdowns?\b|\btds?\b", re.IGNORECASE),
    Measure.EXPECTED: re.compile(r"\bexpected\b", re.IGNORECASE),
    Measure.POINTS: re.compile(r"\bpoints?\b", re.IGNORECASE),
}
# A clause's edges: a figure's measure is named inside its own clause.
_CLAUSE_EDGE: Final = re.compile(r"[,;:.()]|\s(?:and|but|while|so|after|before|with)\s|\s-\s")
_PERCENT_AFTER: Final = re.compile(r"^(?:%|\s+percent\b)", re.IGNORECASE)
# A place among peers: "the 3rd-highest", "the second-highest", "the highest"; "2nd among"; "among the X we rank".
_PLACE: Final = re.compile(
    r"\b(?:the\s+)?((?:\d+(?:st|nd|rd|th)-|second-|third-)?(?:highest|lowest|deepest|shortest))\b", re.IGNORECASE
)
_ORDINAL_AMONG: Final = re.compile(r"\b(\d+(?:st|nd|rd|th)|first|second|third)\s+among\b", re.IGNORECASE)
_AMONG_RANKED: Final = re.compile(r"\bamong\s+(?:all\s+)?(?:the\s+)?([a-z][a-z ]*?)\s+we\s+rank\b", re.IGNORECASE)
# What makes a superlative a place among peers, not a plain word ("his highest game" is his own figure's).
_PEERS: Final = re.compile(r"\bamong\b|\bwe rank\b|\bof the week\b|\bin the league\b|\bon our board\b", re.IGNORECASE)

Stated = Callable[[str, int], list[tuple[str, float, str, str]]]


def _violation(what: str, sentence: str, remedy: str) -> str:
    return f'The text {what} in the sentence "{sentence}". {remedy}'


def _clause(before: str, after: str) -> str:
    """The clause around a figure: the text back to the last edge before it and on to the next edge after it."""
    head = _CLAUSE_EDGE.split(before)[-1]
    tail = _CLAUSE_EDGE.split(after, maxsplit=1)[0]
    return f"{head} {tail}"


def _named(clause: str) -> set[str]:
    return {measure for measure, words in MEASURE_WORDS.items() if words.search(clause)}


def _figures(sheet: WeekSheet) -> list[AngleFigure]:
    return [AngleFigure(page_tenth(f.value), f.measure) for angle in sheet.angles for f in angle.figures]


_SAY_ITS_MEASURE: Final = (
    "Quote an angle's figure as its angle says it, beside what it measures (\"32% of the Rams' targets\"), never "
    "as another measure, and never a share as a count."
)


def _figure_violation(raw: str, value: float, before: str, after: str, sheet: WeekSheet) -> str | None:
    """Why one stated figure misnames an angle's figure, or None."""
    figures = _figures(sheet)
    percent = raw.endswith("%") or bool(_PERCENT_AFTER.match(after))
    if percent:
        if value == named_chance_of(sheet):
            return None
        matching = [f for f in figures if f.percent and f.value == value]
        if not matching:
            return f'states "{raw}" as a share no angle states'
    else:
        if value in card_figures(sheet):
            return None
        matching = [f for f in figures if not f.percent and f.value == value]
        if not matching:
            shares = [f for f in figures if f.percent and f.value == value]
            return None if not shares else f'states "{raw}", an angle\'s share, as a count'
    named = _named(_clause(before, after))
    if any(f.measure in named for f in matching):
        return None
    said = ", ".join(sorted(named)) or "no measure"
    return f'names "{raw}" as {said}, where the angle that states it measures {matching[0].measure}'


def named_chance_of(sheet: WeekSheet) -> float | None:
    """The forecast's chance as the weather cell names it, the one percent a cell prints."""
    return None if sheet.weather is None or sheet.bye else named_chance(sheet.weather)


def figure_violations(sentences: Sequence[str], sheet: WeekSheet, stated: Stated) -> list[str]:
    """Each figure only an angle prints, quoted as another measure, a share as a count or a count as a share."""
    out = []
    for s in sentences:
        for raw, value, before, after in stated(s, sheet.season):
            why = _figure_violation(raw, page_tenth(value), before, after, sheet)
            if why is not None:
                out.append(_violation(why, s, _SAY_ITS_MEASURE))
    return out


def _stated_places(sheet: WeekSheet) -> tuple[set[str], set[str]]:
    words = {w.lower().removeprefix("the ") for a in sheet.angles for w, _ in a.places}
    groups = {g.lower() for a in sheet.angles for _, g in a.places}
    return words, groups


def _remedy(sheet: WeekSheet) -> str:
    said = [f"{w} {g}" for a in sheet.angles for w, g in a.places]
    if not said:
        return "The facts place him among no peers: say nothing of where he ranks among them."
    return "Say his place among his peers only as his angles do: " + "; ".join(f'"{p}"' for p in said) + "."


def place_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """Each place among his peers no angle on the sheet states, in its words and its group."""
    words, groups = _stated_places(sheet)
    out = []
    for s in sentences:
        bad = [
            m.group(0) for m in _PLACE.finditer(s) if _PEERS.search(s[m.end() :]) and m.group(1).lower() not in words
        ]
        bad += [m.group(0) for m in _ORDINAL_AMONG.finditer(s)]
        bad += [
            m.group(0) for m in _AMONG_RANKED.finditer(s) if f"among the {m.group(1).lower()} we rank" not in groups
        ]
        if bad:
            quoted = ", ".join(f'"{b}"' for b in dict.fromkeys(bad))
            out.append(_violation(f"places him among his peers as no angle does ({quoted})", s, _remedy(sheet)))
    return out
