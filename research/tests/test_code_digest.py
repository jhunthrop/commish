"""The read cache's code version: the cached read's own modules and what they import, and no more."""

import ast
from pathlib import Path

from research.db.code_digest import code_digest, import_closure

_HISTORY = "research.capsules.facts.history"
_BACKTEST = "research.model.backtest"


def test_the_closure_reaches_what_a_cached_read_runs_and_stops_at_the_package() -> None:
    names = set(import_closure([_HISTORY]))
    assert {
        _HISTORY,
        "research.capsules.facts.color",
        "research.model.reads.observations",
        "research.model.laws.discovery_facts",
        "research.db.value_codec",
        "research",
        "research.capsules",
    } <= names
    assert "research.nightly.run" not in names, "the nightly's own code is not a cached read's"
    assert "research.capsules.generate" not in names, "nor the writer's"


def test_a_module_reached_only_for_a_constant_is_in_the_closure() -> None:
    """Review MEDIUM-1: these are imported for plain values, which carry no `__module__`."""
    assert {"research.pipeline.preseason.rosters", "research.model.market.curve", "research.db.schema"} <= set(
        import_closure([_HISTORY])
    )
    assert {"research.pipeline.nflverse.config", "research.pipeline.nflverse.csv"} <= set(import_closure([_BACKTEST]))


def test_every_research_import_in_the_closure_is_in_the_closure() -> None:
    closure = import_closure([_HISTORY, _BACKTEST])
    for path in closure.values():
        for node in ast.walk(ast.parse(Path(path).read_text())):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("research"):
                assert node.module in closure, f"{path} imports {node.module}"


def test_the_digest_is_stable_and_differs_by_root() -> None:
    assert code_digest(_HISTORY) == code_digest(_HISTORY)
    assert code_digest(_HISTORY) != code_digest(_BACKTEST)
