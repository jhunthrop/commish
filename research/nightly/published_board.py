"""THE PUBLISHED RUN'S BOARD AS A TABLE, for the readers that never read R2 (Lane 28).

The API reads no file at request time, so the order the site shows (the rest-of-season order from
week 7, Lane 18) reaches it through `research.published_boards`. `publish` is the one place that
reads the bucket for it: after the pointer step it reads the run `runs/latest.json` names, its
manifest and every format's `boards/<format>.json`, and in one transaction deletes that season's
rows and inserts the run's. A run already in the table is left as it is, so publishing it again
changes nothing, and a publish whose write failed is made good by the next one (hourly).

Every number is the run's own, so it names the run's basis: `rank` (`ourRank`), `position_rank`,
`points` (`projected`), `points_over_replacement` (`vor`) and the range at twelve teams under the
format's roster shape. `order_basis` is `rest_of_season` for a format the manifest gives the
in-season window (`rosFromWeek`), else `preseason`; `refreshed` is that format's `refreshedAt` in
season, and before it the stored board generation the run printed (the manifest's boards source
for the format's stored board, whose window is the generation's stamp).
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, Engine, exists, insert, select

from research.db.schema import PUBLISHED_BOARDS
from research.errors import ResearchError
from research.nightly.config import LATEST_KEY, RUN_FORMATS, RunFormat
from research.nightly.publish import read_json, run_key
from research.nightly.run_store import RunStore

Json = dict[str, Any]

# The run's format id to the table's: the API's stored board names, and superflex.
PUBLISHED_FORMAT: Final[Mapping[str, str]] = {
    "ppr-12": "ppr",
    "half-ppr-12": "half",
    "standard-12": "std",
    "superflex-12": "superflex",
}
_RUN_FORMATS: Final = {f.id: f for f in RUN_FORMATS}
MANIFEST_FILE: Final = "manifest.json"
PRESEASON: Final = "preseason"
REST_OF_SEASON: Final = "rest_of_season"


class PublishedBoardError(ResearchError):
    """The published run's artifacts do not read as a board; the table is left as it was."""


@dataclass(frozen=True, slots=True)
class PublishedRow:
    format: str
    player_id: str
    rank: int
    position_rank: int
    points: float | None
    points_over_replacement: float | None
    floor: float | None
    median: float | None
    ceiling: float | None
    order_basis: str
    refreshed: datetime


@dataclass(frozen=True, slots=True)
class PublishedBoard:
    run_id: str
    season: int
    rows: tuple[PublishedRow, ...]


@dataclass(frozen=True, slots=True)
class SyncOutcome:
    line: str


def _instant(value: object, what: str) -> datetime:
    if not isinstance(value, str):
        raise PublishedBoardError(f"{what} is not an instant: {value!r}")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _number(row: Json, key: str, where: str) -> float | None:
    value = row.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise PublishedBoardError(f"{where}: {key} is not a number: {value!r}")
    return float(value)


def _rank(row: Json, key: str, where: str) -> int:
    value = row.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise PublishedBoardError(f"{where}: {key} is not a rank: {value!r}")
    return value


def _stored_generation(manifest: Json, run_format: RunFormat) -> datetime:
    """The stamp of the stored board the run printed for this format, from its boards source."""
    for source in manifest.get("sources", []):
        if source.get("artifact") == "boards" and source.get("feed") == run_format.board_source:
            return _instant(source["window"]["to"], f"the {run_format.board_source} window")
    raise PublishedBoardError(f"the manifest names no boards source {run_format.board_source} for {run_format.id}")


