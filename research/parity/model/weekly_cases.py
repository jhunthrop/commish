"""THE WEEKLY MODEL'S CASES: the oracle's weekly projection and its shipped fits, against the port.

The oracle never stored a weekly board (its weekly model ran inside `replay` and its reports, and
the register froze the season boards week by week), so there are no stored weekly rows to compare
against. These cases compare the oracle running against the port running, every field exact:

- `weekly-projection-2025`: four weeks of 2025 through the oracle's own `replay` on the dev copy's
  legacy schema and through the port's reads of its research schema (the two hold the same 2024 and
  2025 rows, row for row). 2025 has no published weekly file, so neither side sees an in-season
  stat line or a target count there: the reads, the snap-share form, scheme and game context are
  what this case proves.
- `weekly-layers-2024`: four weeks of 2024, the port's reads handed to the oracle's
  `modelProjection` as JSON, so the in-season shares and rates are exercised on a season with every
  count (the legacy schema lacks most of 2023, so the oracle cannot read 2024's prior season).
- `weekly-fit`: the oracle's four shipped fits and the port's on the same inputs, 2021 and 2022 with
  2020 as history (the oracle's own seasons), every fitted number.
"""

import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, Final

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.model.arithmetic import ARM64_BOARDS
from research.model.artifacts import read_artifact
from research.model.domain import STAT_FIELDS, snake_to_camel
from research.model.instants import js_iso
from research.model.weekly.fit_data import fit_weekly_priors, read_fit_data
from research.model.weekly.inputs import ORACLE_READER, load_week, week_moment
from research.model.weekly.model import WeeklyPriors, project_week, weekly_priors_from, weekly_priors_payload
from research.model.weekly.teams import oracle_latest_teams
from research.parity.model.compare import Diff, diff_rows
from research.parity.model.outcome import CaseResult, Claim
from research.parity.model.sides import OracleRun, run_oracle
from research.parity.model.store import source_url
from research.parity.model.weekly_json import write_fit, write_week

PROJECTION_WEEKS_2025: Final = (1, 6, 11, 17)
LAYER_WEEKS_2024: Final = (2, 7, 12, 16)
FIT_SEASONS: Final = (2021, 2022)
FIT_HISTORY: Final = (2020,)
FIT_HELD_OUT: Final = (2023, 2024)
_TIMEOUT_SECONDS: Final = 900
# The oracle searches 720 grid cells over two seasons of weekly predictions.
_FIT_TIMEOUT_SECONDS: Final = 7200


def _lines_by_player(lines: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(line["playerId"]): {name: line[snake_to_camel(name)] for name in STAT_FIELDS} for line in lines}


def _port_lines(season: int, week: int, priors_of: Callable[[Any], WeeklyPriors]) -> tuple[str, dict[str, Any]]:
    engine = make_engine(sqlalchemy_url(source_url()))
    with engine.connect() as conn:
        at = week_moment(conn, season, week)
        data = load_week(conn, season, week, at, ORACLE_READER)
        projections = project_week(data, priors_of(conn), teams_of=oracle_latest_teams)
    engine.dispose()
    return js_iso(at), {p.line.player_id: {name: getattr(p.line, name) for name in STAT_FIELDS} for p in projections}


def _published_priors(conn: Any) -> WeeklyPriors:
    return weekly_priors_from(read_artifact(conn, "model/weekly-priors").payload)


def weekly_projection_2025() -> CaseResult:
    diffs: list[Diff] = []
    errors: list[str] = []
    for week in PROJECTION_WEEKS_2025:
        at, mine = _port_lines(2025, week, _published_priors)
        oracle = run_oracle_weekly("project", "2025", str(week), at)
        if oracle.error is not None:
            errors.append(f"week {week}: {oracle.error}")
        theirs = _lines_by_player(oracle.lines[0]["lines"] if oracle.lines else [])
        diffs.append(diff_rows(f"2025 week {week} at {at}: every stat field", theirs, mine))
    notes = [f"week {week}: {d.left_rows} players" for week, d in zip(PROJECTION_WEEKS_2025, diffs, strict=True)]
    return CaseResult("weekly-projection-2025", diffs, [*notes, *errors], not errors)


