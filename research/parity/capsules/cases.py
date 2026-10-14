"""THE CAPSULE FACTS CASES: the sheet the writer is given, against a recording of it, exact. A
self-regression check against the port's own recording, not parity with the oracle: it catches a change
in the port's facts, never an error the port shares with its recording.

    uv run python -m research.parity capsules <case>|all
    uv run python -m research.parity capsules record

Phase D fix round 3 re-recorded these cases. They once compared the port with the TypeScript oracle
live, but the oracle reads the legacy `public` tables, which stopped moving when the nightly took
over (its injury captures, news and history no longer match the store), and fix round 3 changed the
facts hash itself (an injury status is dated by its capture's Eastern day, `facts.reference`). The
oracle retires at cutover. What the cases now hold is the port against `fixtures/capsules-facts/
record.json`, a recording of the port's own board pass on the dev copy at `AS_OF`, with the
product's sheet (the run's ADP and board ranks, `facts.market_adp`):

- `facts-board`: every board player's facts hash (the hash is over every content field, in order),
  and every field of a sample of sheets (every 45th), ledgers included, so a difference names its
  section; the pass's order and counts.
- `facts-one`: the narrow single-player read for the sample, a market-order kicker and an unknown id,
  equal to the recorded sheet and to the board pass's sheet for the same player.

Lane 17 re-recorded them once more: a sheet now carries this season so far as the player page
prints it (`facts.season_so_far`, the in-season voice of the live review's H2) in place of the
provider's season lines, so every facts hash moved by design; and the season block reads the store
as of `AS_OF` like every other read here.

There is no pre-kickoff case: `AS_OF` is in season, and the 2026 preseason is no longer the store's
as-of view of anything the cases hold (an as-of before 2026-09-10 would read a board, captures and
ADP the dev copy was not recorded against). The preseason voice is held by the unit tests instead
(`tests/test_capsule_voice_switch.py`: the kickoff boundary, the preseason sheet lines and rules).

Both read the dev copy (PARITY_SOURCE_DATABASE_URL), read only, as of `AS_OF`: every capture and
observation after it is ignored, so a later nightly does not move them. An ingest that writes rows
stamped before `AS_OF` (a history rebuild) does; then `capsules record` writes the recording again,
and the report says why.
"""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from sqlalchemy import Connection, create_engine

from research.capsules.facts.collect import BoardFactsPass, collect_board_facts
from research.capsules.facts.collect_one import ServedBoardCache, collect_player_facts
from research.capsules.facts.model import to_js
from research.db.url import sqlalchemy_url
from research.parity.model.compare import diff_rows
from research.parity.model.outcome import CaseResult, Claim
from research.parity.model.store import source_url

AS_OF: Final = datetime(2026, 10, 13, tzinfo=UTC)
RECORD: Final = Path(__file__).resolve().parents[1] / "fixtures" / "capsules-facts" / "record.json"
_SAMPLE_EVERY: Final = 45
# An id nobody holds: no sheet, on either side.
_NO_SHEET: Final = "no-such-player"


def _read_only[T](read: Callable[[Connection], T]) -> T:
    engine = create_engine(sqlalchemy_url(source_url()))
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql("set transaction read only")
            return read(conn)
    finally:
        engine.dispose()


def _board() -> BoardFactsPass:
    return _read_only(lambda conn: collect_board_facts(conn, AS_OF))


def _pass_counts(board: BoardFactsPass) -> dict[str, Any]:
    return {
        "order": [facts.identity.id for facts in board.facts],
        "priorSeasonPlayerCount": board.prior_season_player_count,
        "peerCountByPosition": {str(position): count for position, count in board.peer_count_by_position.items()},
    }


def _kicker() -> str:
    return str(
        _read_only(
            lambda conn: conn.exec_driver_sql(
                "select id from research.provider_players where position = 'K' and adp is not null order by adp limit 1"
            ).scalar_one()
        )
    )