def _format_rows(format_json: Json, manifest: Json, board: Json | None) -> list[PublishedRow]:
    format_id = str(format_json.get("id"))
    run_format = _RUN_FORMATS.get(format_id)
    if run_format is None:
        raise PublishedBoardError(f"the manifest lists no format {format_id} the table knows")
    if board is None:
        raise PublishedBoardError(f"the run has no board {format_id}")
    if board.get("format") != format_id:
        raise PublishedBoardError(f"boards/{format_id}.json names format {board.get('format')}")
    in_season = "rosFromWeek" in format_json
    refreshed = (
        _instant(format_json.get("refreshedAt"), f"{format_id} refreshedAt")
        if in_season
        else _stored_generation(manifest, run_format)
    )
    rows: list[PublishedRow] = []
    seen: set[str] = set()
    for row in board["rows"]:
        where = f"{format_id} row {row.get('id')}"
        player_id = row.get("id")
        if not isinstance(player_id, str) or player_id in seen:
            raise PublishedBoardError(f"{where}: the id is missing or listed twice")
        seen.add(player_id)
        rows.append(
            PublishedRow(
                PUBLISHED_FORMAT[format_id],
                player_id,
                _rank(row, "ourRank", where),
                _rank(row, "positionRank", where),
                _number(row, "projected", where),
                _number(row, "vor", where),
                _number(row, "floor", where),
                _number(row, "median", where),
                _number(row, "ceiling", where),
                REST_OF_SEASON if in_season else PRESEASON,
                refreshed,
            )
        )
    return rows


def published_board(run_id: str, manifest: Json, boards: Mapping[str, Json]) -> PublishedBoard:
    """The table's rows for a run, from its manifest and its boards by format id."""
    season = manifest.get("season")
    if isinstance(season, bool) or not isinstance(season, int):
        raise PublishedBoardError(f"run {run_id}'s manifest names no season")
    rows = [row for f in manifest["formats"] for row in _format_rows(f, manifest, boards.get(str(f.get("id"))))]
    return PublishedBoard(run_id, season, tuple(rows))


def read_published_board(store: RunStore, run_id: str) -> PublishedBoard:
    """The run's board read back from the store (the publish job is the one reader of R2)."""
    manifest = read_json(store, run_key(run_id, MANIFEST_FILE))
    if manifest is None:
        raise PublishedBoardError(f"run {run_id} has no manifest")
    boards: dict[str, Json] = {}
    for format_json in manifest["formats"]:
        format_id = str(format_json.get("id"))
        raw = store.get(run_key(run_id, f"boards/{format_id}.json"))
        if raw is not None:
            boards[format_id] = json.loads(raw)
    return published_board(run_id, manifest, boards)


def replace_published_board(conn: Connection, board: PublishedBoard, published_at: datetime) -> int:
    """The season's rows replaced by the run's, inside the caller's transaction; the rows written."""
    conn.execute(PUBLISHED_BOARDS.delete().where(PUBLISHED_BOARDS.c.season == board.season))
    if board.rows:
        conn.execute(
            insert(PUBLISHED_BOARDS),
            [
                {
                    "season": board.season,
                    "format": r.format,
                    "player_id": r.player_id,
                    "run_id": board.run_id,
                    "rank": r.rank,
                    "position_rank": r.position_rank,
                    "points": r.points,
                    "points_over_replacement": r.points_over_replacement,
                    "floor_points": r.floor,
                    "median_points": r.median,
                    "ceiling_points": r.ceiling,
                    "order_basis": r.order_basis,
                    "refreshed": r.refreshed,
                    "published_at": published_at,
                }
                for r in board.rows
            ],
        )
    return len(board.rows)


def sync_published_board(engine: Engine, store: RunStore, now: datetime) -> SyncOutcome:
    """Make the table hold exactly the run `latest.json` names (nothing to do when it already does)."""
    latest = read_json(store, LATEST_KEY)
    if latest is None:
        return SyncOutcome("published board: no run is public yet")
    run_id = str(latest["runId"])
    with engine.connect() as conn:
        held = conn.execute(select(exists().where(PUBLISHED_BOARDS.c.run_id == run_id))).scalar_one()
    if held:
        return SyncOutcome(f"published board: run {run_id} is already the table's")
    board = read_published_board(store, run_id)
    with engine.begin() as conn:
        written = replace_published_board(conn, board, now)
    counts = ", ".join(
        f"{fmt} {sum(1 for r in board.rows if r.format == fmt)}" for fmt in dict.fromkeys(r.format for r in board.rows)
    )
    bases = "/".join(sorted({r.order_basis for r in board.rows}))
    return SyncOutcome(f"published board: run {run_id}, {board.season}, {written} rows ({counts}), {bases}")
