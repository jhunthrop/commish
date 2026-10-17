"""THE WEEK READ'S VALIDATOR: the writer's rules against the week's sheet, the week's own on top, and no
sentence another page carries this week.

The writer's rules are the season read's (`capsules.validate.validate_prose`): every number and name
traces to the sheet, the copy rules, the betting, trading, lab-report and all-time words, the time frame
(every week with its season, a week ahead never told as past, no month, no draft voice in season), the
claims, the shares' bases, the multiples, and any rank on our board his own. The week's (`rules`) follow.
Lane 62's rule binds as the read is written: a sentence of four words or more on another page's read this
week is refused here, and one that still lands on two pages is demoted after the night (`shared`).
"""

from collections.abc import Set
from typing import Final

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.narrative import normalize_sentence, sentences_verbatim
from research.capsules.validate import Grounding, ValidationResult, validate_prose
from research.capsules.week.rules import week_rule_violations
from research.capsules.week.sheet import WeekSheet, render_week_sheet, week_name_ledger

# The read's words: three to five sentences, written short.
WEEK_BAND: Final = (40, 120)
SHARED_SENTENCE: Final = "The text carries a sentence another page carries this week"


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
    )


def shared_sentence_violations(text: str, taken: Set[str]) -> list[str]:
    """Each sentence of `text` (four words or more, normalized) that another page's read carries."""
    out = []
    for sentence in sentences_verbatim(text):
        held = normalize_sentence(sentence)
        if len(held.split()) >= CAPSULE_CONFIG.shared_sentence_min_words and held in taken:
            out.append(f'{SHARED_SENTENCE}, in the sentence "{sentence}". Say it in words of this player\'s own.')
    return out


def validate_week_read(text: str, sheet: WeekSheet, taken: Set[str] = frozenset()) -> ValidationResult:
    """One week read against its sheet, the week's rules and the sentences other pages carry (`taken`)."""
    base = validate_prose(text, week_grounding(sheet), WEEK_BAND)
    violations = (*base.violations, *week_rule_violations(text, sheet), *shared_sentence_violations(text, taken))
    return ValidationResult(not violations, violations, base.band_failure)
