"""THE INPUTS OF EVERY COMPONENT TREE (preregistration section 2.3), AS ONE CONSTANT, AND THE COMPONENTS.

`FEATURE_INPUTS` is round 4's player and game feature row: every numeric column of `GAME_COLUMNS` and
`PLAYER_COLUMNS` and every `default_<name>` indicator of `GAME_DEFAULTS` and `PLAYER_DEFAULTS`, with `roof`
the one categorical input (`matrix.VOCABULARY`), less the excluded columns 2.3 names. It is printed in the
development check's record. Beside it every tree reads the team model's eight expected volumes for his
club (`VOLUME_INPUTS`), his season anchor of the component it predicts and the rate m in PPR
(`anchor_inputs`), and every shrunk rate his position carries (`shrinkage.rate_inputs`).
"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from research.model.weekly4.features.columns import (
    GAME_COLUMNS,
    GAME_DEFAULTS,
    PLAYER_COLUMNS,
    PLAYER_DEFAULTS,
    default_column,
)
from research.model.weekly4.team_model import TEAM_TARGETS

FROZEN: Final = MappingProxyType
# 2.3: "the identifiers and text columns `player_id`, `position`, `status`, `figure_source` and `surface`;
# the bookkeeping columns `withheld`, `depth_chart_week` and `depth_rank_mapped`; and
# `precipitation_probability`, which is live only".
EXCLUDED: Final = frozenset(
    {
        "player_id",
        "position",
        "status",
        "figure_source",
        "surface",
        "withheld",
        "depth_chart_week",
        "depth_rank_mapped",
        "precipitation_probability",
    }
)
CATEGORICAL: Final = frozenset({"roof"})
FEATURE_INPUTS: Final = tuple(
    name
    for name, kind in (*GAME_COLUMNS, *PLAYER_COLUMNS)
    if name not in EXCLUDED and (kind != "str" or name in CATEGORICAL)
) + tuple(default_column(d) for d in (*GAME_DEFAULTS, *PLAYER_DEFAULTS))
VOLUME_INPUTS: Final = tuple(f"exp_{target}" for target in TEAM_TARGETS)
RATE_M: Final = "rate_m_ppr"  # 2.3: "and the rate m in PPR"

# 2.5's trees per position: the component, its loss.
TREES: Final[Mapping[str, Mapping[str, str]]] = FROZEN(
    {
        "QB": FROZEN({"carries": "poisson"}),
        **{
            p: FROZEN(
                {
                    "targets": "poisson",
                    "receptions": "poisson",
                    "receiving_yards": "squared_error",
                    "carries": "poisson",
                    "rushing_yards": "squared_error",
                }
            )
            for p in ("RB", "WR", "TE")
        },
    }
)
POSITIONS: Final = ("QB", "RB", "WR", "TE")
# The scored components of 2.5, in the order the scorer reads them.
COMPONENTS: Final = (
    "pass_attempts",
    "passing_yards",
    "interceptions",
    "passing_touchdowns",
    "carries",
    "rushing_yards",
    "rushing_touchdowns",
    "targets",
    "receptions",
    "receiving_yards",
    "receiving_touchdowns",
    "fumbles_lost",
)


def anchor_column(component: str) -> str:
    return f"anchor_{component}"


def anchor_inputs(component: str) -> tuple[str, ...]:
    """2.3: his season-to-date rate a game of the component the tree predicts, and the rate m in PPR."""
    return (anchor_column(component), RATE_M)
