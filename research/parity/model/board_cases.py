"""THE BOARD CASES: the 2026 boards the register froze, each proven three ways.

1. The tree that made the stored board, run unmodified on the store as it stood (`old_tree`),
   reproduces the stored board (week 2: every leg, every stored column and reason; week 1: the
   register's frozen points, ranks and value ranks, the generation itself retired from the store).
2. Today's oracle, called as it runs (`persistSeason`, `ts/model.ts persist`), is checked against
   the stored board before the port is compared with it.
3. The port, in the arithmetic the stored boards were made in (`ARM64_BOARDS`), against the oracle.

Every comparison is exact.
"""

from datetime import UTC, datetime
from typing import Any, Final

from research.model.arithmetic import ARM64_BOARDS
from research.model.market.blend import REFUSAL_WORDING
from research.model.priors import load_model_artifacts
from research.parity.model.boards import (
    LEG_SOURCES,
    Leg,
    PortTake,
    leg_diffs,
    oracle_take,
    port_take,
    read_leg,
    written,
    written_legs,
)
from research.parity.model.compare import Diff, diff_rows
from research.parity.model.old_tree import run_tree_persist
from research.parity.model.outcome import CaseResult, Claim, refusals, source_rows
from research.parity.model.store import (
    Restatement,
    ScratchPair,
    legacy_copy_at,
    oracle_fits,
    restate,
    scratch_pair_at,
    source_url,
)

WEEK_ONE_BOARD: Final = datetime(2026, 9, 7, 21, 57, 33, 121000, tzinfo=UTC)
WEEK_TWO_BOARD: Final = datetime(2026, 9, 9, 2, 20, 29, 697000, tzinfo=UTC)
WEEK_ONE_TREE: Final = "800aef34"
WEEK_TWO_TREE: Final = "7af71283"
SERVED: Final = LEG_SOURCES["ppr"]
# The week-1 tree wrote the served blend and the raw v1 board; per-format boards came the next day.
WEEK_ONE_LEGS: Final = (SERVED, LEG_SOURCES["raw"])
# The one universe fact the week-1 board read that the store has since rewritten in place
# (`nfl_players` carries no stamp): Velus Jones Jr. was a WR when the board was taken (nflverse's
# roster weeks list WR for 2022-2023, Tank01 lists WR) and the universe now says RB.
RESTATED_PLAYER: Final = "00-0037745"
WEEK_ONE_RESTATEMENT: Final = Restatement(
    f"update nfl_players set position = 'WR' where id = '{RESTATED_PLAYER}'",
    "Velus Jones Jr. was a WR in the universe at 2026-09-07T21:57Z; nfl_players was rewritten in place since",
)
_FROZEN_COLUMNS: Final = (
    ("board_points", "projected_points"),
    ("board_rank", "rank"),
    ("board_value_rank", "value_rank"),
)


def _port(pair: ScratchPair, now: datetime) -> PortTake:
    engine = pair.research_engine()
    with engine.connect() as conn:
        take = port_take(conn, 2026, now, load_model_artifacts(conn), ARM64_BOARDS)
    engine.dispose()
    return take


def _frozen(week: int) -> dict[str, dict[str, Any]]:
    """The register's frozen claim about the served board, in the board's own column names."""
    rows = source_rows(
        "select player_id, board_points, board_rank, board_value_rank from public.register_freeze_rows "
        "where season = 2026 and week = %s and board_source = %s",
        (week, SERVED),
    )
    return {row["player_id"]: {ours: row[theirs] for theirs, ours in _FROZEN_COLUMNS} for row in rows}


def _claimed(leg: Leg, *, without: str | None = None) -> dict[str, dict[str, Any]]:
    return {
        player_id: {ours: row[ours] for _, ours in _FROZEN_COLUMNS}
        for player_id, row in leg.rows.items()
        if player_id != without
    }


def _tree_take(
    commit: str, database: str, now: datetime, restatement: Restatement | None, expected: tuple[str, ...]
) -> tuple[str, list[Claim]]:
    """A scratch copy at `now` (restated if asked), the tree's own persist run on it, and whether it
    took its board at `now` and wrote every leg it was asked to."""
    url = legacy_copy_at(now, database)
    if restatement is not None:
        restate(url, restatement)
    run = run_tree_persist(commit, url, 2026, now)
    took = written(run.stdout.splitlines())
    return url, [
        Claim(f"the tree at {commit} exited cleanly ({run.returncode})", run.returncode == 0),
        Claim(f"the tree at {commit} took its board at {now.isoformat()}", took.moment == now),
        Claim(f"the tree at {commit} wrote {', '.join(expected)}", took.sources == expected),
    ]


