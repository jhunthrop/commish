"""THE CAPSULE FACTS CASES: the sheet the writer is given, oracle against port, exact.

    uv run python -m research.parity capsules <case>|all

Both sides read the dev copy (PARITY_SOURCE_DATABASE_URL), read only, at one instant: the oracle its
legacy `public` tables through its own `collectBoardFacts` and `collectPlayerFacts`, the port the
`research` schema the loader filled from them. Every field of every sheet is compared, the number and
name ledgers and the facts hash included (the hash is order-sensitive JSON, so equal hashes prove the
key order too), and the board pass's order and counts.
"""

import json
import os
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from sqlalchemy import Connection, create_engine

from research.capsules.facts.collect import collect_board_facts
from research.capsules.facts.collect_one import ServedBoardCache, collect_player_facts

# The oracle's ADP (the stats provider's): the one declared divergence of the product's sheets.
from research.capsules.facts.market_adp import MarketAdp
from research.capsules.facts.model import to_js
from research.db.url import sqlalchemy_url
from research.parity.model.compare import diff_rows
from research.parity.model.outcome import CaseResult, Claim
from research.parity.model.store import source_url

_REPO: Final = Path(__file__).resolve().parents[3]
_DRIVER: Final = _REPO / "research" / "parity" / "ts" / "capsules.ts"
AS_OF: Final = datetime(2026, 10, 13, tzinfo=UTC)
_TIMEOUT_SECONDS: Final = 1800
_SAMPLE_EVERY: Final = 45
# An id nobody holds: no sheet, on either side.
_NO_SHEET: Final = ("no-such-player",)


def _oracle(*args: str) -> list[Any]:
    completed = subprocess.run(
        ["npx", "tsx", str(_DRIVER), *args],
        cwd=_REPO,
        capture_output=True,
        text=True,
        timeout=_TIMEOUT_SECONDS,
        env={**os.environ, "DATABASE_URL": source_url()},
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"the oracle's capsules {args[0]} failed: {completed.stderr.strip()[-2000:]}")
    return [json.loads(line) for line in completed.stdout.splitlines() if line.startswith("{")]


def _read_only[T](read: Callable[[Connection], T]) -> T:
    engine = create_engine(sqlalchemy_url(source_url()))
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql("set transaction read only")
            return read(conn)
    finally:
        engine.dispose()


