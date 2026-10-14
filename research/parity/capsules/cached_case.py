"""THE CACHED FACTS CASE: the board pass through the read cache equals the pass without it.

The nightly reads the board facts pass's finished seasons through the read cache (`facts.history`,
`db.read_cache`); every other surface and the recorded cases read without it. This case builds the
pass three ways on the dev copy at `AS_OF`, uncached, through a cold cache (every history read
read and kept) and through the warm one (every history read served), each on its own read-only
snapshot, and holds all three to one another, every sheet field by field (review MEDIUM-3). The
kept results go to a scratch store of their own (`parity_capsules_read_cache`), never the dev copy.
"""

from typing import Any, Final

from sqlalchemy import Engine, create_engine

from research.capsules.facts.collect import collect_board_facts
from research.capsules.facts.history import HISTORY_CODEC
from research.capsules.facts.model import to_js
from research.db.read_cache import UNCACHED, ReadCache, ReadThrough, snapshot
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.parity.capsules.cases import AS_OF
from research.parity.model.compare import diff_rows
from research.parity.model.outcome import CaseResult, Claim
from research.parity.model.store import source_url

_STORE: Final = "parity_capsules_read_cache"
_CODE: Final = "parity"
Sheets = dict[str, dict[str, Any]]


def _sheets(source: Engine, history: ReadThrough) -> Sheets:
    with snapshot(source) as conn:
        board = collect_board_facts(conn, AS_OF, history)
    return {facts.identity.id: {"sheet": to_js(facts)} for facts in board.facts}


def _cold_and_warm(source: Engine) -> tuple[tuple[Sheets, Sheets], list[str]]:
    """The pass through a cold cache and then the warm one, with the cache's lines."""
    store = create_engine(sqlalchemy_url(databases.build_with_alembic(_STORE)))
    lines: list[str] = []
    try:
        cache = ReadCache(store, HISTORY_CODEC, _CODE, lines.append)
        return (_sheets(source, cache), _sheets(source, cache)), lines
    finally:
        store.dispose()
        databases.drop(_STORE)


def facts_cached() -> CaseResult:
    source = create_engine(sqlalchemy_url(source_url()))
    try:
        plain = _sheets(source, UNCACHED)
        (cold, warm), lines = _cold_and_warm(source)
    finally:
        source.dispose()
    kept = [line for line in lines if line.endswith("statements)")]
    served = [line for line in lines if line.endswith(" served")]
    claims = [
        Claim(
            f"the cold pass kept every history read ({len(kept)})",
            len(kept) > 0 and not any("not kept" in x for x in lines),
        ),
        Claim(f"the warm pass served every one ({len(served)})", len(served) == len(kept)),
    ]
    return CaseResult(
        "facts-cached",
        [
            diff_rows("every sheet, uncached against a cold cache", plain, cold),
            diff_rows("every sheet, uncached against a warm cache", plain, warm),
        ],
        claims=claims,
    )
