"""THE REST-OF-SEASON SWITCH, CASE BY CASE, on the round's scratch copy (`lane18_ros`, port 5433).

Each case assembles the run twice at one instant: without the model's inputs (today's board) and with
them. Before the switch week the two runs are equal file for file; after it every board re-ranks with
no range, each row keeps his preseason rank and points, and the depth, basis and ADP gates pass; with
the artifact missing the run is today's board again and says why.

    uv run python -m research.parity ros --database postgres://commish:commish@localhost:5433/lane18_ros
"""

import itertools
import json
from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, Engine

from research.model.ros.live import load_ros_priors
from research.nightly import gates
from research.nightly.assemble import Assembled, assemble
from research.nightly.build.ros import RosSetup
from research.nightly.build.season import format_json
from research.nightly.register_log import FrozenBy
from research.nightly.run_parts import ros_setup
from research.parity.model.compare import Diff
from research.parity.model.outcome import CaseResult, Claim
from research.season import PRODUCT_SEASON

# A Friday of week 3 (before the switch week) and the day the switch shipped (week 6 to play).
BEFORE_SWITCH: Final = datetime.fromisoformat("2026-09-25T12:00:00+00:00")
IN_SEASON: Final = datetime.fromisoformat("2026-10-14T12:00:00+00:00")
_RANGE: Final = ("floor", "median", "ceiling")
Json = dict[str, Any]


def _run(conn: Connection, instant: datetime, setup: RosSetup | None) -> Assembled:
    return assemble(conn, instant, FrozenBy({}), setup)


def _manifest_formats(run: Assembled) -> Json:
    return {f.id: format_json(f, PRODUCT_SEASON, run.rest) for f in run.formats}


def _files_diff(what: str, left: Mapping[str, Any], right: Mapping[str, Any]) -> Diff:
    """Every file (or entry) of two runs, compared as canonical JSON."""
    differing = sorted(
        k for k in set(left) & set(right) if json.dumps(left[k], sort_keys=True) != json.dumps(right[k], sort_keys=True)
    )
    return Diff(
        what,
        len(left),
        len(right),
        tuple(sorted(set(left) - set(right))),
        tuple(sorted(set(right) - set(left))),
        len(differing),
        0.0,
        tuple(differing[:3]),
    )


def _before_switch(conn: Connection, setup: RosSetup) -> CaseResult:
    today, switched = _run(conn, BEFORE_SWITCH, None), _run(conn, BEFORE_SWITCH, setup)
    return CaseResult(
        "ros-before-switch",
        [
            _files_diff("every file, a run dated in week 3", today.files, switched.files),
            _files_diff("every format in the manifest", _manifest_formats(today), _manifest_formats(switched)),
        ],
        [f"status: {switched.rest_status}"],
        claims=[Claim("the run says the switch week is not reached", "before the switch week" in switched.rest_status)],
    )


def _boards(run: Assembled) -> dict[str, list[Json]]:
    return {path: file["rows"] for path, file in run.files.items() if path.startswith("boards/")}


def _gates_pass(run: Assembled) -> list[Claim]:
    files = run.files
    manifest = {"formats": list(_manifest_formats(run).values()), "sources": list(run.sources)}
    records = [
        gates.depth_gate(run.formats, {f.id: files[f"boards/{f.id}.json"] for f in run.formats}),
        gates.basis_gate(manifest, files["adp.json"], files["record.json"], files["schedule.json"]),
        gates.adp_gate(run.formats, files["adp.json"]),
    ]
    return [Claim(f"the {r.gate} gate passes on the in-season rows ({r.summary})", r.passed) for r in records]


def _in_season(conn: Connection, setup: RosSetup) -> CaseResult:
    today, switched = _run(conn, IN_SEASON, None), _run(conn, IN_SEASON, setup)
    before, after = _boards(today), _boards(switched)
    players = {path: {row["id"]: row["ourRank"] for row in rows} for path, rows in before.items()}
    claims = [
        Claim("the rest of the season starts at week 6, lines through week 5",
              switched.rest is not None and (switched.rest.from_week, switched.rest.through) == (6, 5)),
        Claim("every board re-ranks", all([r["id"] for r in after[p]] != [r["id"] for r in before[p]] for p in before)),
        Claim("every in-season row has no range", all(r[k] is None for rows in after.values() for r in rows for k in _RANGE)),
        Claim("every row keeps his preseason rank", all(r["preseasonRank"] == players[p][r["id"]] for p, rows in after.items() for r in rows)),
        Claim("each board is in its order of points over replacement",
              all(all(a["vor"] >= b["vor"] for a, b in itertools.pairwise(rows)) for rows in after.values())),
        Claim("every format names the rest of the season", all("rest of the 2026 season from week 6" in f["basis"][0] for f in _manifest_formats(switched).values())),
        *_gates_pass(switched),
    ]  # fmt: skip
    ids = {p: {r["id"]: 1 for r in rows} for p, rows in after.items()}
    diffs = [_files_diff(f"{p}: the same players", dict.fromkeys(players[p], 1), ids[p]) for p in sorted(before)]
    return CaseResult("ros-in-season", diffs, [f"status: {switched.rest_status}"], claims=claims)


def _missing_artifact(conn: Connection, setup: RosSetup) -> CaseResult:
    today, fallen = _run(conn, IN_SEASON, None), _run(conn, IN_SEASON, RosSetup(None, setup.raw))
    return CaseResult(
        "ros-missing-artifact",
        [_files_diff("every file, an in-season run with no artifact", today.files, fallen.files)],
        [f"status: {fallen.rest_status}"],
        claims=[
            Claim("the run says the artifact is missing", "artifact is not in the store" in fallen.rest_status),
            Claim("a version the store does not hold reads as missing", load_ros_priors(conn, version=999) is None),
        ],
    )


ROS_CASES: Final[tuple[tuple[str, Callable[[Connection, RosSetup], CaseResult]], ...]] = (
    ("ros-before-switch", _before_switch),
    ("ros-in-season", _in_season),
    ("ros-missing-artifact", _missing_artifact),
)


def run_ros_cases(engine: Engine) -> list[CaseResult]:
    """Every case on one read-only connection, with the inputs the nightly would read."""
    setup = ros_setup(engine, IN_SEASON, lambda line: None)
    with engine.connect() as conn:
        conn.exec_driver_sql("set transaction read only")
        return [case(conn, setup) for _, case in ROS_CASES]
