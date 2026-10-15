"""THE PULL FIGURES AND THE CAPSULE GATE the nightly enforces.

Ported from `research-ts/src/nightly/build/pull-figures.ts` and `nightly/gates.ts`
(`capsuleFindings`). A pull figure is one of the page's own numbers (from the page's board row,
never from the prose) that the long read prints word for word, to the tenth or, from ten up, to the
whole point. A written page needs at least one; each must equal the page's value at the precision
printed; neither read may carry a voice-rule or register hit (`voice_rules.gate_hits`, a doubled word
included) or a time frame slip for the run's day (`season_voice`).
"""

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from research.capsules.prose_checks import unfinished_ending
from research.capsules.season_voice import SeasonClock, names_missed_weeks, time_frame_hits
from research.capsules.voice_rules import gate_hits
from research.model.jsmath import js_round, js_to_fixed
from research.pipeline.jscompat import js_number, js_string

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

PULL_FIGURES_PER_CAPSULE: Final = 3
_WHOLE_NUMBER_FLOOR: Final = 10
_SENTENCES: Final = re.compile(r"(?<=[.!?])\s+")

PageNumber = tuple[str, float]


@dataclass(frozen=True, slots=True)
class PullFigure:
    text: str
    label: str
    value: float
    sentence: str


@dataclass(frozen=True, slots=True)
class PageValues:
    """The page's own numbers, from its board row (None where the row has none)."""

    projected: float | None
    ceiling: float | None
    floor: float | None
    median: float | None
    value_over_replacement: float | None = None
    drop_to_next_tier: float | None = None
    adp: float | None = None


def page_numbers(row: PageValues) -> tuple[PageNumber, ...]:
    """`pageNumbersOf`: the numbers the page prints, in the order it leads with them."""
    candidates = (
        ("projected points", row.projected),
        ("ceiling", row.ceiling),
        ("floor", row.floor),
        ("median", row.median),
        ("points over replacement", row.value_over_replacement),
        ("drop to the next tier", row.drop_to_next_tier),
        ("ADP", row.adp),
    )
    return tuple((label, value) for label, value in candidates if value is not None and math.isfinite(value))


def facts_page_numbers(facts: "PlayerFacts") -> tuple[PageNumber, ...]:
    """The page numbers a sheet carries itself and the page prints the same (the projection and its
    band): the writer is held to these, so a read it passes passes the gate. Not the ADP: the sheet's
    is the stats provider's, the page's is the run's named source (`nightly/reads/adp.py`), so a read
    whose only page number was its ADP printed a number the page does not show (phase D, measured on
    the 2026-10-13 regeneration: 9 written pages)."""
    p = facts.projection
    return page_numbers(PageValues(p.projected_points, p.ceiling_points, p.floor_points, p.median_points))


def renderings_of(value: float) -> list[str]:
    """How a page number may be printed: to the tenth, and from ten up to the whole point."""
    tenth = js_to_fixed(value, 1)
    return [tenth, js_string(js_round(value))] if abs(value) >= _WHOLE_NUMBER_FLOOR else [tenth]


def _prints(sentence: str, text: str) -> bool:
    return re.search(rf"(?<![\d.,]){re.escape(text)}(?![\d]|[.,]\d)", sentence) is not None


def pull_figures_of(
    prose: str, numbers: Sequence[PageNumber], count: int = PULL_FIGURES_PER_CAPSULE
) -> list[PullFigure]:
    """`pullFiguresOf`: the page's numbers the prose prints, one figure per printed number."""
    sentences = [s.strip() for s in _SENTENCES.split(prose) if s.strip()]
    figures: list[PullFigure] = []
    for label, value in numbers:
        for text in renderings_of(value):
            if any(figure.text == text for figure in figures):
                continue
            sentence = next((s for s in sentences if _prints(s, text)), None)
            if sentence is None:
                continue
            figures.append(PullFigure(text, label, value, sentence))
            break
        if len(figures) == count:
            break
    return figures


def figure_matches_value(figure: PullFigure) -> bool:
    """`figureMatchesValue`: the text is the value at the precision it prints."""
    decimals = len(figure.text.split(".")[1]) if "." in figure.text else 0
    return js_number(figure.text) == js_number(js_to_fixed(figure.value, decimals))


def capsule_findings(
    player_id: str, bodies: tuple[str, str], numbers: Sequence[PageNumber], names: Sequence[str], clock: SeasonClock
) -> list[str]:
    """`capsuleFindings` for a page the writer covers: the reasons the nightly would fail it for.
    `bodies` is (compact, full); `names` are the page's proper names, never read as banned words;
    `clock` is the run's day, which the prose's time frame is held to (`season_voice`)."""
    body_compact, body_full = bodies
    figures = pull_figures_of(body_full, numbers)
    findings = [] if figures else [f"pull_figures_none:{player_id}"]
    findings += [f"pull_figure_not_in_prose:{player_id}:{f.text}" for f in figures if f.text not in body_full]
    findings += [f"pull_figure_off_page:{player_id}:{f.label}:{f.text}" for f in figures if not figure_matches_value(f)]
    found = dict.fromkeys(hit.found for hit in (*gate_hits(body_full, names), *gate_hits(body_compact, names)))
    findings += [f"capsule_voice_rule:{player_id}:{text}" for text in found]
    slips = dict.fromkeys(f"{hit.rule}:{hit.found}" for body in bodies for hit in time_frame_hits(body, clock))
    findings += [f"capsule_time_frame:{player_id}:{slip}" for slip in slips]
    findings += [
        f"capsule_unfinished:{player_id}:{size}"
        for size, body in (("compact", body_compact), ("full", body_full))
        if unfinished_ending(body) is not None
    ]
    return findings + ([] if names_missed_weeks(body_full, clock) else [f"capsule_missed_weeks_unnamed:{player_id}"])


# AN ADP CLAIM IN THE PROSE: "ADP of 25.7", "ADP 26", "pick 53", "drafted around pick 36". The number
# follows the word directly or through a filler; a movement ("slid 11.4 picks from 87.4") or a dated
# figure is not a claim of where he goes now. A pick in the NFL draft ("pick 12 in the 2025 draft") is
# not an ADP and is skipped.
_ADP_CLAIM: Final = re.compile(
    r"\b(?:ADP|pick)(?:\s+(?:of|is|at|around|near|about|sits at|No\.))*\s+(\d+(?:\.\d+)?)(?![\d]|[.,]\d)"
    # The figure before the word too (Lane 29, Justin Jefferson's "The 8.8 ADP drafters actually paid").
    r"|(?<![\d.])(\d+(?:\.\d+)?)\s+ADP\b",
    re.IGNORECASE,
)
_NFL_DRAFT_AFTER: Final = re.compile(r"^[^.]{0,40}\bdraft\b", re.IGNORECASE)


def adp_figures_off_page(prose: str, adp: float | None) -> list[str]:
    """Every ADP claim in `prose` that is not the page's ADP as the page prints it (to the tenth, or the
    whole pick from ten up); every claim when the page has no ADP."""
    allowed = set() if adp is None else set(renderings_of(adp))
    off = []
    for match in _ADP_CLAIM.finditer(prose):
        if _NFL_DRAFT_AFTER.match(prose[match.end() :]):
            continue
        if (match.group(1) or match.group(2)) not in allowed:
            off.append(match.group(0))
    return off
