"""WHICH MODEL MADE EACH LEGACY BOARD, AND IN WHAT ARITHMETIC: the facts the legacy rows never
recorded, established by rebuilding them.

A model version names the tree whose code and committed fits produced a board: `research-ts@<sha>`
for the TypeScript (main's last commit before the board was taken), `research@<sha>` for this lane.
An arithmetic names the floating point the board was computed in (`research.model.arithmetic`).

Only boards the store still holds, or the register still quotes, are listed, and each says how it
is known. A legacy board not listed keeps a NULL model version: the legacy writer recorded none and
nothing here rebuilt it, and a guess would be a fact nobody established.
"""

from dataclasses import dataclass
from typing import Final

ARM64_FUSED: Final = "v8-fdlibm-fused/pow-apple-libm"


@dataclass(frozen=True, slots=True)
class LegacyBoardModel:
    season: int
    source: str
    as_of: str
    model_version: str
    arithmetic: str | None
    evidence: str


_WEEK_TWO_EVIDENCE: Final = (
    "rebuilt bit for bit by the tree at 7af71283 run unmodified on the store as it stood "
    "(parity case board-2026-week2), and by today's oracle and the port"
)

LEGACY_BOARD_MODELS: Final = (
    *(
        LegacyBoardModel(
            2026, source, "2026-09-09T02:20:29.697Z", "research-ts@7af71283", ARM64_FUSED, _WEEK_TWO_EVIDENCE
        )
        for source in (
            "commish_board_v9_ppr_12",
            "commish_board_v9_half_12",
            "commish_board_v9_std_12",
            "commish_board_v1_ppr_12",
        )
    ),
    LegacyBoardModel(
        2026,
        "commish_board_v9_ppr_12",
        "2026-09-07T21:57:33.121Z",
        "research-ts@800aef34",
        ARM64_FUSED,
        "rebuilt (points, rank, value rank) by the tree at 800aef34 run unmodified on the store as it stood, "
        "with the one universe fact rewritten since restated (parity case board-2026-week1); retired from the store, "
        "quoted only by the register's week-1 rows",
    ),
    LegacyBoardModel(
        2026,
        "commish_board_v7_ppr_12",
        "2026-09-02T03:20:39.210Z",
        "research-ts@6603c2ac",
        None,
        "main's last commit before the board was taken; not rebuilt (v7 is the register's shadow, which no tree after it reproduces)",
    ),
    # The 2024 replay boards the register's held-out grade (parity case register-grade-2024-week2)
    # freezes. The store lost their inputs (2024 preseason rosters), so neither can be rebuilt; the
    # model is main's last commit before each row's `computed_at`.
    LegacyBoardModel(
        2024,
        "commish_board_v9_ppr_12",
        "2024-09-06T23:59:59.999Z",
        "research-ts@5240ed99",
        None,
        "main's last commit before computed_at 2026-09-02T17:56:09Z; not rebuildable (the store lost the 2024 preseason rosters)",
    ),
    LegacyBoardModel(
        2024,
        "commish_board_v7_ppr_12",
        "2024-09-06T23:59:59.999Z",
        "research-ts@5b0a0ddd",
        None,
        "main's last commit before computed_at 2026-09-01T21:38:38Z; not rebuildable (the store lost the 2024 preseason rosters)",
    ),
)


def board_model_sql(source_column: str, as_of_column: str, field: str) -> str:
    """A SQL CASE naming each listed board's `model_version` or `arithmetic`, NULL otherwise."""
    arms = []
    for board in LEGACY_BOARD_MODELS:
        value = getattr(board, field)
        if value is None:
            continue
        arms.append(
            f"WHEN {source_column} = '{board.source}' AND {as_of_column} = TIMESTAMPTZ '{board.as_of}' THEN '{value}'"
        )
    return f"(CASE {' '.join(arms)} ELSE NULL END)"
