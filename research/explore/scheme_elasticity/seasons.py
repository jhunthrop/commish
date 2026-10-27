"""THE PROBE'S SEASON WINDOW: development seasons 2022 and 2023 only, 2021 for last season's form.

Lane 245's brief, hard constraint 1: no 2024, 2025 or 2026 outcome or feature row is read. Every
read in this probe goes through `admit_season` (files and queries alike), and every database
connection carries round 2's `guard_queries` with `CLOSED_SEASONS`, which refuses a statement whose
season bind parameter names a closed season before it runs.
"""

from typing import Final

from research.errors import ResearchError

PROBE_SEASONS: Final = (2022, 2023)
FORM_SEASON: Final = 2021  # recent form falls back to last season's lines (round 4's benchmark)
READABLE_SEASONS: Final = frozenset({FORM_SEASON, *PROBE_SEASONS})
CLOSED_SEASONS: Final = frozenset({2024, 2025, 2026})
JUDGED_WEEKS: Final = tuple(range(6, 18))  # round 4's weeks 6 to 17
LAST_WEEK: Final = 17


class ClosedSeasonReadError(ResearchError):
    """A read of a season outside the probe's window."""


def admit_season(season: int, allowed: frozenset[int] = READABLE_SEASONS) -> int:
    """`season` when the probe may read it; a refusal otherwise (and always for a closed season)."""
    if season in CLOSED_SEASONS or season not in allowed:
        raise ClosedSeasonReadError(f"lane 245 may not read season {season}; refused")
    return season
