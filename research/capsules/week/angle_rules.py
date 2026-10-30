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
# Measures the store does not hold (the final review's M3): no route counts are stored, so a figure is never
# said as a share of his routes.
_UNHELD: Final = re.compile(r"\broutes?\b|\broute participation\b", re.IGNORECASE)
# His touchdowns are every touchdown in the red-zone share's games, never his red-zone touchdowns.
_RED_ZONE_TOUCHDOWNS: Final = re.compile(r"\bred[- ]zone\b|\binside the (?:ten|10|twenty|20)\b", re.IGNORECASE)
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
    "Quote a usage fact's figure as its line says it, beside what it measures (\"32% of the Rams' targets\"), never "
    "as another measure, and never a share as a count."
)


def _matching(raw: str, value: float, after: str, sheet: WeekSheet) -> list[AngleFigure] | str | None:
    """The angle figures a stated figure can be (a percent only a share, a count never a share); None when no
    angle's rule applies to it (the weather's chance, a cell's figure), or why it can be none."""
    figures = _figures(sheet)
    if raw.endswith("%") or _PERCENT_AFTER.match(after):
        if value == named_chance_of(sheet):
            return None
        shares = [f for f in figures if f.percent and f.value == value]
        return shares or f'states "{raw}" as a share no usage fact states'
    if value in card_figures(sheet):
        return None
    counts = [f for f in figures if not f.percent and f.value == value]
    if counts:
        return counts
    return f'states "{raw}", a usage fact\'s share, as a count' if any(f.value == value for f in figures) else None


def _said_as(raw: str, matching: Sequence[AngleFigure], before: str, after: str) -> str | None:
    """Why a figure that can only be `matching` is said as something else, or None."""
    clause = _clause(before, after)
    if _UNHELD.search(clause):
        return f'says "{raw}" of his routes, which the facts do not hold'
    touchdowns = any(f.measure == Measure.TOUCHDOWNS for f in matching)
    # The touchdowns' own clause names the red zone (never a bare "there", the round 5 re-review's L2).
    if touchdowns and _RED_ZONE_TOUCHDOWNS.search(clause):
        return f'says "{raw}" as red-zone touchdowns, where the fact counts every touchdown in those games'
    named = _named(clause)
    measures = {f.measure for f in matching}
    if named & measures or (not named - measures and _named(before + after) & measures):
        return None
    said = ", ".join(sorted(named)) or "no measure"
    return f'names "{raw}" as {said}, where the usage fact that states it measures {matching[0].measure}'


def _figure_violation(raw: str, value: float, before: str, after: str, sheet: WeekSheet) -> str | None:
    """Why one stated figure misnames an angle's figure, or None. Its measure is named in its clause, or, with
    no other measure in its clause, anywhere in its sentence ("61% of the snaps lately, down from 94% before");
    never routes, which the store does not hold, and touchdowns never as red-zone touchdowns (final review M3)."""
    matching = _matching(raw, value, after, sheet)
    if matching is None or isinstance(matching, str):
        return matching
    return _said_as(raw, matching, before, after)


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
