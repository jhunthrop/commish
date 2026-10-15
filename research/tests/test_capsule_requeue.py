"""The one-shot rewrite of named pages (Lane 29): the public slugs resolve to the pages the build
serves, an unknown slug fails before anything is stamped, and the stamp is the regeneration queue's."""

from typing import Any, cast

import pytest
from sqlalchemy import Connection

from research.capsules import requeue
from research.capsules.store import REGENERATE_FACTS_HASH
from research.errors import ConfigurationError
from research.nightly.build.pages import Identity


def _identity(player_id: str, slug: str) -> Identity:
    return Identity(player_id, slug, slug, "WR", "LAR", None)


SERVED = (_identity("p1", "puka-nacua"), _identity("p2", "de-von-achane"), _identity("p3", "tre-harris"))


def test_slugs_resolve_to_the_served_pages_in_order() -> None:
    assert requeue.provider_ids_for(SERVED, ["tre-harris", "puka-nacua"]) == ["p3", "p1"]


def test_an_unknown_slug_fails_before_anything_is_stamped() -> None:
    with pytest.raises(ConfigurationError, match="najee-harris"):
        requeue.provider_ids_for(SERVED, ["puka-nacua", "najee-harris"])


def test_the_stamp_is_the_regeneration_queues(monkeypatch: pytest.MonkeyPatch) -> None:
    stamped: list[tuple[str, list[str]]] = []

    class _Conn:
        def execute(self, statement: Any, params: dict[str, Any]) -> Any:
            stamped.append((params["stale"], params["ids"]))
            return type("R", (), {"rowcount": len(params["ids"])})()

    monkeypatch.setattr(requeue, "served_identities", lambda conn, at: SERVED)
    monkeypatch.setattr(requeue, "universe_ids_for", lambda conn, ids: {pid: f"u-{pid}" for pid in ids})
    named = ["de-von-achane", "puka-nacua"]
    count = requeue.queue_slugs(cast("Connection", _Conn()), named, cast("Any", None))
    assert count == len(named)
    assert stamped == [(REGENERATE_FACTS_HASH, ["u-p2", "u-p1"])]
