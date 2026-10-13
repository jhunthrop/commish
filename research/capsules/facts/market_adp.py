"""THE ADP AND THE BOARD RANKS A CAPSULE IS WRITTEN WITH: the run's own, as the player page prints them.

Phase D (fix round 1, the review's H2). The oracle's sheet carried the stats provider's ADP
(`provider_players.adp`), while the player page prints the run's named source (Fantasy Football
Calculator's PPR captures, `nightly/reads/adp.py`), so 476 of 489 ADP and pick figures in the
regenerated prose disagreed with the page. The sheet now carries the run's ADP as its only ADP and no
positional ADP (the provider's is the other source), so every ADP a read can quote is the page's.

Fix round 2 (the review's N1) does the same for the board ranks: the oracle's sheet ranked its own
board (`facts.board`, its population and its order) and the scarcity reason's position rank, while
the page prints the run's `ppr-12` board (`nightly/reads/board.py`), so 47 board ranks in the prose
disagreed with the page. The sheet now carries the page's overall and position rank.

Both are deliberate divergences from the oracle's facts: the parity cases build the sheet with the
oracle's ADP and ranks (`MarketAdp.ORACLE`), and the facts are otherwise the oracle's, field for field.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import ClassVar

from sqlalchemy import Connection

from research.model.reads.teams import first_kickoff_for
from research.nightly.config import PAGE_FORMAT
from research.nightly.reads.adp import adp_cutoff, latest_capture
from research.nightly.reads.board import format_board
from research.season import PRODUCT_SEASON


@dataclass(frozen=True, slots=True)
class PageRanks:
    overall: int
    position: int


@dataclass(frozen=True, slots=True)
class MarketAdp:
    """The ADP and ranks the sheets carry: the run's, by the product's player id, or the oracle's."""

    by_player: Mapping[str, float] | None
    ranks: Mapping[str, PageRanks] | None = None
    ORACLE: ClassVar["MarketAdp"]

    def page_ranks(self, player_id: str) -> PageRanks | None:
        """His ranks on the page, or None for the oracle's sheet (or a player the run's board lacks)."""
        return None if self.ranks is None else self.ranks.get(player_id)

    def adp(self, player_id: str, oracle_adp: float | None) -> float | None:
        return oracle_adp if self.by_player is None else self.by_player.get(player_id)

    def position_adp(self, oracle_position_adp: str | None) -> str | None:
        return oracle_position_adp if self.by_player is None else None


MarketAdp.ORACLE = MarketAdp(None)


def run_market_adp(conn: Connection, as_of: datetime) -> MarketAdp:
    """The page format's ADP at the run's cutoff (before the first kickoff, now; after it, the kickoff),
    and each player's overall and position rank on the page format's board at `as_of`."""
    cutoff = adp_cutoff(as_of, first_kickoff_for(conn, PRODUCT_SEASON))
    board = format_board(conn, PRODUCT_SEASON, PAGE_FORMAT, as_of)
    ranks = {} if board is None else {e.row.player_id: PageRanks(e.our_rank, e.position_rank) for e in board.entries}
    return MarketAdp(dict(latest_capture(conn, PAGE_FORMAT.adp, cutoff).by_player), ranks)
