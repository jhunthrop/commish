"""The scoring parity fixture: research's compute_fantasy_points scores each stat line as the file
says, and the api scores the same file (api/internal/inseason/score_test.go), kept byte for byte in
both places."""

import json
from pathlib import Path
from typing import Final, cast

import pytest

from research.model.domain import POSITIONS, SCORING_PRESETS, Position, StatLine, compute_fantasy_points

_HERE: Final = Path(__file__).resolve().parent / "testdata" / "scoring-parity.json"
_API: Final = Path(__file__).resolve().parents[2] / "api" / "internal" / "inseason" / "testdata" / "scoring-parity.json"
_CASES: Final = json.loads(_HERE.read_text())["cases"]


def test_the_api_keeps_the_same_file() -> None:
    assert _API.read_bytes() == _HERE.read_bytes()


@pytest.mark.parametrize("case", _CASES, ids=[case["name"] for case in _CASES])
def test_each_line_scores_as_the_file_says(case: dict[str, object]) -> None:
    position = cast(Position, case["position"])
    assert position in POSITIONS
    metrics = cast(dict[str, float], case["metrics"])
    line = StatLine(player_id="fixture", week=1, **{k: float(v) for k, v in metrics.items()})
    assert compute_fantasy_points(line, position, SCORING_PRESETS[str(case["rules"])]) == case["points"]
