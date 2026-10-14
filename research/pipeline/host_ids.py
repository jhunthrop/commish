"""THE FANTASY HOSTS' PLAYER IDS onto the universe: `players.sleeper_id`, `yahoo_id`, `mfl_id`.

nflverse's `players.csv` carries no host ids (its header stops at `espn_id` and `smart_id`, checked
2026-10-14). The ecosystem's fantasy id map is DynastyProcess's `db_playerids.csv`, the file
nflverse's own readers load as `load_ff_playerids`: one row a player with his gsis id beside every
host's id. This ingest joins it to the universe on the gsis id and nothing else.

THE MAP OWNS THE COLUMNS. Every run sets each universe player's three ids from the map, and a player
the map no longer names loses his, so a host id never lingers on the wrong man. An id the map gives
to two gsis ids, or a gsis id the map lists twice with different ids, is ambiguous and left off
both: a wrong join would put one man's pick on another's line, and an unplaced pick is honest.
"""

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from sqlalchemy import Connection, text

from research.errors import SchemaDriftError
from research.pipeline.http import Fetcher, is_success
from research.pipeline.nflverse.csv import CsvRow, parse_csv

FF_PLAYER_IDS_URL: Final = "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv"
HOST_ID_COLUMNS: Final = ("sleeper_id", "yahoo_id", "mfl_id")
_MISSING: Final = frozenset(("", "NA", "NaN"))
_CHUNK_ROWS: Final = 2_000


@dataclass(frozen=True, slots=True)
class HostIds:
    player_id: str
    sleeper_id: str | None
    yahoo_id: str | None
    mfl_id: str | None


@dataclass(frozen=True, slots=True)
class HostIdReport:
    mapped: int
    sleeper: int
    yahoo: int
    mfl: int
    ambiguous_ids: int
    not_in_universe: int

    def __str__(self) -> str:
        return (
            f"{self.mapped} universe players carry a host id (sleeper {self.sleeper}, yahoo {self.yahoo}, "
            f"mfl {self.mfl}); {self.ambiguous_ids} ambiguous ids left off, {self.not_in_universe} map rows "
            "name a gsis id the universe lacks"
        )


def _value(row: CsvRow, column: str) -> str | None:
    raw = row.get(column)
    if raw is None:
        return None
    trimmed = raw.strip()
    return None if trimmed in _MISSING else trimmed


def map_host_ids(rows: Sequence[CsvRow]) -> tuple[list[HostIds], int]:
    """Each gsis id's host ids, ambiguous ones dropped, and how many ids were dropped."""
    if rows and any(column not in rows[0] for column in ("gsis_id", *HOST_ID_COLUMNS)):
        raise SchemaDriftError("the fantasy id map lost one of gsis_id, sleeper_id, yahoo_id, mfl_id")
    by_player: dict[str, dict[str, str | None]] = {}
    clashing: set[str] = set()
    for row in rows:
        player_id = _value(row, "gsis_id")
        if player_id is None:
            continue
        ids = {column: _value(row, column) for column in HOST_ID_COLUMNS}
        known = by_player.get(player_id)
        if known is not None and known != ids:
            clashing.add(player_id)
        by_player[player_id] = ids
    dropped = sum(1 for player_id in clashing for value in by_player[player_id].values() if value is not None)
    for player_id in clashing:
        by_player[player_id] = dict.fromkeys(HOST_ID_COLUMNS)
    for column in HOST_ID_COLUMNS:
        counts = Counter(ids[column] for ids in by_player.values() if ids[column] is not None)
        for ids in by_player.values():
            if ids[column] is not None and counts[ids[column]] > 1:
                ids[column] = None
                dropped += 1
    mapped = [
        HostIds(player_id, ids["sleeper_id"], ids["yahoo_id"], ids["mfl_id"])
        for player_id, ids in sorted(by_player.items())
        if any(value is not None for value in ids.values())
    ]
    return mapped, dropped


def fetch_host_id_rows(fetcher: Fetcher, url: str = FF_PLAYER_IDS_URL) -> list[dict[str, str]]:
    response = fetcher.get(url)
    if not is_success(response.status):
        raise SchemaDriftError(f"the fantasy id map answered HTTP {response.status}")
    return parse_csv(response.text())


def _universe(conn: Connection) -> frozenset[str]:
    return frozenset(str(row[0]) for row in conn.execute(text("select id from research.players")))


def record_host_ids(conn: Connection, mapped: Sequence[HostIds]) -> int:
    """Clear the three columns, then set each mapped player's: the map owns them."""
    conn.execute(text("update research.players set sleeper_id = null, yahoo_id = null, mfl_id = null"))
    written = 0
    for start in range(0, len(mapped), _CHUNK_ROWS):
        chunk = mapped[start : start + _CHUNK_ROWS]
        values = ", ".join(f"(:id{i}, :s{i}, :y{i}, :m{i})" for i in range(len(chunk)))
        params: dict[str, object] = {}
        for i, ids in enumerate(chunk):
            params |= {f"id{i}": ids.player_id, f"s{i}": ids.sleeper_id, f"y{i}": ids.yahoo_id, f"m{i}": ids.mfl_id}
        written += conn.execute(
            text(
                "update research.players as p set sleeper_id = v.s, yahoo_id = v.y, mfl_id = v.m "
                f"from (values {values}) as v(id, s, y, m) where p.id = v.id"
            ),
            params,
        ).rowcount
    return written


def _counts(mapped: Sequence[HostIds]) -> Mapping[str, int]:
    return {column: sum(1 for ids in mapped if getattr(ids, column) is not None) for column in HOST_ID_COLUMNS}


def ingest_host_ids(conn: Connection, fetcher: Fetcher) -> HostIdReport:
    """Fetch the map, keep the rows the universe knows, and write the three columns."""
    mapped, dropped = map_host_ids(fetch_host_id_rows(fetcher))
    universe = _universe(conn)
    kept = [ids for ids in mapped if ids.player_id in universe]
    record_host_ids(conn, kept)
    counts = _counts(kept)
    return HostIdReport(
        len(kept), counts["sleeper_id"], counts["yahoo_id"], counts["mfl_id"], dropped, len(mapped) - len(kept)
    )
