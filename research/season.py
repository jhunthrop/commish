"""THE PRODUCT SEASON: the one place the season the site serves is named.

The rule: the product season is the season the board drafts for. It stays 2026 through the 2026
season and its record (launch 2027 on the 2026 held-out year), and moves to 2027 in the same commit
that first ingests the 2027 preseason (the week-one rosters and the published boards, `python -m
research.pipeline preseason --first 2027 --last 2027`), which is also when the 2027 board is taken.
Every module that needs it reads it from here: the nightly run, the fit step, the capsules, the
preseason ingests, the stats provider's season and the weekly pass.
"""

from typing import Final

PRODUCT_SEASON: Final = 2026
# Weeks of the NFL regular season, 2021 on.
REGULAR_SEASON_WEEKS: Final = 18
