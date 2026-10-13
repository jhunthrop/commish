"""THE PAGE FINDINGS OF EVERY WRITTEN CAPSULE, judged as the run's player page will print it.

`capsules.pull_figures.capsule_findings` for each page the writer wrote: at least one of the page's
numbers printed word for word and equal at the precision printed, and no voice-rule hit, with the
sheet's own name ledger masked (so "Price" in Jadarian Price and "Vegas" in a club's name are names,
not words). The page's numbers are the PPR board row the writer read (`capsules.facts.board`, the
same values the run's `ppr-12` row prints) with the run's ADP (the page format's named source at the
run's cutoff), so a capsule is held to the page a drafter sees.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection

from research.capsules.facts.board import board_rows
from research.capsules.facts.collect import PRODUCT_SEASON
from research.capsules.pull_figures import PageValues, adp_figures_off_page, capsule_findings, page_numbers
from research.capsules.store import stored_capsules_for
from research.capsules.sweep import subjects_of
from research.model.reads.teams import first_kickoff_for
from research.nightly.config import PAGE_FORMAT
from research.nightly.reads.adp import adp_cutoff, latest_capture

WRITTEN_SOURCE = "llm"


@dataclass(frozen=True, slots=True)
class PageFindings:
    # Universe id (the capsule's key) to the reasons its page fails, for pages that fail.
    by_page: Mapping[str, tuple[str, ...]]

    @property
    def reasons(self) -> list[str]:
        return [reason for reasons in self.by_page.values() for reason in reasons]


def page_findings(conn: Connection, as_of: datetime) -> PageFindings:
    adp = latest_capture(conn, PAGE_FORMAT.adp, adp_cutoff(as_of, first_kickoff_for(conn, PRODUCT_SEASON))).by_player
    rows = {row.player_id: row for row in board_rows(conn, PRODUCT_SEASON, as_of)}
    subjects = subjects_of(conn, as_of)
    stored = stored_capsules_for(conn, [s.universe_id for s in subjects])
    found: dict[str, tuple[str, ...]] = {}
    for subject in subjects:
        capsule = stored.get(subject.universe_id)
        row = rows.get(subject.facts.identity.id)
        if capsule is None or capsule.source != WRITTEN_SOURCE or row is None:
            continue
        values = PageValues(
            row.projected_points, row.ceiling_points, row.floor_points, row.median_points,
            row.value_over_replacement, row.drop_to_next_tier, adp.get(row.player_id),
        )  # fmt: skip
        reasons = capsule_findings(
            row.player_id, (capsule.body_compact, capsule.body_full), page_numbers(values), subject.facts.name_ledger
        )
        page_adp = adp.get(row.player_id)
        reasons += [
            f"adp_figure_off_page:{row.player_id}:{claim}"
            for body in (capsule.body_compact, capsule.body_full)
            for claim in adp_figures_off_page(body, page_adp)
        ]
        if reasons:
            found[subject.universe_id] = tuple(reasons)
    return PageFindings(found)
