"""THE BOARD RANKS A READ MAY STATE: the page's own, and no other.

Phase D (fix round 2, the review's N1, the same class as the ADP fix in `pull_figures`). The player
page prints his position rank and his overall rank on the run's `ppr-12` board. The sheet the writer
reads now carries exactly those (`facts.market_adp.RunMarket`), and a read that states a board rank
other than the page's is a validator violation and a page finding, so a stray is rewritten.

A BOARD RANK CLAIM is his own position code and a number ("RB101", "QB4") in a sentence that speaks
of our board ("our board", "our number", "we have him", "puts him at", ...), unless the code is a
season finish or a usage rank the sheet states with its own basis (followed by "among", "finish",
"season", "in", "last", "two seasons ago"), or a roster slot ("your QB1", "a usable RB3"). An overall
claim is "rank 422 overall" or "overall rank 12", wherever it sits ("136th overall" is an NFL draft
slot, never the board).
"""

import re
from typing import Final

_SENTENCE: Final = re.compile(r"(?<=[.!?])\s+")
_BOARD_TALK: Final = re.compile(
    r"\b(?:our (?:own )?board|our number|our projection|our rank(?:ing)?s?|we have him|we rank|we'd rank|"
    r"we would rank|puts him at|has him at|for us|on the board|our \d+(?:\.\d+)? points)\b",
    re.IGNORECASE,
)
_NOT_BOARD_AFTER: Final = re.compile(
    r"^\s*(?:among|finish|season|in\b|last\b|usage|points?\b|(?:\w+ )?(?:seasons?|years?) ago)", re.IGNORECASE
)
_SLOT_BEFORE: Final = re.compile(
    r"(?:\byour|\ba|\ban|locked-in|true|weekly|usable|solid|reliable|startable|instead of)\s+$", re.IGNORECASE
)
_OVERALL: Final = re.compile(
    r"\b(?:rank(?:ed)?|No\.)\s+(\d+)\s+overall\b|\boverall rank (?:of )?(\d+)\b",
    re.IGNORECASE,
)


def _position_claims(sentence: str, position: str, position_rank: int | None) -> list[str]:
    off = []
    for match in re.finditer(rf"\b{re.escape(position)}(\d{{1,3}})\b", sentence):
        if _NOT_BOARD_AFTER.match(sentence[match.end() :]) or _SLOT_BEFORE.search(sentence[: match.start()]):
            continue
        if position_rank is None or int(match.group(1)) != position_rank:
            off.append(match.group(0))
    return off


def rank_claims_off_page(prose: str, position: str, position_rank: int | None, overall_rank: int | None) -> list[str]:
    """Every board rank `prose` states that is not the page's (every one, when the page has none)."""
    off = []
    for sentence in _SENTENCE.split(prose):
        if _BOARD_TALK.search(sentence):
            off += _position_claims(sentence, position, position_rank)
        for match in _OVERALL.finditer(sentence):
            number = next(group for group in match.groups() if group is not None)
            if overall_rank is None or int(number) != overall_rank:
                off.append(match.group(0))
    return off
