"""The record fixtures' grading days are the writer's (Lane 250 review L1): every set week the apps and
shots read with a `gradesFrom` carries what `week_complete.grades_from` writes for that week's last
kickoff on the contract schedule, never a stamp from a retired rule."""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Final

from research.inseason.week_complete import grades_from
from research.model.instants import js_iso

_ROOT: Final = Path(__file__).resolve().parents[2]
_SCHEDULE: Final = _ROOT / "shared" / "fixtures" / "run" / "runs" / "2026-10-21T12-ros" / "schedule.json"
_RECORDS: Final = _ROOT / "shared" / "fixtures" / "record"


def _last_kickoffs() -> dict[int, datetime]:
    schedule = json.loads(_SCHEDULE.read_text())
    out: dict[int, datetime] = {}
    for slate in schedule["slates"]:
        for game in slate["games"]:
            kickoff = datetime.fromisoformat(game["kickoff"])
            out[game["week"]] = max(out.get(game["week"], kickoff), kickoff)
    return out


def _dated_weeks(record: dict[str, Any]) -> list[tuple[str, int, str]]:
    weekly = record.get("weekly") or {"weeks": []}
    return [
        (where, week["week"], week["gradesFrom"])
        for where, weeks in (("record", record["weeks"]), ("weekly", weekly["weeks"]))
        for week in weeks
        if "gradesFrom" in week
    ]


def test_every_fixture_grading_day_is_the_writers() -> None:
    ends = _last_kickoffs()
    seen = []
    for path in sorted(_RECORDS.glob("*.json")):
        for where, week, written in _dated_weeks(json.loads(path.read_text())):
            seen.append((path.name, where, week))
            assert written == js_iso(grades_from(ends[week])), (path.name, where, week)
    # The waiting record's week 6 and the set weekly record's week 7 are both held.
    assert ("waiting.json", "record", 6) in seen
    assert ("set.json", "weekly", 7) in seen
