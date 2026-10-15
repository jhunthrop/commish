"""THE PUBLISHED RUN'S BOARD AS A TABLE, for the readers that never read R2 (Lane 28).

The API reads no file at request time, so the order the site shows (the rest-of-season order from
the first model week, Lane 18) reaches it through `research.published_boards`. `publish` is the one place that
reads the bucket for it: after the pointer step it reads the run `runs/latest.json` names, its
manifest and every format's `boards/<format>.json`, and in one transaction deletes that season's
rows and inserts the run's. A run already in the table is left as it is, so publishing it again
changes nothing.

A FAILED WRITE. The pointer moves and the build is dispatched first, so a write that fails leaves
the table holding the previous published run, whole (the swap is one transaction and the API reads
one statement, so never a mix of two runs), while the site moves on. The failure is one named line
and exit status 1 (the job's alert); the next publish hour retries, and publish runs only 06:00 to
12:00 UTC, so a write that fails at 12:00 is made good at 06:00 the next day. A run whose artifacts
never read as a board stays failed until another run is published.

Every number is the run's own, so it names the run's basis: `rank` (`ourRank`), `position_rank`,
`points` (`projected`), `points_over_replacement` (`vor`) and the range at twelve teams under the
format's roster shape. `order_basis` is `rest_of_season` for a format the manifest gives the
in-season window (`rosFromWeek`), else `preseason`, and `from_week` is that `rosFromWeek` (NULL before
it), the first week the figures cover; `refreshed` is that format's `refreshedAt` in
season, and before it the stored board generation the run printed (the manifest's boards source
for the format's stored board, whose window is the generation's stamp).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, Engine, exists, insert, select
from sqlalchemy.exc import SQLAlchemyError

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
RETRY_WINDOW: Final = "06:00-12:00 UTC"
# The weeks a rest-of-season window may start at (the table's published_boards_from_week_ck).
FIRST_WEEK: Final = 1
LAST_WEEK: Final = 18


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
    from_week: int | None


@dataclass(frozen=True, slots=True)
class PublishedBoard:
    run_id: str
    season: int
    rows: tuple[PublishedRow, ...]


@dataclass(frozen=True, slots=True)
class SyncOutcome:
    line: str
    ok: bool = True


def _instant(value: object, what: str) -> datetime:
    if not isinstance(value, str):
        raise PublishedBoardError(f"{what} is not an instant: {value!r}")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise PublishedBoardError(f"{what} is not an instant: {value!r}") from error


def _list(value: Json, key: str, what: str) -> list[Any]:
    found = value.get(key)
    if not isinstance(found, list):
        raise PublishedBoardError(f"{what} has no {key} list")
    return found


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
    for source in _list(manifest, "sources", "the manifest"):
        if (
            isinstance(source, dict)
            and source.get("artifact") == "boards"
            and source.get("feed") == run_format.board_source
        ):
            window = source.get("window")
            to = window.get("to") if isinstance(window, dict) else None
            return _instant(to, f"the {run_format.board_source} window")
    raise PublishedBoardError(f"the manifest names no boards source {run_format.board_source} for {run_format.id}")


def _from_week(format_json: Json, format_id: str) -> int:
    """The run's first in-season week for the format: the weeks its figures cover start there."""
    week = format_json.get("rosFromWeek")
    if isinstance(week, bool) or not isinstance(week, int) or not FIRST_WEEK <= week <= LAST_WEEK:
        raise PublishedBoardError(f"{format_id} rosFromWeek is not a week: {week!r}")
    return week


def _row(row: object, format_id: str, order_basis: str, refreshed: datetime, from_week: int | None) -> PublishedRow:
    if not isinstance(row, dict):
        raise PublishedBoardError(f"{format_id}: a row is not an object: {row!r}")
    where = f"{format_id} row {row.get('id')}"
    player_id = row.get("id")
    if not isinstance(player_id, str) or not player_id:
        raise PublishedBoardError(f"{where}: the id is missing")
    return PublishedRow(
        PUBLISHED_FORMAT[format_id],
        player_id,
        _rank(row, "ourRank", where),
        _rank(row, "positionRank", where),
        _number(row, "projected", where),
        _number(row, "vor", where),
        _number(row, "floor", where),
        _number(row, "median", where),
        _number(row, "ceiling", where),
        order_basis,
        refreshed,
        from_week,
    )


