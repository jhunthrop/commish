"""A BOARD AS THE STORE HOLDS IT: every board in a model case is reduced to the rows and reasons a
write leaves behind, so the oracle's write, a past tree's write, the dev store's stored generation
and the port's built board are compared in one shape.

The oracle and the past trees write into a legacy scratch copy (`ts/model.ts persist`,
`old_tree.run_tree_persist`), and their legs are read back from it. A leg is its projection rows
(every stored column) keyed by player, each player's reasons as the store keeps them (one per code
and law id, the write's upsert keeping the last), and the roster gate's exclusions: the players
holding a `roster_status` reason and no row.
"""

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Any, Final

import psycopg
from sqlalchemy import Connection

from research.model.arithmetic import Arithmetic
from research.model.instants import js_iso, ms_instant
from research.model.market.blend import DegenerateMarketError
from research.model.market.curve import BOARD_FORMATS, RAW_BOARD_SOURCE, BoardFormat, board_source_for
from research.model.preseason.build import BuiltBoard, blend_evidence, blended_board, raw_board
from research.model.preseason.inputs import board_moment_for, load_preseason
from research.model.preseason.persist import projection_rows
from research.model.preseason.roster_status import roster_status_reason
from research.model.priors import ModelArtifacts
from research.parity.model.compare import Diff, diff_rows
from research.parity.model.sides import run_oracle

LEG_SOURCES: Final = MappingProxyType(
    {**{board_format: board_source_for(board_format) for board_format in BOARD_FORMATS}, "raw": RAW_BOARD_SOURCE}
)
STORED_COLUMNS: Final = (
    "rank",
    "position_rank",
    "value_rank",
    "tier",
    "projected_points",
    "value_over_replacement",
    "expected_games",
    "floor_points",
    "median_points",
    "ceiling_points",
)
_ROSTER_STATUS: Final = "roster_status"
_TAKEN_AT: Final = re.compile(r"moment kind: (live|replay)\s+taken at (\S+)")
_WROTE_LEG: Final = re.compile(r"\[[^,\]]+, ([a-z0-9_]+)\]")


@dataclass(frozen=True, slots=True)
class Leg:
    """One board as the store holds it."""

    rows: Mapping[str, Mapping[str, Any]]
    excluded: Mapping[str, Mapping[str, Any]]


def _reason_key(reason: Mapping[str, Any]) -> str:
    return f"{reason['code']}|{reason.get('lawId', '') if reason['code'] == 'law' else ''}"


