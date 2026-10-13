"""WHAT ONE NIGHTLY RUN CARRIES, AND THE LINES ITS GATES HOLD IT TO.

The formats are the site's chooser (`web/src/lib/run/catalog.ts`, `CHOOSER_FORMATS` at the default
twelve teams), so every chip the board offers is a format the run carries. Each is a stored scoring
board read under a roster shape: superflex is the PPR board's points valued for a league that can
start a second quarterback, as the oracle's board service reads any shape (`board/service.ts`).
"""

from dataclasses import dataclass
from datetime import timedelta
from typing import Final

from research.model.domain import STANDARD_ROSTER_SLOTS, RosterSlotConfig
from research.model.domain import SUPERFLEX_ROSTER_SLOTS as SUPERFLEX_SLOTS

PRODUCT_SEASON: Final = 2026
TEAMS: Final = 12
IMPLEMENTATION: Final = "python"
BOARD_SOURCE_PREFIX: Final = "commish_board_v9"


@dataclass(frozen=True, slots=True)
class AdpFeed:
    """One stored ADP capture series (`adp_snapshots.source`), with its vendor named for provenance."""

    source: str
    vendor: str
    # In a drafter's words, as the ADP page prints the source.
    drafts: str


@dataclass(frozen=True, slots=True)
class RunFormat:
    """One board the run writes: a stored scoring board under a roster shape at twelve teams."""

    id: str
    label: str
    unit: str
    scoring: str
    scoring_words: str
    slots: tuple[RosterSlotConfig, ...]
    shape_words: str | None
    adp: AdpFeed

    @property
    def board_source(self) -> str:
        return f"{BOARD_SOURCE_PREFIX}_{self.scoring}_{TEAMS}"


_FFC: Final = "Fantasy Football Calculator, 12-team"
PPR_ADP: Final = AdpFeed("ffc_adp_ppr_12", f"{_FFC} PPR ADP", "PPR drafts")
HALF_ADP: Final = AdpFeed("ffc_adp_half_12", f"{_FFC} half PPR ADP", "Half PPR drafts")
STANDARD_ADP: Final = AdpFeed("ffc_adp_std_12", f"{_FFC} standard ADP", "Standard drafts")
SUPERFLEX_ADP: Final = AdpFeed("ffc_adp_2qb_12", f"{_FFC} two-quarterback ADP", "Two-quarterback drafts")

RUN_FORMATS: Final = (
    RunFormat("ppr-12", "PPR", "PPR pts", "ppr", "PPR", STANDARD_ROSTER_SLOTS, None, PPR_ADP),
    RunFormat("half-ppr-12", "Half PPR", "Half PPR pts", "half", "Half PPR", STANDARD_ROSTER_SLOTS, None, HALF_ADP),
    RunFormat("standard-12", "Standard", "Standard pts", "std", "Standard scoring", STANDARD_ROSTER_SLOTS, None, STANDARD_ADP),
    RunFormat(
        "superflex-12",
        "Superflex",
        "PPR pts",
        "ppr",
        "PPR",
        SUPERFLEX_SLOTS,
        "valued for a league that can start a second quarterback",
        SUPERFLEX_ADP,
    ),
)  # fmt: skip
# The format a player page and the capsule writer read (`capsules.facts.board`, PPR at twelve teams).
PAGE_FORMAT: Final = RUN_FORMATS[0]

# The positions the board ranks by projection. Kickers and defenses ship in market order (the
# 2026-09-05 ruling, `KDEF_DECISION`), carry no projection, and are not board rows.
PROJECTED_POSITIONS: Final = ("QB", "RB", "WR", "TE")


@dataclass(frozen=True, slots=True)
class Gates:
    # The largest drop in a held-out season's rank correlation against the last run whose backtest
    # passed (`research-ts/src/nightly/config.ts`): a stored held-out board moves only when the fit
    # rewrites it, so anything past rounding is a regression.
    max_held_out_drop: float = 0.005
    # Players a board carries per league-wide starting spot its positions alone can fill.
    depth_players_per_spot: int = 1


GATES: Final = Gates()

RUNS_PREFIX: Final = "runs"
LATEST_KEY: Final = f"{RUNS_PREFIX}/latest.json"
EARLY_KEY: Final = f"{RUNS_PREFIX}/early.json"
HELD_OUT_BASELINE_KEY: Final = f"{RUNS_PREFIX}/held-out-baseline.json"
HEADSHOT_REGISTRY_KEY: Final = "headshots/index.json"
# Spec §4: a member reads a run an hour before the public build.
EARLY_ACCESS: Final = timedelta(hours=1)
