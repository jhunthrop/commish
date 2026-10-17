"""The round's refusals (3.2, 6.4): the judgment needs the lock and the amendments in the history, a
development record whose G2 and G6 pooled lines passed, and no claim or record; the check reads the
stop rule on G2 pooled and G6 pooled."""

from pathlib import Path
from typing import Any

import pytest

from research.errors import ConfigurationError
from research.model.weekly2.gates import GateLine
from research.model.weekly4.gates import DEVELOPMENT_CHECK, ROUND_FOUR
from research.model.weekly4.round import STOPPING, decision, stop_rule_refusal, thresholds_for


def _record(g2: bool, g6: bool) -> dict[str, Any]:
    return {
        "gates": [
            {"gate": "G2", "subject": "pooled vs recent form", "passed": g2},
            {"gate": "G6", "subject": "pooled vs the expert's spreadsheet", "passed": g6},
        ]
    }


def test_the_stop_rule_reads_g2_and_g6_pooled() -> None:
    assert stop_rule_refusal(_record(True, True)) is None
    assert "G2" in (stop_rule_refusal(_record(False, True)) or "")
    assert "G6" in (stop_rule_refusal(_record(True, False)) or "")
    assert "no development check record" in (stop_rule_refusal(None) or "")


def test_the_judgment_refuses_without_its_commits_its_check_or_once_taken() -> None:
    def never(_: Path) -> bool:
        return False

    assert thresholds_for("develop") == DEVELOPMENT_CHECK
    assert thresholds_for("judge", lambda: [], never, lambda: _record(True, True)) == ROUND_FOUR
    with pytest.raises(ConfigurationError, match="not in this tree"):
        thresholds_for("judge", lambda: ["b56c05d8"], never, lambda: _record(True, True))
    with pytest.raises(ConfigurationError, match="stop rule"):
        thresholds_for("judge", lambda: [], never, lambda: _record(False, True))
    with pytest.raises(ConfigurationError, match="taken once"):
        thresholds_for("judge", lambda: [], lambda _: True, lambda: _record(True, True))


def test_the_check_names_the_stopping_lines() -> None:
    passing = [GateLine(g, s, True, "") for g, s in STOPPING]
    assert decision("develop", passing).startswith("DEVELOPMENT CHECK")
    failing = [GateLine("G2", "pooled vs recent form", False, ""), passing[1]]
    assert decision("develop", failing).startswith("STOP RULE")
    assert decision("judge", failing).startswith("DECISION: a line failed")