def _as_stored(reasons: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """Reasons as a write leaves them: one per (code, law id), the last written kept, in key order."""
    kept = {_reason_key(reason): reason for reason in reasons}
    return [kept[key] for key in sorted(kept)]


def read_leg(url: str, season: int, source: str, as_of: datetime) -> Leg:
    """One generation of one board, read (read only) from a legacy database's `public` schema. The
    legacy reasons carry no `as_of`: a live write retires its (season, source) before writing, so
    the reasons held are the latest generation's, which is the one every case reads."""
    listed = ", ".join(STORED_COLUMNS)
    with psycopg.connect(url) as conn:
        conn.read_only = True
        cursor = conn.execute(
            f"select player_id, {listed} from public.preseason_projections where season = %s and source = %s and as_of = %s",
            (season, source, as_of),
        )
        rows = {row[0]: dict(zip(STORED_COLUMNS, row[1:], strict=True)) for row in cursor}
        reasons: dict[str, list[Mapping[str, Any]]] = {}
        for player_id, code, payload in conn.execute(
            "select player_id, code, payload from public.preseason_board_reasons where season = %s and source = %s",
            (season, source),
        ):
            reasons.setdefault(player_id, []).append({"code": code, **payload})
    excluded = {
        player_id: held[0]
        for player_id, held in reasons.items()
        if player_id not in rows and [reason["code"] for reason in held] == [_ROSTER_STATUS]
    }
    return Leg(
        {player_id: {**row, "reasons": _as_stored(reasons.get(player_id, ()))} for player_id, row in rows.items()},
        excluded,
    )


def port_leg(built: BuiltBoard, season: int, source: str, as_of: datetime) -> Leg:
    """The port's built board as its write would store it."""
    stored = {row["player_id"]: row for row in projection_rows(built.board, season, source, as_of, "live")}
    rows = {
        entry.player_id: {
            **{column: stored[entry.player_id][column] for column in STORED_COLUMNS},
            "reasons": _as_stored(json.loads(json.dumps(list(entry.reasons)))),
        }
        for entry in built.board
    }
    excluded = {excluded.player_id: roster_status_reason(excluded.status) for excluded in built.exclusions}
    return Leg(rows, excluded)


@dataclass(frozen=True, slots=True)
class PortTake:
    moment: datetime
    moment_kind: str
    legs: Mapping[str, Leg]
    error: str | None


def port_take(
    conn: Connection, season: int, now: datetime, artifacts: ModelArtifacts, arithmetic: Arithmetic
) -> PortTake:
    """Every leg in the oracle's order, stopping at the first refusal exactly as `persistSeason` does."""
    inputs = load_preseason(conn, season, board_moment_for(conn, season, now))
    evidence = blend_evidence(conn, inputs, artifacts)
    legs: dict[str, Leg] = {}
    for name, source in LEG_SOURCES.items():
        try:
            built = (
                raw_board(conn, inputs, artifacts, arithmetic)
                if name == "raw"
                else blended_board(conn, inputs, artifacts, _board_format(name), evidence, arithmetic)
            )
        except DegenerateMarketError as refusal:
            return PortTake(inputs.moment, inputs.moment_kind, legs, f"Error: {refusal}")
        legs[name] = port_leg(built, season, source, inputs.moment)
    return PortTake(inputs.moment, inputs.moment_kind, legs, None)


def _board_format(name: str) -> BoardFormat:
    return next(board_format for board_format in BOARD_FORMATS if board_format == name)


@dataclass(frozen=True, slots=True)
class OracleTake:
    """What `persistSeason` wrote: its moment, the legs in the order written, and its refusal."""

    moment: datetime | None
    moment_kind: str | None
    legs: Mapping[str, Leg]
    error: str | None


@dataclass(frozen=True, slots=True)
class Written:
    """What a persist's operator lines say it did: the moment it took, and each source it wrote."""

    moment: datetime | None
    moment_kind: str | None
    sources: tuple[str, ...]


def written(lines: Iterable[str]) -> Written:
    """Reads `persistSeason`'s operator lines (today's and the past trees' print the same two)."""
    held = list(lines)
    taken = next((match for line in held if (match := _TAKEN_AT.search(line)) is not None), None)
    sources = tuple(match.group(1) for line in held if (match := _WROTE_LEG.search(line)) is not None)
    if taken is None:
        return Written(None, None, sources)
    return Written(ms_instant(datetime.fromisoformat(taken.group(2).replace("Z", "+00:00"))), taken.group(1), sources)


def oracle_take(legacy_url: str, season: int, now: datetime) -> OracleTake:
    """The oracle's `persistSeason` at `now` against the scratch, each written leg read back."""
    run = run_oracle(legacy_url, "persist", str(season), js_iso(now))
    logs = [str(line["log"]) for line in run.lines if isinstance(line, dict) and "log" in line]
    took = written(logs)
    if took.moment is None:
        return OracleTake(None, None, {}, run.error or "the oracle printed no board moment")
    legs = {_leg_name(source): read_leg(legacy_url, season, source, took.moment) for source in took.sources}
    return OracleTake(took.moment, took.moment_kind, legs, run.error)


def _leg_name(source: str) -> str:
    return next(str(name) for name, leg_source in LEG_SOURCES.items() if leg_source == source)


def written_legs(url: str, season: int, as_of: datetime, names: Sequence[str]) -> dict[str, Leg]:
    """The named legs of one generation, read from `url`."""
    return {name: read_leg(url, season, LEG_SOURCES[name], as_of) for name in names}


def leg_diffs(label: str, left: Mapping[str, Leg], right: Mapping[str, Leg], names: Sequence[str]) -> list[Diff]:
    """Each named leg, rows (every stored column and the reasons) and exclusions, left against right."""
    empty = Leg({}, {})
    diffs: list[Diff] = []
    for name in names:
        mine, theirs = left.get(name, empty), right.get(name, empty)
        diffs.append(diff_rows(f"{label} {name} board", mine.rows, theirs.rows))
        diffs.append(diff_rows(f"{label} {name} exclusions", mine.excluded, theirs.excluded, may_be_empty=True))
    return diffs