def _format_rows(format_json: object, manifest: Json, boards: Mapping[str, Json]) -> list[PublishedRow]:
    if not isinstance(format_json, dict):
        raise PublishedBoardError(f"the manifest lists a format that is not an object: {format_json!r}")
    format_id = str(format_json.get("id"))
    run_format = _RUN_FORMATS.get(format_id)
    if run_format is None:
        raise PublishedBoardError(f"the manifest lists no format {format_id} the table knows")
    board = boards.get(format_id)
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
    basis = REST_OF_SEASON if in_season else PRESEASON
    from_week = _from_week(format_json, format_id) if in_season else None
    rows = [
        _row(row, format_id, basis, refreshed, from_week) for row in _list(board, "rows", f"boards/{format_id}.json")
    ]
    ids = [r.player_id for r in rows]
    twice = sorted({i for i in ids if ids.count(i) > 1})
    if twice:
        raise PublishedBoardError(f"{format_id}: player {', '.join(twice)} listed twice")
    return rows


def published_board(run_id: str, manifest: Json, boards: Mapping[str, Json]) -> PublishedBoard:
    """The table's rows for a run, from its manifest and its boards by format id."""
    season = manifest.get("season")
    if isinstance(season, bool) or not isinstance(season, int):
        raise PublishedBoardError(f"run {run_id}'s manifest names no season")
    formats = _list(manifest, "formats", f"run {run_id}'s manifest")
    rows = [row for f in formats for row in _format_rows(f, manifest, boards)]
    return PublishedBoard(run_id, season, tuple(rows))


def _read(store: RunStore, key: str) -> Json | None:
    try:
        found = read_json(store, key)
    except ValueError as error:  # json.JSONDecodeError
        raise PublishedBoardError(f"{key} is not JSON: {error}") from error
    if found is not None and not isinstance(found, dict):
        raise PublishedBoardError(f"{key} is not an object")
    return found


def read_published_board(store: RunStore, run_id: str) -> PublishedBoard:
    """The run's board read back from the store (the publish job is the one reader of R2)."""
    manifest = _read(store, run_key(run_id, MANIFEST_FILE))
    if manifest is None:
        raise PublishedBoardError(f"run {run_id} has no manifest")
    boards: dict[str, Json] = {}
    for format_json in _list(manifest, "formats", f"run {run_id}'s manifest"):
        format_id = str(format_json.get("id")) if isinstance(format_json, dict) else ""
        board = _read(store, run_key(run_id, f"boards/{format_id}.json")) if format_id else None
        if board is not None:
            boards[format_id] = board
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
                    "from_week": r.from_week,
                }
                for r in board.rows
            ],
        )
    return len(board.rows)


def _latest_run(store: RunStore) -> str | None:
    latest = _read(store, LATEST_KEY)
    if latest is None:
        return None
    run_id = latest.get("runId")
    if not isinstance(run_id, str) or not run_id:
        raise PublishedBoardError(f"{LATEST_KEY} names no run")
    return run_id


def _write(engine: Engine, store: RunStore, run_id: str, now: datetime) -> str:
    with engine.connect() as conn:
        held = conn.execute(select(exists().where(PUBLISHED_BOARDS.c.run_id == run_id))).scalar_one()
    if held:
        return f"published board: run {run_id} is already the table's"
    board = read_published_board(store, run_id)
    with engine.begin() as conn:
        written = replace_published_board(conn, board, now)
    counts = ", ".join(
        f"{fmt} {sum(1 for r in board.rows if r.format == fmt)}" for fmt in dict.fromkeys(r.format for r in board.rows)
    )
    bases = "/".join(sorted({r.order_basis for r in board.rows}))
    return f"published board: run {run_id}, {board.season}, {written} rows ({counts}), {bases}"


def held_runs(engine: Engine) -> str:
    """The runs the table holds now, for the failure line; says so when the store cannot be read."""
    try:
        with engine.connect() as conn:
            run_ids = PUBLISHED_BOARDS.c.run_id
            runs = conn.execute(select(run_ids).distinct().order_by(run_ids)).scalars().all()
    except SQLAlchemyError:
        return "what it held (the store could not be read)"
    return ", ".join(runs) or "none"


def failed(reason: str, latest: str | None, holds: str) -> SyncOutcome:
    return SyncOutcome(
        f"published board: FAILED ({reason}); latest is {latest or 'unread'}, the table still holds {holds}; "
        f"retried at the next publish hour ({RETRY_WINDOW})",
        ok=False,
    )


def sync_published_board(engine: Engine, store: RunStore, now: datetime) -> SyncOutcome:
    """Make the table hold exactly the run `latest.json` names (nothing to do when it already does).

    A failure is a named line with `ok` false, never a traceback; the table is then as it was."""
    run_id: str | None = None
    try:
        run_id = _latest_run(store)
        if run_id is None:
            return SyncOutcome("published board: no run is public yet")
        return SyncOutcome(_write(engine, store, run_id, now))
    except PublishedBoardError as error:
        return failed(str(error), run_id, held_runs(engine))
    except SQLAlchemyError as error:
        # The driver's own first line: the server's message, never the URL or its password.
        first = (str(getattr(error, "orig", None) or error).splitlines() or [""])[0]
        reason = f"{type(error).__name__}: {first}"
        return failed(reason, run_id, held_runs(engine))
