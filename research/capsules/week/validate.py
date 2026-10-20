"""THE WEEK READ'S VALIDATOR: the writer's rules against the week's sheet, the week's own on top, and no
sentence shape another page carries this week.

The writer's rules are the season read's (`capsules.validate.validate_prose`): every number and name
traces to the sheet, the copy rules, the betting, trading, lab-report and all-time words, the time frame
(every week with its season, a week ahead never told as past, no month, no draft voice in season), the
claims, the shares' bases, the multiples, and any rank on our board his own. The coordinator's ruling on
the season: a read names it once, so a bare week after the first season a read names is read as that
season's (`with_season`) before the writer's rules see it. The week's rules follow (`rules`).

Lane 62's rule binds as the read is written, on sentence shapes (the review's M4): a sentence of four
words or more whose shape, with every name and number masked, is on another page's read this week is
refused here (`sentence_shapes`), and one that still lands on two pages is demoted after the night.
"""

import re
from collections.abc import Set
from typing import Final

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.narrative import normalize_sentence, sentences_verbatim
from research.capsules.validate import Grounding, ValidationResult, validate_prose
from research.capsules.week.render import render_week_sheet
from research.capsules.week.rules import week_rule_violations
from research.capsules.week.sheet import WeekSheet, week_name_ledger

# The read's words: one paragraph of three to five short sentences, never more than 80 (Lane 100, B44).
WEEK_BAND: Final = (40, 80)
SHARED_SENTENCE: Final = "The text carries a sentence shaped like one another page carries this week"
_NAME: Final = re.compile(r"\b[A-Z][\w'\u2019.-]*")
_NUMBER: Final = re.compile(r"\d+(?:[.,]\d+)*%?")
_BARE_WEEK: Final = re.compile(
    # A joined number is a week only when it is no figure ("week 5 and 41.4 PPR points" joins nothing).
    r"\bweeks?\s+\d{1,2}(?:\s*(?:,|and|or|to|through|-)\s*\d{1,2}(?![\d.]))*\b(?![.]\d)"
    r"(?!\s*(?:of|in|,)\s*(?:19|20)\d\d)",
    re.IGNORECASE,
)


def sentence_shape(sentence: str) -> str:
    """A sentence with every name (a capitalised word) and every number masked, normalized."""
    return normalize_sentence(_NUMBER.sub("#", _NAME.sub("X", sentence)))


def sentence_shapes(text: str) -> dict[str, str]:
    """Each held sentence's shape (four words or more) to the sentence as written."""
    out: dict[str, str] = {}
    for sentence in sentences_verbatim(text):
        shape = sentence_shape(sentence)
        if len(shape.split()) >= CAPSULE_CONFIG.shared_sentence_min_words:
            out.setdefault(shape, sentence)
    return out


def with_season(text: str, season: int) -> str:
    """`text` with every bare week after its first naming of the season read as that season's."""
    first = re.search(rf"\b{season}\b", text)
    if first is None:
        return text
    head, tail = text[: first.end()], text[first.end() :]
    return head + _BARE_WEEK.sub(lambda m: f"{m.group(0)} of {season}", tail)


def week_grounding(sheet: WeekSheet) -> Grounding:
    """What a week read is graded against: the sheet's numbers and names, and his own ranks and rate."""
    board = sheet.board
    changes = tuple(c for c in (sheet.projection_change, sheet.change_since_last_read) if c is not None)
    return Grounding(
        number_ledger=changes,
        name_ledger=week_name_ledger(sheet),
        prompt_text=render_week_sheet(sheet),
        tension=None,
        page_numbers=(),
        adp=None,
        position=sheet.position,
        position_rank=None if board is None else board.position_rank,
        board_rank=None if board is None else board.rank,
        clock=sheet.clock,
        touchdowns=sheet.touchdowns,
        own_points_per_game=sheet.points_per_game,
        exact_figures=True,
    )


def shared_sentence_violations(text: str, taken: Set[str]) -> list[str]:
    """Each sentence of `text` whose shape another page's read carries (`taken`, shapes)."""
    return [
        f'{SHARED_SENTENCE}, in the sentence "{sentence}". Say it in words of this player\'s own.'
        for shape, sentence in sentence_shapes(text).items()
        if shape in taken
    ]


def validate_week_read(
    text: str,
    sheet: WeekSheet,
    taken: Set[str] = frozenset(),
    call: str | None = "none",
) -> ValidationResult:
    """One week read against its sheet, the week's rules given the writer's `call`, and the sentence shapes
    other pages carry (`taken`). The cap is the cap (Lane 100, B44): no overrun for a read asked shorter."""
    base = validate_prose(with_season(text, sheet.season), week_grounding(sheet), WEEK_BAND)
    violations = (
        *base.violations,
        *week_rule_violations(text, sheet, call),
        *shared_sentence_violations(text, taken),
    )
    return ValidationResult(not violations, violations, base.band_failure)