def weekly_layers_2024() -> CaseResult:
    diffs: list[Diff] = []
    errors: list[str] = []
    engine = make_engine(sqlalchemy_url(source_url()))
    with tempfile.TemporaryDirectory() as scratch, engine.connect() as conn:
        priors = _published_priors(conn)
        for week in LAYER_WEEKS_2024:
            data = load_week(conn, 2024, week, week_moment(conn, 2024, week), ORACLE_READER)
            mine = {
                p.line.player_id: {name: getattr(p.line, name) for name in STAT_FIELDS}
                for p in project_week(data, priors, teams_of=oracle_latest_teams)
            }
            oracle = run_oracle_weekly("layers", str(write_week(Path(scratch) / f"week-{week}.json", data)))
            if oracle.error is not None:
                errors.append(f"week {week}: {oracle.error}")
            theirs = _lines_by_player(oracle.lines[0]["lines"] if oracle.lines else [])
            diffs.append(diff_rows(f"2024 week {week} at {js_iso(data.as_of)}: every stat field", theirs, mine))
    engine.dispose()
    notes = [f"week {week}: {d.left_rows} players" for week, d in zip(LAYER_WEEKS_2024, diffs, strict=True)]
    return CaseResult("weekly-layers-2024", diffs, [*notes, *errors], not errors)


def _fit_cells(fitted: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Every fitted number, flattened to one row per group: `group -> {path: value}`."""
    cells: dict[str, dict[str, Any]] = {}

    def walk(group: str, prefix: str, value: Any) -> None:
        if isinstance(value, dict):
            for key in sorted(value):
                walk(group, f"{prefix}.{key}" if prefix else key, value[key])
        else:
            cells.setdefault(group, {})[prefix] = value

    for group in ("opportunity", "efficiency", "scheme", "gameContext"):
        walk(group, "", fitted.get(group, {}))
    cells["search"] = {"rmse": fitted.get("rmse")}
    return cells


def weekly_fit() -> CaseResult:
    engine = make_engine(sqlalchemy_url(source_url()))
    with tempfile.TemporaryDirectory() as scratch, engine.connect() as conn:
        data = read_fit_data(conn, (*FIT_HISTORY, *FIT_SEASONS), ORACLE_READER)
        mine = fit_weekly_priors(data, FIT_SEASONS, FIT_HELD_OUT, ARM64_BOARDS)
        path = write_fit(
            Path(scratch) / "fit.json",
            FIT_SEASONS,
            FIT_HELD_OUT,
            data.usage,
            data.history,
            data.positions,
            data.context,
        )
        oracle = run_oracle_weekly("fit", str(path), timeout=_FIT_TIMEOUT_SECONDS)
    engine.dispose()
    theirs = _fit_cells(oracle.lines[0] if oracle.lines else {})
    payload = weekly_priors_payload(mine.priors)
    ours = _fit_cells({**payload, **payload["context"], "rmse": mine.share_rmse})
    claims = [Claim("the oracle's fit ran to completion", oracle.error is None)]
    notes = [
        f"chosen cell: decay {mine.priors.opportunity.recency_decay}, shrinkage {mine.priors.opportunity.shrinkage}"
    ]
    return CaseResult("weekly-fit", [diff_rows("every fitted number, by group", theirs, ours)], notes, True, claims)


def run_oracle_weekly(*args: str, timeout: int = _TIMEOUT_SECONDS) -> OracleRun:
    """`ts/weekly.ts <args>` against the dev copy (read only: `project` reads, the others read nothing)."""
    return run_oracle(source_url(), *args, driver="weekly.ts", timeout=timeout)
