"""The served path's refusals and its register rows (sections 3.3 and 4): the refit runs only after a
judgment whose every line passed; a freeze writes a row only for a game still to kick off, a shadow
unless the run says it is counted."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pandas as pd
import pytest

from research.errors import ConfigurationError
from research.model.weekly4.live import LiveWeek, freeze_rows
from research.model.weekly4.serve import main

KICKOFF = datetime(2026, 10, 25, 17, 0, tzinfo=UTC)


def test_the_refit_refuses_without_a_passed_judgment(tmp_path: Path) -> None:
    record = tmp_path / "judgment.json"
    record.write_text(json.dumps({"command": "judge", "passed": False}))
    with pytest.raises(ConfigurationError, match="every line passed"):
        main(
            [
                "refit",
                "--database",
                "postgres://commish:commish@localhost:5433/lane70_weekly",
                "--features",
                str(tmp_path),
                "--record",
                str(record),
                "--version",
                "1",
            ]
        )


def _live() -> LiveWeek:
    board = pd.DataFrame(
        {
            "player_id": ["a", "b"],
            "game_id": ["g1", "g2"],
            "club": ["AAA", "BBB"],
            "questionable": [0, 1],
            **{f"point_{n}": [10.0, 8.0] for n in ("ppr", "half", "std")},
        }
    )
    bands = {p: dict.fromkeys(("ppr", "half", "std"), (3.0, 9.0, 18.0)) for p in ("a", "b")}
    why = {
        p: [{"group": "game", "points": 1.0, "text": "His team is expected to score 25", "read_at": "x"}]
        for p in ("a", "b")
    }
    kickoffs = {"g1": KICKOFF, "g2": KICKOFF - timedelta(hours=4)}
    return LiveWeek(2026, 8, board, bands, why, {"a": {"adp": 12.0}, "b": {"adp": None}}, kickoffs)


def test_a_freeze_writes_only_games_still_to_kick_off_and_a_shadow_unless_counted() -> None:
    frozen_at = KICKOFF - timedelta(hours=2)
    rows = freeze_rows(_live(), frozen_at, "digest", counted=False)
    assert [r["player_id"] for r in rows] == ["a"]
    row = rows[0]
    assert row["counted"] is False
    assert (row["point_ppr"], row["floor_ppr"], row["ceiling_ppr"]) == (10.0, 3.0, 18.0)
    assert json.loads(row["why"])[0]["group"] == "game"
    assert freeze_rows(_live(), frozen_at, "digest", counted=True)[0]["counted"] is True
