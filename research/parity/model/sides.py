"""THE TWO SIDES OF A MODEL CASE: the oracle run through `ts/model.ts`, the port run in-process,
both reduced to the same JSON shape so a diff is a dictionary comparison."""

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Final

from sqlalchemy import Connection

from research.model.instants import js_iso
from research.model.market.blend import DegenerateMarketError
from research.model.market.curve import BOARD_FORMATS, BoardFormat
from research.model.preseason.build import BuiltBoard, blend_evidence, blended_board, raw_board
from research.model.preseason.inputs import board_moment_for, load_preseason
from research.model.priors import ModelArtifacts

_REPO: Final = Path(__file__).resolve().parents[3]
_DRIVER: Final = _REPO / "research" / "parity" / "ts" / "model.ts"
_TIMEOUT_SECONDS: Final = 900
LEGS: Final[tuple[str, ...]] = (*BOARD_FORMATS, "raw")


@dataclass(frozen=True, slots=True)
class OracleRun:
    lines: list[Any]
    error: str | None


def run_oracle(database_url: str, *args: str) -> OracleRun:
    """`ts/model.ts <args>` against a legacy scratch database: its JSON lines, and its refusal if it threw."""
    completed = subprocess.run(
        ["npx", "tsx", str(_DRIVER), *args],
        cwd=_REPO,
        capture_output=True,
        text=True,
        timeout=_TIMEOUT_SECONDS,
        env={**_environment(), "DATABASE_URL": database_url},
        check=False,
    )
    lines = [json.loads(line) for line in completed.stdout.splitlines() if line.startswith("{") or line.startswith("[")]
    error = None if completed.returncode == 0 else _first_error_line(completed.stderr)
    return OracleRun(lines, error)


def _environment() -> dict[str, str]:
    import os  # noqa: PLC0415 - the child inherits the harness's environment, read once here

    return dict(os.environ)


def _first_error_line(stderr: str) -> str:
    for line in stderr.splitlines():
        stripped = line.strip()
        if stripped.startswith("Error:") or stripped.startswith("DrizzleQueryError"):
            return stripped
    return stderr.strip().splitlines()[-1] if stderr.strip() else "the oracle exited non-zero"


def board_json(leg: str, moment: datetime, kind: str, built: BuiltBoard) -> dict[str, Any]:
    """A built leg in the oracle driver's shape."""
    rows = [
        {
            "playerId": e.player_id,
            "position": e.position,
            "team": e.team,
            "rank": e.rank,
            "positionRank": e.position_rank,
            "valueRank": e.value_rank,
            "tier": e.tier,
            "projectedPoints": e.projected_points,
            "valueOverReplacement": e.value_over_replacement,
            "expectedGames": e.expected_games,
            "floorPoints": e.outlook.floor,
            "medianPoints": e.outlook.median,
            "ceilingPoints": e.outlook.ceiling,
            "reasons": [dict(reason) for reason in e.reasons],
        }
        for e in built.board
    ]
    excluded = [{"playerId": x.player_id, "status": x.status.kind, "source": x.status.source} for x in built.exclusions]
    return {"leg": leg, "moment": js_iso(moment), "momentKind": kind, "rows": rows, "excluded": excluded}


@dataclass(frozen=True, slots=True)
class PortRun:
    lines: list[dict[str, Any]]
    error: str | None


def run_port_boards(conn: Connection, season: int, now: datetime, artifacts: ModelArtifacts) -> PortRun:
    """Every leg in the oracle's order, stopping at the first refusal exactly as the oracle does."""
    inputs = load_preseason(conn, season, board_moment_for(conn, season, now))
    evidence = blend_evidence(conn, inputs, artifacts)
    lines: list[dict[str, Any]] = []
    for leg in LEGS:
        try:
            built = (
                raw_board(conn, inputs, artifacts)
                if leg == "raw"
                else blended_board(conn, inputs, artifacts, _format(leg), evidence)
            )
        except DegenerateMarketError as refusal:
            return PortRun(lines, str(refusal))
        lines.append(board_json(leg, inputs.moment, inputs.moment_kind, built))
    return PortRun(lines, None)


def _format(leg: str) -> BoardFormat:
    for board_format in BOARD_FORMATS:
        if board_format == leg:
            return board_format
    raise ValueError(f"{leg} is not a board format")