def board_week_two() -> CaseResult:
    names = tuple(LEG_SOURCES)
    stored = written_legs(source_url(), 2026, WEEK_TWO_BOARD, names)
    tree_url, claims = _tree_take(
        WEEK_TWO_TREE, "parity_model_board2_tree", WEEK_TWO_BOARD, None, tuple(LEG_SOURCES.values())
    )
    tree = written_legs(tree_url, 2026, WEEK_TWO_BOARD, names)
    pair = scratch_pair_at(WEEK_TWO_BOARD, "board2", oracle_fits())
    oracle = oracle_take(pair.legacy_url, 2026, WEEK_TWO_BOARD)
    port = _port(pair, WEEK_TWO_BOARD)
    agree, notes = refusals("persist", oracle.error, port.error, REFUSAL_WORDING)
    claims += [
        Claim("today's oracle wrote every leg", tuple(oracle.legs) == names),
        Claim("the oracle and the port took the stored moment", oracle.moment == port.moment == WEEK_TWO_BOARD),
    ]
    diffs: list[Diff] = [
        *leg_diffs(f"stored vs tree {WEEK_TWO_TREE}", stored, tree, names),
        *leg_diffs("stored vs today's oracle", stored, oracle.legs, names),
        *leg_diffs("oracle vs port", oracle.legs, port.legs, names),
        diff_rows("register week 2 vs port ppr", _frozen(2), _claimed(port.legs.get("ppr", Leg({}, {})))),
    ]
    return CaseResult("board-2026-week2", diffs, notes, agree, claims)


def board_week_one() -> CaseResult:
    frozen = _frozen(1)
    restated_url, claims = _tree_take(
        WEEK_ONE_TREE, "parity_model_board1_tree", WEEK_ONE_BOARD, WEEK_ONE_RESTATEMENT, WEEK_ONE_LEGS
    )
    as_is_url, as_is_claims = _tree_take(WEEK_ONE_TREE, "parity_model_board1_asis", WEEK_ONE_BOARD, None, WEEK_ONE_LEGS)
    restated = read_leg(restated_url, 2026, SERVED, WEEK_ONE_BOARD)
    as_is = read_leg(as_is_url, 2026, SERVED, WEEK_ONE_BOARD)
    unrestated = diff_rows("register week 1 vs the tree, store as is", frozen, _claimed(as_is))
    moved = {
        player_id
        for player_id, row in _claimed(as_is).items()
        if player_id in frozen and row["projected_points"] != frozen[player_id]["projected_points"]
    }
    claims += [
        *as_is_claims,
        Claim(
            f"on the store as is, the only player whose points move is {RESTATED_PLAYER}", moved == {RESTATED_PLAYER}
        ),
    ]
    notes = [
        f"restated: {WEEK_ONE_RESTATEMENT.why}",
        f"store as is: {unrestated.differing} frozen cells differ (worst {unrestated.worst:.4f}): {RESTATED_PLAYER}'s points "
        "and the value ranks his move shifts; with the restatement, none",
    ]
    pair = scratch_pair_at(WEEK_ONE_BOARD, "board1", oracle_fits())
    oracle = oracle_take(pair.legacy_url, 2026, WEEK_ONE_BOARD)
    port = _port(pair, WEEK_ONE_BOARD)
    agree, refusal_notes = refusals("persist", oracle.error, port.error, REFUSAL_WORDING)
    claims += [
        Claim("the oracle and the port took the board's moment", oracle.moment == port.moment == WEEK_ONE_BOARD),
        Claim("the oracle and the port wrote the same legs before refusing", tuple(oracle.legs) == tuple(port.legs)),
    ]
    diffs = [
        diff_rows(f"register week 1 vs tree {WEEK_ONE_TREE}, restated", frozen, _claimed(restated)),
        diff_rows(
            "register week 1 vs the tree as is, all but the restated player",
            {
                player_id: {"projected_points": row["projected_points"]}
                for player_id, row in frozen.items()
                if player_id != RESTATED_PLAYER
            },
            {
                player_id: {"projected_points": row["projected_points"]}
                for player_id, row in _claimed(as_is, without=RESTATED_PLAYER).items()
            },
        ),
        *leg_diffs("oracle vs port", oracle.legs, port.legs, tuple(oracle.legs)),
    ]
    return CaseResult("board-2026-week1", diffs, notes + refusal_notes, agree, claims)
