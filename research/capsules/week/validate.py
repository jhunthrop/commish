"""THE WEEK READ'S VALIDATOR: the writer's rules against the week's sheet, the week's own on top, and no
sentence shape another page carries this week.

The writer's rules are the season read's (`capsules.validate.validate_prose`): every number and name
traces to the sheet, the copy rules, the betting, trading, lab-report and all-time words, the time frame
(every week with its season, a week ahead never told as past, no month, no draft voice in season), the
claims, the shares' bases, the multiples, and any rank on our board his own. The coordinator's ruling on
the season: a read names it once, so a bare week after the first season a read names is read as that
season's (`with_season`) before the writer's rules see it. The week's rules follow (`rules`).

Lane 62's rule binds as the read is written, on sentence shapes (the review's M4; Lane 265 on Lane 261's
bake-off normalization): a sentence is held by two shapes (`narrative.held_shapes`), its placeholder shape
(every player name, full or last, with or without his suffix, every club spelling, a plural's possessive among
them, and every number a placeholder, `narrative.ShapeMasks`, six words or more) and main's word shape (every capitalised word and
number masked, four words or more), so the check is never weaker than the one before it. A sentence either
shape puts on another page's read this week is refused here (`sentence_shapes`), the correction ask showing
the shape; one that still lands on two pages is demoted after the night. A read is masked with the names
its own sheet may print; the week's stored reads with every board player's (`week_masks`), so a read whose
player has no sheet tonight is still masked by name (the Lane 265 review's M1).
"""

import re
from collections.abc import Iterable, Set
from typing import Final

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.narrative import ShapeMasks, held_shapes, shown_shape
from research.capsules.validate import Grounding, ValidationResult, validate_prose
from research.capsules.week.render import render_week_sheet
from research.capsules.week.rules import week_rule_violations
from research.capsules.week.sheet import WeekSheet, sheet_names, week_name_ledger

# The read's words: one paragraph of three to five short sentences, never more than 95 (Lane 100, B44, set at
# 80; Lane 117 fix round 3, the coordinator's ruling: the writer's natural read on production sheets runs about
# 85 words, so the cap is 95 while the prompt still asks for about 60).
WEEK_BAND: Final = (40, 95)
SHARED_SENTENCE: Final = "The text carries a sentence shaped like one another page carries this week"
_BARE_WEEK: Final = re.compile(
    # A joined number is a week only when it is no figure ("week 5 and 41.4 PPR points" joins nothing); a range's
    # last week may end a sentence ("weeks 3-5.", Lane 303 review H3, as `season_words._WEEK` reads it).
    r"\bweeks?\s+\d{1,2}(?:\s*(?:,|and|or|to|through|-)\s*\d{1,2}(?!\d|\.\d))*\b(?!\.\d)"
    r"(?!\s*(?:of|in|,)\s*(?:19|20)\d\d)",
    re.IGNORECASE,
)


def week_masks(sheets: Iterable[WeekSheet], players: Iterable[str] = ()) -> ShapeMasks:
    """The names a week's shapes mask: `players` (every board player's, for the week's stored reads), each
    sheet's player and the teammates it names, and every club."""
    return ShapeMasks.of((*players, *(name for sheet in sheets for name in sheet_names(sheet))))


def sentence_shapes(text: str, masks: ShapeMasks) -> dict[str, str]:
    """Each held sentence's shapes (`narrative.held_shapes`) to the sentence as written."""
    return held_shapes(
        (text,),
        masks,
        name_words=CAPSULE_CONFIG.shared_shape_min_words,
        word_words=CAPSULE_CONFIG.shared_sentence_min_words,
    )


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
        # The decided call's place is never quoted (Lane 302 fix round 2, the review's L4): it stays out of the
        # grounding, so a read that states it is refused as a figure the sheet does not carry.
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


def shared_sentence_violations(text: str, taken: Set[str], masks: ShapeMasks) -> list[str]:
    """Each sentence of `text` whose shape another page's read carries (`taken`, shapes), the shape shown."""
    return [
        f'{SHARED_SENTENCE}, in the sentence "{sentence}", whose shape "{shown_shape(shape)}" is on another '
        "page. Say it in words of this player's own, not the same sentence with his name and numbers in it."
        for shape, sentence in sentence_shapes(text, masks).items()
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
        *shared_sentence_violations(text, taken, week_masks((sheet,))),
    )
    return ValidationResult(not violations, violations, base.band_failure)
