"""THE REGISTER'S TRAIL IN THE BUCKET: which run froze each week, and how the last weekly pass went.

Two objects beside the runs, so the record's `frozenBy` names a run that exists in R2 and a failed
weekly pass reaches the nightly's manifest:

- `register/frozen-by.json`: per season and week, the run id that froze it. The weekly pass
  (`research.inseason`) claims its own run id (`<hour>-weekly`, `runs/<id>/inseason.json` holds its
  lines) and records it when it freezes. A week frozen before this code (2026 weeks 1 and 2, by the
  TypeScript register) is carried forward by the first nightly run that passes with it, which is
  then the run that names it, with a note in that run's manifest.
- `register/last-pass.json`: the weekly pass's last outcome, every step's line, failed or not. The
  nightly copies it into its manifest (`register`), so a failed freeze is in the run as well as in the
  failed job execution and its alert.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from research.model.instants import js_iso
from research.nightly.run_store import JSON_TYPE, RunStore

FROZEN_BY_KEY: Final = "register/frozen-by.json"
LAST_PASS_KEY: Final = "register/last-pass.json"
WEEKLY_SUFFIX: Final = "weekly"
Json = dict[str, Any]


def _key(season: int, week: int) -> str:
    return f"{season}-{week}"


def _read(store: RunStore, key: str) -> Json:
    raw = store.get(key)
    return {} if raw is None else dict(json.loads(raw))


def _write(store: RunStore, key: str, value: Json) -> None:
    store.put(key, json.dumps(value, separators=(",", ":"), sort_keys=True).encode(), JSON_TYPE)


@dataclass(frozen=True, slots=True)
class FrozenBy:
    """Season-week to the run id that froze it, as stored, with what tonight's run carried forward."""

    by_week: Mapping[str, Json]
    carried: tuple[int, ...] = ()

    def run_id(self, season: int, week: int) -> str | None:
        entry = self.by_week.get(_key(season, week))
        return None if entry is None else str(entry["runId"])


def read_frozen_by(store: RunStore) -> FrozenBy:
    return FrozenBy(_read(store, FROZEN_BY_KEY))


def carry_forward(frozen_by: FrozenBy, season: int, frozen_weeks: Mapping[int, str], run_id: str) -> FrozenBy:
    """Every frozen week the trail does not name yet (week to the implementation that froze it) is
    named by this run, as the run carrying it."""
    carried = tuple(week for week in sorted(frozen_weeks) if frozen_by.run_id(season, week) is None)
    entries = dict(frozen_by.by_week)
    for week in carried:
        entries[_key(season, week)] = {"runId": run_id, "carried": True, "implementation": frozen_weeks[week]}
    return FrozenBy(entries, carried)


def carried_note(frozen_by: FrozenBy, season: int, run_id: str) -> str | None:
    """The manifest's sentence for the weeks this run carried forward, by who froze them."""
    if not frozen_by.carried:
        return None
    by_code: dict[str, list[str]] = {}
    for week in frozen_by.carried:
        code = str(frozen_by.by_week[_key(season, week)]["implementation"])
        by_code.setdefault(code, []).append(str(week))
    parts = [f"week {', '.join(weeks)} by the {code} register" for code, weeks in sorted(by_code.items())]
    return (
        f"The {season} freezes of {'; '.join(parts)} were taken before this trail began; run {run_id} is the "
        "first to carry them, so the record names it."
    )


def save_frozen_by(store: RunStore, frozen_by: FrozenBy) -> None:
    _write(store, FROZEN_BY_KEY, dict(frozen_by.by_week))


def record_freeze(store: RunStore, season: int, week: int, run_id: str, frozen_at: datetime) -> None:
    """The weekly pass's freeze, named by the pass's own run id."""
    entries = _read(store, FROZEN_BY_KEY)
    entries[_key(season, week)] = {"runId": run_id, "frozenAt": js_iso(frozen_at)}
    _write(store, FROZEN_BY_KEY, entries)


def record_pass(store: RunStore, run_id: str, at: datetime, lines: Sequence[Json]) -> None:
    """The weekly pass's outcome, its lines under its run id and as the register's last pass."""
    failed = [line for line in lines if line.get("status") == "failed"]
    outcome = {"runId": run_id, "at": js_iso(at), "status": "failed" if failed else "ok", "steps": list(lines)}
    _write(store, f"runs/{run_id}/inseason.json", outcome)
    _write(store, LAST_PASS_KEY, outcome)


def last_pass(store: RunStore) -> Json | None:
    raw = store.get(LAST_PASS_KEY)
    return None if raw is None else dict(json.loads(raw))
