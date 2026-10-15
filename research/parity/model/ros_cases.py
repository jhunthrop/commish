"""THE REST-OF-SEASON SWITCH, CASE BY CASE, on a `lane18_` scratch copy of dev (port 5433).

Each case assembles the run at one instant without the model's inputs (today's board) and with them,
as the nightly reads them (`run_parts.ros_setup`). Before the switch week the two runs are equal file
for file. From the first model week every board re-ranks the judged universe with no range: each preseason board
player keeps his preseason rank and points, each player with a line who was off the preseason board
is ranked with a null preseason rank, and the depth, basis and ADP gates pass. With the artifact or
the raw line missing the run is today's board again and says why. And the in-season boards from the
raw line the fit step kept equal those from the raw board rebuilt directly.

The copy must hold the fit step's raw line (`ros/raw-line`) and the artifact (`ros fit`). Its served
raw board must rebuild at its own moment, which a copy holding store changes made after that moment
(a later season ingest) refuses, as production would.

    uv run python -m research.parity ros --database postgres://commish:commish@localhost:5433/lane18_live
"""

import itertools
import json
from collections.abc import Callable, Mapping
from dataclasses import replace
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, Engine

from research.model.arithmetic import ARM64_BOARDS
from research.model.priors import load_model_artifacts
from research.model.ros.live import FIRST_MODEL_WEEK, load_ros_priors
from research.model.ros.raw_line import raw_generation, rebuild_raw_line
from research.nightly import gates
from research.nightly.assemble import Assembled, assemble
from research.nightly.build.ros import RosSetup
from research.nightly.build.season import format_json
from research.nightly.register_log import FrozenBy
from research.nightly.run_parts import ros_setup
from research.parity.model.compare import Diff
from research.parity.model.outcome import CaseResult, Claim
from research.season import PRODUCT_SEASON

# The Wednesday before the last preseason week (week 5 to play) and the Wednesday after (week 6 to play,
# the first model week). The claims below read the weeks from `FIRST_MODEL_WEEK`, never a literal.
BEFORE_SWITCH: Final = datetime.fromisoformat("2026-10-07T12:00:00+00:00")
IN_SEASON: Final = datetime.fromisoformat("2026-10-14T12:00:00+00:00")
_RANGE: Final = ("floor", "median", "ceiling")
Json = dict[str, Any]
Case = Callable[[Connection, RosSetup], CaseResult]


def _run(conn: Connection, instant: datetime, setup: RosSetup | None) -> Assembled:
    return assemble(conn, instant, FrozenBy({}), setup)


def _manifest_formats(run: Assembled) -> Json:
    return {f.id: format_json(f, PRODUCT_SEASON, run.rest if f.id in run.rest_formats else None) for f in run.formats}


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


def _before_switch(conn: Connection, _: RosSetup) -> CaseResult:
    setup = ros_setup(conn.engine, BEFORE_SWITCH, lambda line: None)
    today, switched = _run(conn, BEFORE_SWITCH, None), _run(conn, BEFORE_SWITCH, setup)
    return CaseResult(
        "ros-before-switch",
        [
            _files_diff("every file, a run dated before the switch week", today.files, switched.files),
            _files_diff("every format in the manifest", _manifest_formats(today), _manifest_formats(switched)),
        ],
        [f"status: {switched.rest_status}"],
        claims=[
            Claim("the run says the week is before the switch", f"before the switch week ({FIRST_MODEL_WEEK})" in switched.rest_status),
            Claim("the run reads no season players before the switch", setup.season_players == ()),
        ],
    )  # fmt: skip


