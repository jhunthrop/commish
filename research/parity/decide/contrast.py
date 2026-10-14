"""THE CONTRAST WHYS, judged on every recorded room state the advisor answers.

The oracle has no contrast why (it is the port's own addition, `research.advisor.contrast`), so
nothing is compared against it. Instead each card is held to the rules the coordinator set: the
call carries none and every row after it one; no two rows of a card share a sentence or a frame
with only the numbers swapped; no row repeats a number its row prints (his position rank, his
chance of lasting); and every sentence passes the capsules' voice rules, with no em-dash and no
semicolon.
"""

import re
from collections.abc import Mapping, Sequence
from typing import Any, Final

from research.capsules.voice_rules import EM_DASH, SEMICOLON, voice_rule_hits
from research.parity.model.outcome import Claim

_NUMBER: Final = re.compile(r"\d+(?:\.\d+)?")
_PERCENT: Final = re.compile(r"\d+%")
_RANK: Final = re.compile(r"No\. \d+")


def _frame(text: str) -> str:
    """A sentence with its numbers taken out: what two rows must not share."""
    return _NUMBER.sub("#", text)


def contrast_claims(cards: Sequence[Mapping[str, Any]]) -> list[Claim]:
    rows = [(card, candidate) for card in cards for candidate in card["shortlist"][1:]]
    calls_bare = all(card["shortlist"][0].get("contrast") is None for card in cards)
    every_row = all(isinstance(candidate.get("contrast"), str) and candidate["contrast"] for _, candidate in rows)
    texts = [str(candidate.get("contrast") or "") for _, candidate in rows]
    shared = sum(
        1
        for card in cards
        if len({_frame(str(c.get("contrast"))) for c in card["shortlist"][1:]}) != len(card["shortlist"][1:])
    )
    voiced = [text for text in texts if voice_rule_hits(text, []) or EM_DASH in text or SEMICOLON in text]
    repeats = [text for text in texts if _PERCENT.search(text) or _RANK.search(text)]
    return [
        Claim(f"the call carries no contrast on all {len(cards)} cards", calls_bare),
        Claim(f"all {len(rows)} rows after the call carry a contrast why", every_row),
        Claim(f"no card has two rows sharing a frame ({shared} do)", shared == 0),
        Claim(f"no contrast breaks a voice rule ({len(voiced)} do)", not voiced),
        Claim(f"no contrast repeats a rank or a chance its row prints ({len(repeats)} do)", not repeats),
    ]
