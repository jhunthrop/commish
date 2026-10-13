"""THE ADP A CAPSULE IS WRITTEN WITH: the run's own, the page format's named source at the run's cutoff.

Phase D (fix round 1, the review's H2). The oracle's sheet carried the stats provider's ADP
(`provider_players.adp`), while the player page prints the run's named source (Fantasy Football
Calculator's PPR captures, `nightly/reads/adp.py`), so 476 of 489 ADP and pick figures in the
regenerated prose disagreed with the page. The sheet now carries the run's ADP as its only ADP and no
positional ADP (the provider's is the other source), so every ADP a read can quote is the page's.

This is a deliberate divergence from the oracle's facts: the parity cases build the sheet with the
oracle's ADP (`MarketAdp.ORACLE`), and the facts are otherwise the oracle's, field for field.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import ClassVar

from sqlalchemy import Connection

from research.model.reads.teams import first_kickoff_for
from research.nightly.config import PAGE_FORMAT
from research.nightly.reads.adp import adp_cutoff, latest_capture
from research.season import PRODUCT_SEASON


@dataclass(frozen=True, slots=True)
class MarketAdp:
    """The ADP the sheets carry: the run's, by the product's player id, or None for the oracle's."""

    by_player: Mapping[str, float] | None
    ORACLE: ClassVar["MarketAdp"]

    def adp(self, player_id: str, oracle_adp: float | None) -> float | None:
        return oracle_adp if self.by_player is None else self.by_player.get(player_id)

    def position_adp(self, oracle_position_adp: str | None) -> str | None:
        return oracle_position_adp if self.by_player is None else None


MarketAdp.ORACLE = MarketAdp(None)


def run_market_adp(conn: Connection, as_of: datetime) -> MarketAdp:
    """The page format's ADP at the run's cutoff (before the first kickoff, now; after it, the kickoff)."""
    cutoff = adp_cutoff(as_of, first_kickoff_for(conn, PRODUCT_SEASON))
    return MarketAdp(dict(latest_capture(conn, PAGE_FORMAT.adp, cutoff).by_player))