def record() -> Path:
    """Writes the recording from the dev copy as it stands: the pass, every hash, the sample's sheets."""
    board = _board()
    sheets = {facts.identity.id: to_js(facts) for facts in board.facts}
    sample = [*list(sheets)[::_SAMPLE_EVERY], _kicker()]
    recording = {
        "asOf": AS_OF.isoformat().replace("+00:00", "Z"),
        "recordedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "pass": _pass_counts(board),
        "hashes": {player_id: sheet["factsHash"] for player_id, sheet in sheets.items()},
        "sample": {player_id: sheets.get(player_id) for player_id in sample},
    }
    RECORD.parent.mkdir(parents=True, exist_ok=True)
    RECORD.write_text(json.dumps(recording, indent=1, sort_keys=True) + "\n")
    return RECORD


def _recording() -> dict[str, Any]:
    return dict(json.loads(RECORD.read_text()))


def _sections(by_id: Mapping[str, Mapping[str, Any] | None]) -> dict[str, dict[str, dict[str, Any]]]:
    """Each sheet as one row per top-level field, so a difference names its section."""
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for player_id, facts in by_id.items():
        for key, value in (facts or {}).items():
            out.setdefault(key, {})[player_id] = {"value": value}
    return out


def facts_board() -> CaseResult:
    recorded = _recording()
    board = _board()
    sheets = {facts.identity.id: to_js(facts) for facts in board.facts}
    hashes = {pid: {"factsHash": h} for pid, h in recorded["hashes"].items()}
    port_hashes = {pid: {"factsHash": sheet["factsHash"]} for pid, sheet in sheets.items()}
    left = _sections(recorded["sample"])
    right = _sections({pid: sheets.get(pid) for pid in recorded["sample"]})
    diffs = [diff_rows(f"every board sheet's facts hash, recorded at {recorded['recordedAt']}", hashes, port_hashes)]
    diffs += [diff_rows(f"sample sheet {key}", left[key], right.get(key, {})) for key in left]
    counts = _pass_counts(board)
    claims = [
        Claim(
            f"the pass's order: {len(recorded['pass']['order'])} sheets", recorded["pass"]["order"] == counts["order"]
        ),
        Claim(
            f"the prior season's story count, {recorded['pass']['priorSeasonPlayerCount']}",
            recorded["pass"]["priorSeasonPlayerCount"] == counts["priorSeasonPlayerCount"],
        ),
        Claim(
            f"the active peers by position, {recorded['pass']['peerCountByPosition']}",
            recorded["pass"]["peerCountByPosition"] == counts["peerCountByPosition"],
        ),
    ]
    return CaseResult("facts-board", diffs, claims=claims)


@dataclass(frozen=True, slots=True)
class _Sample:
    ids: tuple[str, ...]
    recorded: dict[str, Any]
    board: dict[str, dict[str, Any]]


def facts_one() -> CaseResult:
    """The narrow read for the sample, against the recording and against the board pass's sheet."""
    recorded = _recording()["sample"]
    sample = _Sample((*recorded, _NO_SHEET), recorded, {f.identity.id: to_js(f) for f in _board().facts})
    served = ServedBoardCache()

    def port_one(conn: Connection) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for player_id in sample.ids:
            facts = collect_player_facts(conn, player_id, AS_OF, served)
            out[player_id] = None if facts is None else to_js(facts)
        return out

    port = _read_only(port_one)
    left = {pid: {"facts": sample.recorded.get(pid)} for pid in sample.ids}
    right = {pid: {"facts": port.get(pid)} for pid in sample.ids}
    claims = [
        Claim(f"no sheet for {_NO_SHEET}", port.get(_NO_SHEET) is None),
        Claim(
            "each narrow read equals the board pass's sheet for the same player, where the board carries him",
            all(port[pid] == sample.board[pid] for pid in sample.ids if pid in sample.board),
        ),
    ]
    what = f"collectPlayerFacts sheets: {len(sample.ids)} ids (every {_SAMPLE_EVERY}th board player, a kicker, an unknown id)"
    return CaseResult("facts-one", [diff_rows(what, left, right)], claims=claims)


@dataclass(frozen=True, slots=True)
class CapsuleCase:
    name: str
    summary: str
    run: Callable[[], CaseResult]


CAPSULE_CASES: Final = (
    CapsuleCase(
        "facts-board", "the board pass against its recording: every facts hash, a sample's every field", facts_board
    ),
    CapsuleCase("facts-one", "the narrow read against the recording and the board pass", facts_one),
)
