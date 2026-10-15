"""THE NEWEST ROW A READ RETURNED: its largest week and its largest stamp.

A replay's isolation gate compares these with the moment a read was made at and the week it was
bounded by (the weekly round 3 preregistration's G5, "the per-game clause"), so every reader that
feeds a judged number can say what it saw without handing back its rows.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class Newest:
    """The largest (season, week) and, apart from it, the largest `as_of` among a read's rows."""

    season: int
    week: int
    as_of: datetime


def newest_of(rows: Iterable[tuple[int, int, datetime]]) -> Newest | None:
    """From (season, week, as_of) triples; None for a read that returned no row."""
    found = list(rows)
    if not found:
        return None
    season, week = max((season, week) for season, week, _ in found)
    return Newest(season, week, max(as_of for _, _, as_of in found))
