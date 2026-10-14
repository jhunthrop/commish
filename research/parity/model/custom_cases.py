"""THE CUSTOM BOARD CASE: a league's exact rules, proven on the three rules the store already holds.

The week-2 generation is rebuilt on a scratch copy of the store as it stood at its moment, its
candidate sets are written to `preseason_candidates` as the board writer writes them, and then the
custom path (`research.boards.custom`: the sets read back from the table, `preseason_board` under
the request's rules and shape, the answer kept in `custom_boards`) is asked for PPR, half PPR and
standard on the stored boards' shape. Each answer must equal the stored board in every column the
board stores, to the bit: rank, position rank, value rank, tier, points, points over replacement,
expected games, floor, median and ceiling. The same request a second time must come from the cache
and be the same rows.

Latency is measured on the same copy: cold (a rules set not yet kept, so the candidates are read
and the board built) and hit (the same rules again), each over a spread of league rules.
"""

import statistics
import time
from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import timedelta
from typing import Any, Final

from sqlalchemy import Connection, text

from research.boards.custom import ROW_FIELDS, custom_board
from research.boards.request import CustomRequest
from research.model.arithmetic import ARM64_BOARDS
from research.model.market.curve import BOARD_FORMATS, FORMAT_RULES, board_source_for
from research.model.preseason.board import GameVariancePriors
from research.model.preseason.build import BOARD_SHAPE
from research.model.preseason.candidate_store import write_candidates
from research.model.preseason.persist import build_season
from research.model.priors import load_model_artifacts
from research.parity.model.board_cases import WEEK_TWO_BOARD
from research.parity.model.compare import Diff, diff_rows
from research.parity.model.outcome import CaseResult, Claim
from research.parity.model.store import oracle_fits, scratch_pair_at

_MODEL: Final = "research@parity"
_LATENCY_RULES: Final = 20
_P95: Final = 0.95
_STORED: Final = tuple(field for field in ROW_FIELDS if field not in {"player_id", "position"})


def _stored(conn: Connection, source: str) -> dict[str, dict[str, Any]]:
    rows = conn.execute(
        text(
            f"select player_id, {', '.join(_STORED)} from research.preseason_projections "
            "where season = 2026 and source = :source and as_of = :as_of"
        ),
        {"source": source, "as_of": WEEK_TWO_BOARD},
    )
    return {row.player_id: {column: getattr(row, column) for column in _STORED} for row in rows}


def _keyed(rows: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    return {row["player_id"]: {column: row[column] for column in _STORED} for row in rows}


def _p95(samples: Sequence[float]) -> float:
    ordered = sorted(samples)
    return ordered[min(len(ordered) - 1, int(_P95 * len(ordered)))]


def _timed(conn: Connection, request: CustomRequest, priors: GameVariancePriors) -> tuple[float, bool]:
    started = time.perf_counter()
    board = custom_board(conn, request, priors, _MODEL)
    return (time.perf_counter() - started) * 1000, board.cached


def _latency(conn: Connection, priors: GameVariancePriors) -> tuple[list[str], list[Claim]]:
    """Cold and hit over league rules spread across the three candidate sets."""
    requests = [
        CustomRequest(
            2026,
            replace(
                FORMAT_RULES["ppr"],
                points_per_reception=round(0.05 * n, 2),
                points_per_passing_touchdown=4 + (n % 3),
                te_reception_bonus=0.5 * (n % 2),
            ),
            BOARD_SHAPE,
        )
        for n in range(1, _LATENCY_RULES + 1)
    ]
    cold = [_timed(conn, request, priors) for request in requests]
    hit = [_timed(conn, request, priors) for request in requests]
    notes = [
        f"cold custom board over {len(cold)} rule sets: p50 {statistics.median(t for t, _ in cold):.1f} ms, "
        f"p95 {_p95([t for t, _ in cold]):.1f} ms",
        f"cache hit over the same: p50 {statistics.median(t for t, _ in hit):.1f} ms, p95 {_p95([t for t, _ in hit]):.1f} ms",
    ]
    claims = [
        Claim("every first request built its board", not any(cached for _, cached in cold)),
        Claim("every second request came from the cache", all(cached for _, cached in hit)),
    ]
    return notes, claims


def custom_board_week_two() -> CaseResult:
    pair = scratch_pair_at(WEEK_TWO_BOARD, "custom", oracle_fits())
    engine = pair.research_engine()
    diffs: list[Diff] = []
    claims: list[Claim] = []
    with engine.begin() as conn:
        artifacts = load_model_artifacts(conn)
        built = build_season(conn, 2026, WEEK_TWO_BOARD, artifacts, ARM64_BOARDS, BOARD_FORMATS)
        claims.append(Claim("the rebuild took the stored moment", built.inputs.moment == WEEK_TWO_BOARD))
        for fmt in BOARD_FORMATS:
            source = board_source_for(fmt)
            write_candidates(
                conn, 2026, source, WEEK_TWO_BOARD, built.inputs.moment_kind, built.boards[source].candidates, _MODEL
            )
        for fmt in BOARD_FORMATS:
            source = board_source_for(fmt)
            request = CustomRequest(2026, FORMAT_RULES[fmt], BOARD_SHAPE)
            cold = custom_board(conn, request, artifacts.game_variance, _MODEL)
            hit = custom_board(conn, request, artifacts.game_variance, _MODEL)
            diffs.append(
                diff_rows(f"stored {source} vs the custom path, {fmt} rules", _stored(conn, source), _keyed(cold.rows))
            )
            claims += [
                Claim(f"{fmt} rules read the {source} candidates", cold.source == source),
                Claim(
                    f"{fmt}: the second request came from the cache, row for row", hit.cached and hit.rows == cold.rows
                ),
            ]
        stale = WEEK_TWO_BOARD - timedelta(days=1)
        conn.execute(
            text(
                "insert into research.custom_boards (season, as_of, rules_hash, shape_hash, source, rules, shape, rows, "
                "model_version) values (2026, :as_of, 'stale', 'stale', :source, '{}', '{}', '[]', :model)"
            ),
            {"as_of": stale, "source": board_source_for("ppr"), "model": _MODEL},
        )
        notes, timed = _latency(conn, artifacts.game_variance)
        kept = conn.execute(
            text("select count(*), count(distinct as_of) from research.custom_boards where season = 2026")
        ).one()
        timed.append(
            Claim(
                f"the cache holds the current run only: {kept[0]} boards at {kept[1]} generation, an earlier run's dropped",
                kept[1] == 1,
            )
        )
    engine.dispose()
    return CaseResult("custom-board-2026-week2", diffs, notes, True, claims + timed)
