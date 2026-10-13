"""EACH FORMAT'S ADP, READ FROM ITS NEWEST STAMPED CAPTURE (`adp_snapshots`), WITH ITS WINDOW.

The newest capture is tonight's (the nightly's ingest step takes it before the run is built), as the
oracle's nightly reads it (`research-ts/src/nightly/reads/adp.ts`). The window is that capture's own
stamp. The register keeps its own ADP, the one frozen beside each week's board before kickoff.

ADP is keyed by the product's player id through the crosswalk; a captured player the crosswalk
cannot place is on no page, so he is counted and left out.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection, text

from research.nightly.config import AdpFeed


@dataclass(frozen=True, slots=True)
class AdpCapture:
    feed: AdpFeed
    captured_at: datetime | None
    by_player: dict[str, float]  # the product's player id to ADP
    unplaced: int


def latest_capture(conn: Connection, feed: AdpFeed, as_of: datetime) -> AdpCapture:
    """The feed's newest capture at or before `as_of`, or an empty one when it has none."""
    captured_at = conn.execute(
        text("select max(captured_at) from research.adp_snapshots where source = :source and captured_at <= :a"),
        {"source": feed.source, "a": as_of},
    ).scalar()
    if captured_at is None:
        return AdpCapture(feed, None, {}, 0)
    rows = list(
        conn.execute(
            text(
                "select a.player_id, a.adp, c.provider_player_id from research.adp_snapshots a "
                "left join research.player_crosswalk c on c.player_id = a.player_id "
                "where a.source = :source and a.captured_at = :at order by a.adp, a.player_id"
            ),
            {"source": feed.source, "at": captured_at},
        )
    )
    placed = {row.provider_player_id: float(row.adp) for row in rows if row.provider_player_id is not None}
    return AdpCapture(feed, captured_at, placed, len(rows) - len(placed))
