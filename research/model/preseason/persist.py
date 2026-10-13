"""TAKING A SEASON'S BOARDS: built, then written down or compared with what is stored.

Ported from `research-ts/src/projections/preseason/{persist,board-store,board-reasons-store}.ts`.
The three blended legs first and the raw leg last, so a degenerate live market refuses before any
row lands. A live board retires its season's previous generation in the same transaction; a
replay board appends. v7, the register's shadow track, is never written.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.arithmetic import Arithmetic, Provenance
from research.model.instants import ms_instant
from research.model.market.curve import BOARD_FORMATS, RAW_BOARD_SOURCE, BoardFormat, board_source_for
from research.model.preseason.board import BoardEntry
from research.model.preseason.build import BlendEvidence, BuiltBoard, blend_evidence, blended_board, raw_board
from research.model.preseason.emit import ExcludedCandidate
from research.model.preseason.inputs import MomentKind, PreseasonInputs, board_moment_for, load_preseason
from research.model.preseason.roster_status import roster_status_reason
from research.model.priors import ModelArtifacts

V7_SHADOW_SOURCE: Final = "commish_board_v7_ppr_12"
FROZEN_BOARD_SOURCES: Final = frozenset((V7_SHADOW_SOURCE,))
POINT_FIELDS: Final = ("projected_points", "floor_points", "median_points", "ceiling_points", "expected_games")


@dataclass(frozen=True, slots=True)
class Leg:
    board_format: BoardFormat | None
    source: str


def legs_for(formats: Sequence[BoardFormat]) -> list[Leg]:
    """The blended legs in format order, then the raw v1 leg."""
    return [
        *(Leg(board_format, board_source_for(board_format)) for board_format in formats),
        Leg(None, RAW_BOARD_SOURCE),
    ]


@dataclass(frozen=True, slots=True)
class SeasonBoards:
    inputs: PreseasonInputs
    boards: dict[str, BuiltBoard]


def build_season(  # noqa: PLR0913, PLR0917 - the oracle's parameters, and the arithmetic it took from its host
    conn: Connection,
    season: int,
    now: datetime,
    artifacts: ModelArtifacts,
    arithmetic: Arithmetic,
    formats: Sequence[BoardFormat] = BOARD_FORMATS,
) -> SeasonBoards:
    """Every leg of one season at the moment `now` gives it (live before kickoff, replay after),
    computed in `arithmetic` (`research.model.arithmetic`)."""
    inputs = load_preseason(conn, season, board_moment_for(conn, season, now))
    evidence: BlendEvidence = blend_evidence(conn, inputs, artifacts)
    boards: dict[str, BuiltBoard] = {}
    for leg in legs_for(formats):
        boards[leg.source] = (
            raw_board(conn, inputs, artifacts, arithmetic)
            if leg.board_format is None
            else blended_board(conn, inputs, artifacts, leg.board_format, evidence, arithmetic)
        )
    return SeasonBoards(inputs, boards)


def projection_rows(
    board: Sequence[BoardEntry], season: int, source: str, as_of: datetime, kind: MomentKind
) -> list[dict[str, Any]]:
    """`projectionRows`: the stored columns of each board row."""
    return [
        {
            "season": season,
            "source": source,
            "player_id": entry.player_id,
            "as_of": as_of,
            "moment_kind": kind,
            "rank": entry.rank,
            "position_rank": entry.position_rank,
            "value_rank": entry.value_rank,
            "tier": entry.tier,
            "projected_points": entry.projected_points,
            "value_over_replacement": entry.value_over_replacement,
            "expected_games": entry.expected_games,
            "floor_points": entry.outlook.floor,
            "median_points": entry.outlook.median,
            "ceiling_points": entry.outlook.ceiling,
        }
        for entry in board
    ]


def _reason_row(season: int, source: str, as_of: datetime, player_id: str, reason: Mapping[str, Any]) -> dict[str, Any]:
    payload = {key: value for key, value in reason.items() if key != "code"}
    detail = str(reason["lawId"]) if reason["code"] == "law" else ""
    return {
        "season": season,
        "source": source,
        "as_of": as_of,
        "player_id": player_id,
        "code": reason["code"],
        "detail": detail,
        "payload": payload,
    }


def reason_rows(built: BuiltBoard, season: int, source: str, as_of: datetime) -> list[dict[str, Any]]:
    """`reasonRows` and `exclusionReasonRows`: the board's reasons, then the gate's exclusions."""
    rows = [
        _reason_row(season, source, as_of, entry.player_id, reason) for entry in built.board for reason in entry.reasons
    ]
    rows.extend(
        _reason_row(season, source, as_of, excluded.player_id, roster_status_reason(excluded.status))
        for excluded in built.exclusions
    )
    return rows


class FrozenBoardError(ValueError):
    """A write under a source the register reads as a frozen shadow."""


_INSERT_PROJECTION: Final = text(
    "insert into research.preseason_projections (season, source, player_id, as_of, moment_kind, rank, position_rank, value_rank, tier, "
    "projected_points, value_over_replacement, expected_games, floor_points, median_points, ceiling_points, model_version, arithmetic) "
    "values (:season, :source, :player_id, :as_of, :moment_kind, :rank, :position_rank, :value_rank, :tier, :projected_points, "
    ":value_over_replacement, :expected_games, :floor_points, :median_points, :ceiling_points, :model_version, :arithmetic) "
    "on conflict do nothing"
)
_UPSERT_REASON: Final = text(
    "insert into research.preseason_board_reasons (season, source, as_of, player_id, code, detail, payload) values (:season, :source, "
    ":as_of, :player_id, :code, :detail, cast(:payload as jsonb)) on conflict (season, source, as_of, player_id, code, detail) "
    "do update set payload = excluded.payload where research.preseason_board_reasons.payload is distinct from excluded.payload"
)


@dataclass(frozen=True, slots=True)
class WriteCounts:
    mode: str
    written: int
    reasons_written: int
    retired_projections: int
    retired_reasons: int


def write_board(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    conn: Connection,
    season: int,
    source: str,
    inputs: PreseasonInputs,
    built: BuiltBoard,
    provenance: Provenance,
    unfrozen: bool = False,
) -> WriteCounts:
    """`writePreseasonBoard`: a live board replaces its season's generation, a replay appends. Each
    row records the model version and arithmetic that made it (the oracle's rows record neither)."""
    if source in FROZEN_BOARD_SOURCES and not unfrozen:
        raise FrozenBoardError(
            f"refusing to write {source}: the register's shadow track reads it and this tree cannot rebuild it"
        )
    stamp = {"model_version": provenance.model_version, "arithmetic": provenance.arithmetic.label}
    projections = [
        {**row, **stamp} for row in projection_rows(built.board, season, source, inputs.moment, inputs.moment_kind)
    ]
    reasons = [
        {**row, "payload": json.dumps(row["payload"])} for row in reason_rows(built, season, source, inputs.moment)
    ]
    retired = (0, 0)
    if inputs.moment_kind == "live":
        if not built.board:
            raise ValueError(
                f"a live {source} board for {season} with no rows would retire the served board for nothing"
            )
        params = {"season": season, "source": source}
        retired = (
            conn.execute(
                text("delete from research.preseason_projections where season = :season and source = :source"), params
            ).rowcount,
            conn.execute(
                text("delete from research.preseason_board_reasons where season = :season and source = :source"), params
            ).rowcount,
        )
    written = sum(conn.execute(_INSERT_PROJECTION, row).rowcount for row in projections)
    reasons_written = sum(conn.execute(_UPSERT_REASON, row).rowcount for row in reasons)
    mode = "retire_generation" if inputs.moment_kind == "live" else "append"
    return WriteCounts(mode, written, reasons_written, retired[0], retired[1])


def stored_generation(conn: Connection, season: int, source: str, as_of: datetime) -> list[dict[str, Any]]:
    """`preseasonProjectionsAsOf`: each player's latest stored row at or before `as_of`."""
    rows = conn.execute(
        text(
            "select distinct on (player_id) player_id, rank, value_rank, projected_points, floor_points, median_points, ceiling_points, "
            "expected_games, as_of from research.preseason_projections where season = :season and source = :source and as_of <= :as_of "
            "order by player_id asc, as_of desc"
        ),
        {"season": season, "source": source, "as_of": as_of},
    )
    return [{**row._asdict(), "as_of": ms_instant(row.as_of)} for row in rows]


@dataclass(frozen=True, slots=True)
class PointDrift:
    compared: int
    missing_from_rebuild: tuple[str, ...]
    missing_from_store: tuple[str, ...]
    max_abs_delta: float
    worst: tuple[str, str] | None
    over_tolerance: int


def diff_points(
    stored: Sequence[Mapping[str, Any]], rebuilt: Sequence[Mapping[str, Any]], tolerance: float
) -> PointDrift:
    """`diffPoints`: field by field on the players both hold, with who is on one side only."""
    stored_by = {row["player_id"]: row for row in stored}
    rebuilt_by = {row["player_id"]: row for row in rebuilt}
    max_delta = 0.0
    worst: tuple[str, str] | None = None
    over = 0
    compared = 0
    for player_id, fresh in rebuilt_by.items():
        prior = stored_by.get(player_id)
        if prior is None:
            continue
        compared += 1
        for field in POINT_FIELDS:
            delta = abs(fresh[field] - prior[field])
            if delta > tolerance:
                over += 1
            if delta > max_delta:
                max_delta = delta
                worst = (player_id, field)
    return PointDrift(
        compared,
        tuple(sorted(set(stored_by) - set(rebuilt_by))),
        tuple(sorted(set(rebuilt_by) - set(stored_by))),
        max_delta,
        worst,
        over,
    )


def stored_reasons(conn: Connection, season: int, source: str, as_of: datetime) -> dict[str, list[dict[str, Any]]]:
    """`boardReasons` for one generation: each player's reasons as the board stated them."""
    out: dict[str, list[dict[str, Any]]] = {}
    rows = conn.execute(
        text(
            "select player_id, code, payload from research.preseason_board_reasons where season = :season and source = :source and as_of = :as_of"
        ),
        {"season": season, "source": source, "as_of": as_of},
    )
    for row in rows:
        out.setdefault(row.player_id, []).append({"code": row.code, **row.payload})
    return out


def reasons_that_would_change(
    stored: Mapping[str, Sequence[Mapping[str, Any]]], fresh: Mapping[str, Sequence[Mapping[str, Any]]]
) -> int:
    """`diffReasons`, totalled: (player, code) pairs added, removed or carrying a different payload."""
    moved = 0
    for player_id in set(stored) | set(fresh):
        before = {(reason["code"], reason.get("lawId", "")): reason for reason in stored.get(player_id, [])}
        after = {(reason["code"], reason.get("lawId", "")): reason for reason in fresh.get(player_id, [])}
        moved += sum(1 for key in set(before) | set(after) if before.get(key) != after.get(key))
    return moved


def fresh_reasons(built: BuiltBoard) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {
        entry.player_id: [dict(reason) for reason in entry.reasons] for entry in built.board
    }
    for excluded in built.exclusions:
        out[excluded.player_id] = [roster_status_reason(excluded.status)]
    return out


def excluded_ids(exclusions: Sequence[ExcludedCandidate]) -> list[str]:
    return [excluded.player_id for excluded in exclusions]
