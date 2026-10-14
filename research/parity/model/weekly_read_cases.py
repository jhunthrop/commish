"""THE WEEKLY FIT'S READS: the port's `read_fit_data` against the oracle fit script's own reads.

`weekly-fit` proves the four fit procedures on identical inputs, the inputs the port read. This
case proves those reads: `projection-fit.ts`'s `usageForSeasons`, `historyForSeasons` and
`contextForSeasons` (every season at the far future) run by the oracle on the dev copy's legacy
schema, against `read_fit_data` with the oracle's reader on its research schema, row for row and
field for field. The seasons are 2024 and 2025, the two the legacy schema still holds whole and
identical to the research schema; the fit seasons themselves (2020-2024) are read by the same
functions, which the legacy schema can no longer show for 2020-2023.
"""

from typing import Any, Final

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.model.weekly.fit_data import read_fit_data
from research.model.weekly.inputs import ORACLE_READER
from research.parity.model.compare import Diff, diff_rows
from research.parity.model.outcome import CaseResult
from research.parity.model.sides import run_oracle
from research.parity.model.store import source_url
from research.parity.model.weekly_json import context_json, line_json, usage_json

READ_SEASONS: Final = (2024, 2025)
_USAGE_KEYS: Final = (
    "snapShare",
    "targetShare",
    "carryShare",
    "passAttemptShare",
    "targets",
    "carries",
    "passAttempts",
    "teamTargets",
    "teamCarries",
    "teamPassAttempts",
    "asOf",
)


def _usage(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {f"{r['season']}|{r['week']}|{r['playerId']}": {k: r.get(k) for k in _USAGE_KEYS} for r in rows}


def _lines(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        f"{r['season']}|{r['line']['week']}|{r['line']['playerId']}": {**r["line"], "asOf": r["asOf"]} for r in rows
    }


def _edges(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {f"{r['season']}|{r['week']}|{r['playerId']}": {"team": r["team"], "asOf": r["asOf"]} for r in rows}


def _facts(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        f"{r['season']}|{r['week']}|{r['team']}|{r['source']}|{r['metric']}": {"value": r["value"], "asOf": r["asOf"]}
        for r in rows
    }


def weekly_fit_reads() -> CaseResult:
    seasons = [str(season) for season in READ_SEASONS]
    oracle = run_oracle(source_url(), "fit-reads", *seasons, driver="weekly.ts")
    engine = make_engine(sqlalchemy_url(source_url()))
    with engine.connect() as conn:
        data = read_fit_data(conn, READ_SEASONS, ORACLE_READER)
    engine.dispose()
    theirs: dict[str, Any] = oracle.lines[0] if oracle.lines else {}
    context = context_json(data.context)
    label = "-".join(seasons)
    diffs: list[Diff] = [
        diff_rows(f"{label} usage", _usage(theirs.get("usage", [])), _usage([usage_json(r) for r in data.usage])),
        diff_rows(
            f"{label} stat lines", _lines(theirs.get("history", [])), _lines([line_json(r) for r in data.history])
        ),
        diff_rows(f"{label} club edges", _edges(theirs.get("playerTeams", [])), _edges(context["playerTeams"])),
        diff_rows(
            f"{label} team facts", _facts(theirs.get("teamObservations", [])), _facts(context["teamObservations"])
        ),
    ]
    notes = [f"oracle {oracle.error}" if oracle.error else f"rows compared on {label}, every field"]
    return CaseResult("weekly-fit-reads", diffs, notes, oracle.error is None)
