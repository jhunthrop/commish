"""The read cache's code version: the cached read's own modules and what they import, and no more."""

from research.capsules.facts import history
from research.db.code_digest import code_digest, import_closure
from research.model import backtest


def test_the_closure_reaches_what_a_cached_read_runs_and_stops_at_the_package() -> None:
    names = {module.__name__ for module in import_closure([history])}
    assert {
        "research.capsules.facts.history",
        "research.capsules.facts.color",
        "research.model.reads.observations",
        "research.model.laws.discovery_facts",
        "research.db.value_codec",
    } <= names
    assert "research.nightly.run" not in names, "the nightly's own code is not a cached read's"
    assert "research.capsules.generate" not in names, "nor the writer's"
    assert all(name.startswith("research.") for name in names)


def test_the_digest_is_stable_and_differs_by_root() -> None:
    assert code_digest(history.__name__) == code_digest(history.__name__)
    assert code_digest(history.__name__) != code_digest(backtest.__name__)
