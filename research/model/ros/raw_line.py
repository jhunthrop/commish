"""THE RAW LINE: the served raw board's points a game in each format, the prior the judged model read.

Round 3's prior is the raw board's season line (`commish_board_v1_ppr_12`) scored in each format over
its expected games (`reads.raw_per_game`). The stored board rows hold only PPR points, so the nightly's
fit step rebuilds the season's served raw generation at its own stored moment (the inputs gated
there, as the fit check rebuilds a board before kickoff), checks the rebuild against the stored rows
(every point field within the fit check's 0.05), and keeps the line as one small `model_artifacts`
row, `ros/raw-line`: a new version for each served generation and code version, none otherwise. The
in-season step reads the newest one for the season's raw generation; with none, the boards stay
preseason and the report says why.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.arithmetic import Arithmetic, model_version
from research.model.instants import js_iso, ms_instant
from research.model.preseason.build import raw_board
from research.model.preseason.inputs import BoardMoment, MomentKind, load_preseason
from research.model.preseason.persist import diff_points, projection_rows, stored_generation
from research.model.priors import ModelArtifacts
from research.model.ros.model import FORMATS
from research.model.ros.reads import raw_per_game

ARTIFACT: Final = "ros/raw-line"
RAW_SOURCE: Final = "commish_board_v1_ppr_12"
TOLERANCE: Final = 0.05  # the fit check's: the pages print one decimal


@dataclass(frozen=True, slots=True)
class RawLine:
    """One served raw generation's points a game by format, by universe id."""

    season: int
    as_of: str  # the generation's stored moment, ISO
    model_version: str  # the code that rebuilt it
    per_game: dict[str, dict[str, float]]


_GENERATION: Final = text(
    "select as_of, min(moment_kind) as kind from research.preseason_projections "
    "where season = :s and source = :source and as_of = (select max(as_of) from research.preseason_projections "
    "where season = :s and source = :source) group by as_of"
)


def raw_generation(conn: Connection, season: int) -> BoardMoment | None:
    """The served raw board's newest generation: its moment and kind, or None when none is stored."""
    row = conn.execute(_GENERATION, {"s": season, "source": RAW_SOURCE}).first()
    if row is None:
        return None
    kind: MomentKind = "live" if row.kind == "live" else "replay"
    return BoardMoment(kind, ms_instant(row.as_of))


def rebuild_raw_line(
    conn: Connection, season: int, moment: BoardMoment, artifacts: ModelArtifacts, arithmetic: Arithmetic
) -> RawLine | str:
    """The generation rebuilt at its moment and checked against its stored rows, or why it is not kept."""
    inputs = load_preseason(conn, season, moment, rebuild=True)
    built = raw_board(conn, inputs, artifacts, arithmetic)
    stored = stored_generation(conn, season, RAW_SOURCE, moment.at)
    drift = diff_points(stored, projection_rows(built.board, season, RAW_SOURCE, moment.at, moment.kind), TOLERANCE)
    if drift.over_tolerance or drift.missing_from_rebuild or drift.missing_from_store:
        return (
            f"the rebuilt raw board differs from the stored one ({drift.over_tolerance} point fields past "
            f"{TOLERANCE}, {len(drift.missing_from_rebuild)} players not rebuilt, {len(drift.missing_from_store)} not stored)"
        )
    per_game = {
        entry.player_id: found
        for entry in built.board
        if entry.position in ("QB", "RB", "WR", "TE") and (found := raw_per_game(entry)) is not None
    }
    return RawLine(season, js_iso(moment.at), model_version(), per_game)


def payload_of(line: RawLine) -> dict[str, Any]:
    return {"season": line.season, "asOf": line.as_of, "modelVersion": line.model_version, "perGame": line.per_game}


def line_of(payload: Mapping[str, Any]) -> RawLine:
    per_game = {
        uid: {name: float(by[name]) for name in FORMATS if name in by} for uid, by in payload["perGame"].items()
    }
    return RawLine(int(payload["season"]), str(payload["asOf"]), str(payload["modelVersion"]), per_game)


_LATEST: Final = text(
    "select version, payload from research.model_artifacts where name = :n order by version desc limit 1"
)


def latest_raw_line(conn: Connection, season: int, moment: BoardMoment) -> RawLine | None:
    """The newest kept line, when it is this season's and this generation's; None otherwise."""
    row = conn.execute(_LATEST, {"n": ARTIFACT}).first()
    if row is None:
        return None
    line = line_of(row.payload)
    return line if line.season == season and line.as_of == js_iso(moment.at) else None


def keep_raw_line(
    conn: Connection, season: int, now: datetime, artifacts: ModelArtifacts, arithmetic: Arithmetic
) -> str:
    """The fit step's part: rebuild and keep the line unless this generation's, made by this code, is
    already kept. Returns the line the step's summary carries."""
    moment = raw_generation(conn, season)
    if moment is None:
        return f"raw line: no stored {RAW_SOURCE} generation for {season}"
    kept = latest_raw_line(conn, season, moment)
    if kept is not None and kept.model_version == model_version():
        return f"raw line: kept for the {js_iso(moment.at)} generation ({len(kept.per_game)} players)"
    line = rebuild_raw_line(conn, season, moment, artifacts, arithmetic)
    if isinstance(line, str):
        return f"raw line: not kept, {line}"
    version = int(
        conn.execute(
            text("select coalesce(max(version), 0) + 1 from research.model_artifacts where name = :n"), {"n": ARTIFACT}
        ).scalar_one()
    )
    fitted_on = f"the {RAW_SOURCE} {season} generation of {line.as_of}, rebuilt at its moment by {line.model_version}"
    conn.execute(
        text(
            "insert into research.model_artifacts (name, version, fit_stamp, fitted_on, payload) "
            "values (:n, :v, :stamp, :on, cast(:payload as jsonb))"
        ),
        {"n": ARTIFACT, "v": version, "stamp": now, "on": fitted_on, "payload": json.dumps(payload_of(line))},
    )
    return f"raw line: v{version} kept for the {line.as_of} generation ({len(line.per_game)} players)"