def _sections(by_id: Mapping[str, Mapping[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    """Each sheet as one row per top-level field, so a difference names its section."""
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for player_id, facts in by_id.items():
        for key, value in facts.items():
            out.setdefault(key, {})[player_id] = {"value": value}
    return out


def facts_board() -> CaseResult:
    oracle_lines = _oracle("board", AS_OF.isoformat().replace("+00:00", "Z"))
    oracle_facts = [line["facts"] for line in oracle_lines if "facts" in line]
    oracle_pass = next(line["pass"] for line in oracle_lines if "pass" in line)
    port = _read_only(lambda conn: collect_board_facts(conn, AS_OF, MarketAdp.ORACLE))
    port_facts = [to_js(facts) for facts in port.facts]
    left = _sections({f["identity"]["id"]: f for f in oracle_facts})
    right = _sections({f["identity"]["id"]: f for f in port_facts})
    diffs = [
        diff_rows(f"sheet {key}", left.get(key, {}), right.get(key, {}))
        for key in [*left, *(k for k in right if k not in left)]
    ]
    peers = {str(position): count for position, count in port.peer_count_by_position.items()}
    claims = [
        Claim(
            f"the pass's order: {len(oracle_facts)} sheets in the board's served order on both sides",
            [f["identity"]["id"] for f in oracle_facts] == [f["identity"]["id"] for f in port_facts],
        ),
        Claim(
            f"the prior season's story count, {oracle_pass['priorSeasonPlayerCount']}",
            oracle_pass["priorSeasonPlayerCount"] == port.prior_season_player_count,
        ),
        Claim(
            f"the active peers by position, {oracle_pass['peerCountByPosition']}",
            oracle_pass["peerCountByPosition"] == peers,
        ),
        Claim(
            "every facts hash equal",
            all(a["factsHash"] == b["factsHash"] for a, b in zip(oracle_facts, port_facts, strict=False)),
        ),
    ]
    return CaseResult("facts-board", diffs, claims=claims)


@dataclass(frozen=True, slots=True)
class _Sample:
    ids: tuple[str, ...]
    board: dict[str, dict[str, Any]]


def _sample() -> _Sample:
    board = _read_only(lambda conn: collect_board_facts(conn, AS_OF, MarketAdp.ORACLE))
    sheets = {facts.identity.id: to_js(facts) for facts in board.facts}
    chosen = list(sheets)[::_SAMPLE_EVERY]
    kicker = _read_only(
        lambda conn: conn.exec_driver_sql(
            "select id from research.provider_players where position = 'K' and adp is not null order by adp limit 1"
        ).scalar_one()
    )
    return _Sample((*chosen, str(kicker), *_NO_SHEET), sheets)


_KNOWN_DEFECT: Final = "is not one of the 32 product team codes"


def facts_one() -> CaseResult:
    """The narrow read, oracle against port. Where the oracle's narrow read throws on its own team-code
    defect (`depth_collect._depth_rows`), the port's sheet is compared with the oracle's board-pass
    sheet for the same player instead, the sheet the narrow read promises to equal."""
    sample = _sample()
    instant = AS_OF.isoformat().replace("+00:00", "Z")
    lines = _oracle("one", instant, *sample.ids)
    oracle = {line["id"]: line.get("facts") for line in lines}
    errors = {line["id"]: line["error"] for line in lines if "error" in line}
    oracle_board = {
        line["facts"]["identity"]["id"]: line["facts"] for line in _oracle("board", instant) if "facts" in line
    }
    served = ServedBoardCache()

    def port_one(conn: Connection) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for player_id in sample.ids:
            facts = collect_player_facts(conn, player_id, AS_OF, served, MarketAdp.ORACLE)
            out[player_id] = None if facts is None else to_js(facts)
        return out

    port = _read_only(port_one)
    expected = {pid: oracle_board.get(pid) if pid in errors else oracle.get(pid) for pid in sample.ids}
    left = {pid: {"facts": value} for pid, value in expected.items()}
    right = {pid: {"facts": value} for pid, value in port.items()}
    absent = [pid for pid in sample.ids if pid not in errors and oracle.get(pid) is None]
    claims = [
        Claim(
            f"{len(sample.ids)} ids asked: every {_SAMPLE_EVERY}th board player, a market-order kicker, an unknown id",
            len(lines) == len(sample.ids),
        ),
        Claim(f"no sheet for {', '.join(absent)}, on both sides", all(port.get(pid) is None for pid in absent)),
        Claim(
            f"the oracle's narrow read threw for {len(errors)} of {len(sample.ids)}, every time on its team-code defect",
            all(_KNOWN_DEFECT in message for message in errors.values()),
        ),
        Claim(
            "each port narrow read equals the board pass's sheet for the same player",
            all(port[pid] == sample.board[pid] for pid in sample.ids if port.get(pid) is not None),
        ),
    ]
    notes = [f"oracle narrow read threw for {pid}: {message[:120]}" for pid, message in errors.items()]
    direct = len(sample.ids) - len(errors) - len(absent)
    what = (
        f"collectPlayerFacts sheets: {len(errors)} of {len(sample.ids)} against the oracle's board-pass sheet "
        f"(its narrow read threw), {len(absent)} None on both sides ({', '.join(absent)}), "
        f"{direct} against the oracle's narrow read"
    )
    return CaseResult("facts-one", [diff_rows(what, left, right)], notes, claims=claims)


@dataclass(frozen=True, slots=True)
class CapsuleCase:
    name: str
    summary: str
    run: Callable[[], CaseResult]


CAPSULE_CASES: Final = (
    CapsuleCase(
        "facts-board", "the sweep's facts pass for every board player, every field, ledgers and hash", facts_board
    ),
    CapsuleCase("facts-one", "the narrow single-player read, and its equality with the board pass", facts_one),
)
