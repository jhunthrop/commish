"""Round 3's 26 lines must reproduce its committed record exactly before its number is a benchmark (6.3)."""

import json
from pathlib import Path

from research.model.weekly2.gates import GateLine
from research.model.weekly4.round_three import ROUND_THREE_RECORD, reproduction


def test_the_committed_record_reproduces_itself(tmp_path: Path) -> None:
    recorded = json.loads(ROUND_THREE_RECORD.read_text())["gates"]
    lines = [GateLine(r["gate"], r["subject"], r["passed"], r["detail"]) for r in recorded]
    assert len(lines) == 26  # noqa: PLR2004 - round 3's 26 lines
    assert reproduction(lines) == []
    moved = [*lines[:-1], GateLine("G5", "isolation", False, "moved")]
    assert len(reproduction(moved)) == 1
    record = tmp_path / "record.json"
    record.write_text(json.dumps({"gates": recorded[:3]}))
    assert reproduction(lines, record) == ["26 lines against 3 recorded"]