def _in_season(conn: Connection, setup: RosSetup) -> CaseResult:
    today, switched = _run(conn, IN_SEASON, None), _run(conn, IN_SEASON, setup)
    before, after = _boards(today), _boards(switched)
    ranks = {path: {row["id"]: row["ourRank"] for row in rows} for path, rows in before.items()}
    on = [r for p, rows in after.items() for r in rows if r["id"] in ranks[p]]
    off = [r for p, rows in after.items() for r in rows if r["id"] not in ranks[p]]
    claims = [
        Claim(f"the rest of the season starts at week {FIRST_MODEL_WEEK}, lines through week {FIRST_MODEL_WEEK - 1}",
              switched.rest is not None
              and (switched.rest.from_week, switched.rest.through) == (FIRST_MODEL_WEEK, FIRST_MODEL_WEEK - 1)),
        Claim("every board re-ranks", all([r["id"] for r in after[p]][: len(before[p])] != [r["id"] for r in before[p]] for p in before)),
        Claim("every in-season row has no range", all(r[k] is None for rows in after.values() for r in rows for k in _RANGE)),
        Claim("every preseason board player keeps his preseason rank",
              all(r["preseasonRank"] == ranks[p][r["id"]] for p, rows in after.items() for r in rows if r["id"] in ranks[p])),
        Claim(f"players off the preseason board are ranked with no preseason rank ({len(off)} rows)",
              bool(off) and all(r["preseasonRank"] is None and r["preseasonPoints"] is None for r in off)),
        Claim("each board is in its order of points over replacement",
              all(all(a["vor"] >= b["vor"] for a, b in itertools.pairwise(rows)) for rows in after.values())),
        Claim(f"every format names the rest of the season from week {FIRST_MODEL_WEEK}",
              all(f"rest of the 2026 season from week {FIRST_MODEL_WEEK}" in f["basis"][0] for f in _manifest_formats(switched).values())),
        Claim("the index is in the board's order",
              [e["id"] for e in switched.files["index.json"]][:10] == [r["id"] for r in after["boards/ppr-12.json"]][:10]),
        *_gates_pass(switched),
    ]  # fmt: skip
    diffs = [
        _files_diff(f"{p}: every preseason board player still ranked", dict.fromkeys(ranks[p], 1), {r["id"]: 1 for r in after[p] if r["id"] in ranks[p]})
        for p in sorted(before)
    ]  # fmt: skip
    notes = [
        f"status: {switched.rest_status}",
        f"{len(on)} preseason rows and {len(off)} off-board rows across the boards",
    ]
    return CaseResult("ros-in-season", diffs, notes, claims=claims)


def _missing_inputs(conn: Connection, setup: RosSetup) -> CaseResult:
    today = _run(conn, IN_SEASON, None)
    no_artifact = _run(conn, IN_SEASON, replace(setup, priors=None))
    no_line = _run(conn, IN_SEASON, replace(setup, raw=None))
    return CaseResult(
        "ros-missing-inputs",
        [
            _files_diff("every file, an in-season run with no artifact", today.files, no_artifact.files),
            _files_diff("every file, an in-season run with no raw line", today.files, no_line.files),
        ],
        [f"status: {no_artifact.rest_status}", f"status: {no_line.rest_status}"],
        claims=[
            Claim("the run says the artifact is missing", "artifact is not in the store" in no_artifact.rest_status),
            Claim("the run says the raw line is missing", "raw line for the season's raw board is not in the store" in no_line.rest_status),
            Claim("a version the store does not hold reads as missing", load_ros_priors(conn, version=999) is None),
        ],
    )  # fmt: skip


def _stored_line(conn: Connection, setup: RosSetup) -> CaseResult:
    """The boards from the kept raw line against the boards from the raw board rebuilt directly."""
    moment = raw_generation(conn, PRODUCT_SEASON)
    direct = (
        None
        if moment is None
        else rebuild_raw_line(conn, PRODUCT_SEASON, moment, load_model_artifacts(conn), ARM64_BOARDS)
    )
    if direct is None or isinstance(direct, str) or setup.raw is None:
        why = "no raw generation" if moment is None else ("no kept line" if setup.raw is None else str(direct))
        return CaseResult("ros-stored-line", [], [f"cannot compare: {why}"], claims=[Claim("both lines exist", False)])
    stored, rebuilt = _run(conn, IN_SEASON, setup), _run(conn, IN_SEASON, replace(setup, raw=direct))
    return CaseResult(
        "ros-stored-line",
        [
            _files_diff("the raw line, kept against rebuilt, by player", setup.raw.per_game, direct.per_game),
            _files_diff("every file, from the kept line against the rebuilt one", stored.files, rebuilt.files),
        ],
        [f"kept line {setup.raw.as_of} by {setup.raw.model_version}"],
    )  # fmt: skip


ROS_CASES: Final[tuple[tuple[str, Case], ...]] = (
    ("ros-before-switch", _before_switch),
    ("ros-in-season", _in_season),
    ("ros-missing-inputs", _missing_inputs),
    ("ros-stored-line", _stored_line),
)


def run_ros_cases(engine: Engine) -> list[CaseResult]:
    """Every case on one read-only connection, with the inputs the nightly would read."""
    setup = ros_setup(engine, IN_SEASON, lambda line: None)
    with engine.connect() as conn:
        conn.exec_driver_sql("set transaction read only")
        return [case(conn, setup) for _, case in ROS_CASES]
