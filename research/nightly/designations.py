"""WHO IS OUT, BESIDE THE PUBLISHED BOARD (Lane 63).

A player on injured reserve is never ranked as if he plays. Every hour `publish` reads the newest
injury capture (the hourly capture job's), the same read the API's board route makes
(`api/internal/boards/designations.go`), and:

- writes `runs/<id>/designations.json` beside the boards of the public run and of the run waiting on
  its early-access hour, so the build that promotes a run already finds it: each ranked player the
  capture lists, with his status in the contract's words, whether it is season-long, since when and
  the capture's stamp (the web's `designationsSchema`);
- writes the same status into `research.published_boards` (`status`, `status_since`,
  `status_source`, revision 0008) once the table holds the public run;
- dispatches the web build of the public run when the set of its ranked players on a season-long
  list differs from the set its last build was dispatched with (`designations-build.json`), so the
  static board and player pages are right within the hour. A dispatch that fails keeps the old set,
  so the next hour tries again. No token is a skip by name, as `publish`'s own.

THE RULE. A season-long designation (injured reserve, PUP, NFI, suspended, or out with the capture's
note saying out for the season) puts him below every available player at his position; a week's
out, doubtful or questionable moves nothing. The provider's codes and the rule are pinned for both
lanes in `api/testdata/designation-codes.json` (`research/model/designations.py`).

SINCE. A season-long status is dated by the first capture of his unbroken run under it, over the by-date
captures in the window; a run that reaches the window's oldest capture has no date (we do not know when
it began), and a capture whose list does not read breaks no run. The roster sweep, which stands in only
when no by-date capture exists, carries the note and no history.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final

from sqlalchemy import Connection, Engine, bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.types import DateTime, Text

from research.capsules.facts.depth_absence import CapturedDesignation
from research.capsules.facts.depth_reads import ROSTER_SWEEP_SOURCE, designations_in
from research.errors import ResearchError
from research.model.designations import CODES, SEASON_LONG, season_long, status_of
from research.model.instants import js_iso, ms_instant
from research.nightly.config import EARLY_KEY, LATEST_KEY
from research.nightly.publish import Dispatcher, PublishOutcome, encode, read_json, run_key
from research.nightly.published_board import MANIFEST_FILE, driver_line
from research.nightly.run_store import JSON_TYPE, RunStore

Json = dict[str, Any]

BY_DATE_SOURCE: Final = "tank01_injuries_by_date"
DESIGNATIONS_FILE: Final = "designations.json"
BUILD_FILE: Final = "designations-build.json"

# The reads' bounds, the API's: the newest captures tried, the byte cap, the run window.
CAPTURES_TRIED: Final = 5
MAX_CAPTURE_BYTES: Final = 4 << 20
RUN_WINDOW: Final = timedelta(days=60)
MAX_RUN_CAPTURES: Final = 2000


class DesignationsError(ResearchError):
    """The newest captures do not read; nothing is written."""


@dataclass(frozen=True, slots=True)
class PlayerStatus:
    status: str
    season_long: bool
    since: datetime | None


@dataclass(frozen=True, slots=True)
class StatusRead:
    """The newest capture that reads: its stamp (when the list last changed), the capture job's last
    successful check of it (None when the store records none), its feed, and each listed status."""

    read_at: datetime
    checked_at: datetime | None
    source: str
    players: Mapping[str, PlayerStatus]


# How far a roster sweep's note reaches a by-date out (the API's noteWindow).
NOTE_WINDOW: Final = timedelta(hours=48)


@dataclass(frozen=True, slots=True)
class _Capture:
    at: datetime
    entries: Mapping[str, CapturedDesignation] | None


def _parsed(source: str, payload: object) -> Mapping[str, CapturedDesignation] | None:
    """The capture's entries in the shapes the API parses (the sweep's list of teams, the by-date
    list's object with injList), None for a payload over the cap or of another shape."""
    if payload is None:
        return None
    shaped = (
        isinstance(payload, list)
        if source == ROSTER_SWEEP_SOURCE
        else isinstance(payload, dict) and isinstance(payload.get("injList"), list)
    )
    return designations_in(source, payload) if shaped else None


def readable_at(captures: Sequence[_Capture], i: int) -> bool:
    """The API's floor (boards.readableAt): it parses, lists someone, and lists at least half as many
    as the newest list before it that does, so an empty or cut-short list is a glitch."""
    entries = captures[i].entries
    if not entries:
        return False
    before = next((c.entries for c in captures[i + 1 :] if c.entries), None)
    return before is None or 2 * len(entries) >= len(before)


_CAPTURES: Final = text(
    "select case when octet_length(payload::text) <= :cap then payload end as payload, captured_at "
    "from research.capture_snapshots where source = :source and (cast(:before as timestamptz) is null "
    "or captured_at <= :before) order by captured_at desc limit :n"
)


def _captures(conn: Connection, source: str, n: int, before: datetime | None = None) -> list[_Capture]:
    rows = conn.execute(_CAPTURES, {"cap": MAX_CAPTURE_BYTES, "source": source, "before": before, "n": n})
    return [_Capture(r.captured_at, _parsed(source, r.payload)) for r in rows]


# Each season-long status's unbroken run back from the newest capture, as the API reads it, over the
# captures that pass the floor.
_RUNS: Final = text(
    """with listed_caps as (
  select payload, captured_at, (
    select count(distinct btrim(e->>'playerID')) from jsonb_array_elements(payload->'injList') as e
    where btrim(coalesce(e->>'playerID', '')) <> '' and btrim(coalesce(e->>'designation', '')) <> ''
  ) as n_listed
  from research.capture_snapshots
  where source = :source and captured_at <= :newest and captured_at > :oldest
    and jsonb_typeof(payload->'injList') = 'array'
), floored as (
  select payload, captured_at, n_listed, lead(n_listed) over (order by captured_at desc) as n_before
  from listed_caps where n_listed > 0
), caps as (
  select payload, captured_at, row_number() over (order by captured_at desc) as n
  from floored
  where n_before is null or 2 * n_listed >= n_before
  order by captured_at desc limit :most
), listed as (
  select c.n, c.captured_at, btrim(e->>'playerID') as player_id, m.status
  from caps c cross join lateral jsonb_array_elements(c.payload->'injList') as e
  join unnest(:codes, :statuses) as m(code, status) on m.code = upper(btrim(e->>'designation'))
), runs as (
  select player_id, status, n, captured_at, n - row_number() over (partition by player_id, status order by n) as gap
  from listed
)
select player_id, status, min(captured_at) as since, max(n) < (select count(*) from caps) as bounded
from runs where gap = 0 group by player_id, status"""
).bindparams(bindparam("codes", type_=ARRAY(Text)), bindparam("statuses", type_=ARRAY(Text)))


def _season_runs(conn: Connection, newest: datetime) -> dict[tuple[str, str], datetime]:
    codes = sorted(code for code, status in CODES.items() if status in SEASON_LONG)
    rows = conn.execute(
        _RUNS,
        {
            "source": BY_DATE_SOURCE,
            "newest": newest,
            "oldest": newest - RUN_WINDOW,
            "most": MAX_RUN_CAPTURES,
            "codes": codes,
            "statuses": [CODES[code] for code in codes],
        },
    )
    return {(r.player_id, r.status): ms_instant(r.since) for r in rows if r.bounded}


# The capture job's last check (revision 0008): to_regclass keeps a store that predates it readable,
# as the API's lastChecked does.
_HAS_CHECKS: Final = text("select to_regclass('research.capture_checks') is not null")
_CHECKED: Final = text("select checked_at from research.capture_checks where source = :source")


def _checked(conn: Connection, source: str) -> datetime | None:
    if not conn.execute(_HAS_CHECKS).scalar_one():
        return None
    found = conn.execute(_CHECKED, {"source": source}).scalar_one_or_none()
    return None if found is None else ms_instant(found)


def _sweep_notes(conn: Connection, at: datetime) -> Mapping[str, str]:
    """The newest roster sweep's notes within NOTE_WINDOW of the by-date list, by player."""
    sweeps = _captures(conn, ROSTER_SWEEP_SOURCE, 1, at + NOTE_WINDOW)
    if not sweeps or sweeps[0].entries is None or sweeps[0].at < at - NOTE_WINDOW:
        return {}
    return {i: e.description for i, e in sweeps[0].entries.items() if e.description}


def _statuses(conn: Connection, source: str, newest: _Capture, stored_newest: bool) -> StatusRead:
    entries = newest.entries or {}
    by_date = source == BY_DATE_SOURCE
    runs = _season_runs(conn, newest.at) if by_date else {}
    outs = by_date and any(status_of(e.designation) == "out" for e in entries.values())
    notes = _sweep_notes(conn, newest.at) if outs else {}
    players: dict[str, PlayerStatus] = {}
    for player_id, captured in entries.items():
        status = status_of(captured.designation)
        if status is None:
            continue
        note = captured.description if not by_date else notes.get(player_id) if status == "out" else None
        long = season_long(status, note)
        players[player_id] = PlayerStatus(status, long, runs.get((player_id, status)) if long else None)
    # The feed's last check is this list's only when it is the newest stored: a check that returned a
    # list the floor refused never vouches for the older list shown.
    checked = _checked(conn, source) if stored_newest else None
    return StatusRead(ms_instant(newest.at), checked, source, players)


def read_statuses(conn: Connection, before: datetime | None = None) -> StatusRead | None:
    """The newest by-date capture that reads (captured at or before `before`, when given), else the roster
    sweep's; None when neither has one. The one status read for `designations.json`, the published table,
    the week-ahead read's sheet and the page's serve rule (Lane 72, the re-review's F3).

    A newest capture over the byte cap, of the wrong shape or under the floor (readable_at) gives way
    to the next newest; a source whose newest few all fail is an error, never a silent fall to an
    older list. A by-date out takes the note of the newest roster sweep near it."""
    for source in (BY_DATE_SOURCE, ROSTER_SWEEP_SOURCE):
        captures = _captures(conn, source, CAPTURES_TRIED + 1, before)
        for i in range(min(len(captures), CAPTURES_TRIED)):
            if readable_at(captures, i):
                return _statuses(conn, source, captures[i], stored_newest=i == 0)
        if captures:
            raise DesignationsError(
                f"none of the {min(len(captures), CAPTURES_TRIED)} newest injury captures {source} reads"
            )
    return None


def status_word(read: StatusRead | None, player_id: str) -> str | None:
    """His status in the contract's words on the read, None when it lists none for him: the same reading
    `designations_file` makes, so a page's week read and the web's hide rule never disagree."""
    found = None if read is None else read.players.get(player_id)
    return None if found is None else found.status


def designations_file(read: StatusRead, ranked: Iterable[str]) -> Json:
    """`designations.json`: each ranked player the capture lists (the web's designationsSchema)."""
    players = {
        player_id: {
            "status": s.status,
            "seasonLong": s.season_long,
            "since": None if s.since is None else js_iso(s.since),
        }
        for player_id in sorted(set(ranked))
        if (s := read.players.get(player_id)) is not None
    }
    checked = None if read.checked_at is None else js_iso(read.checked_at)
    return {"readAt": js_iso(read.read_at), "checkedAt": checked, "source": read.source, "players": players}


def season_ids(file: Json) -> frozenset[str]:
    """The players a designations file holds on a season-long list."""
    players = file.get("players")
    if not isinstance(players, dict):
        return frozenset()
    return frozenset(i for i, p in players.items() if isinstance(p, dict) and p.get("seasonLong") is True)


@dataclass(frozen=True, slots=True)
class Marked:
    """What one hour's marking wrote: the read, and each marked run's season-long players."""

    read: StatusRead | None
    # By run id: the ranked players on a season-long list, and the run's season.
    held: Mapping[str, frozenset[str]]
    seasons: Mapping[str, int]
    line: str
    ok: bool = True


def _pointer(store: RunStore, key: str) -> str | None:
    found = read_json(store, key)
    run_id = None if found is None else found.get("runId")
    return run_id if isinstance(run_id, str) and run_id else None


@dataclass(frozen=True, slots=True)
class Ranked:
    season: int
    ids: frozenset[str]


def ranked(store: RunStore, run_id: str) -> Ranked | None:
    """The run's season and every player its boards rank, None for a run whose manifest or boards do
    not read (the table sync names why)."""
    manifest = read_json(store, run_key(run_id, MANIFEST_FILE))
    season = None if manifest is None else manifest.get("season")
    formats = None if manifest is None else manifest.get("formats")
    if isinstance(season, bool) or not isinstance(season, int) or not isinstance(formats, list):
        return None
    ids: set[str] = set()
    for format_json in formats:
        format_id = format_json.get("id") if isinstance(format_json, dict) else None
        board = read_json(store, run_key(run_id, f"boards/{format_id}.json")) if isinstance(format_id, str) else None
        rows = None if board is None else board.get("rows")
        if not isinstance(rows, list):
            return None
        ids.update(row["id"] for row in rows if isinstance(row, dict) and isinstance(row.get("id"), str))
    return Ranked(season, frozenset(ids))


def mark_runs(conn: Connection, store: RunStore, keys: Sequence[str]) -> Marked:
    """`designations.json` written into each run the pointers at `keys` name, before `publish`. A run
    whose boards do not read is left unmarked and named (the table sync fails it by name too)."""
    read = read_statuses(conn)
    if read is None:
        return Marked(None, {}, {}, "designations: no injury capture yet; the pages render as before")
    held: dict[str, frozenset[str]] = {}
    seasons: dict[str, int] = {}
    unread: list[str] = []
    for run_id in dict.fromkeys(r for r in (_pointer(store, key) for key in keys) if r is not None):
        run = ranked(store, run_id)
        if run is None:
            unread.append(run_id)
            continue
        file = designations_file(read, run.ids)
        store.put(run_key(run_id, DESIGNATIONS_FILE), encode(file), JSON_TYPE)
        held[run_id], seasons[run_id] = season_ids(file), run.season
    runs = ", ".join(f"{r} ({len(ids)} season-long)" for r, ids in held.items()) or "no run"
    skipped = f"; run {', '.join(unread)} does not read as a board, left unmarked" if unread else ""
    return Marked(read, held, seasons, f"designations: capture of {js_iso(read.read_at)} written to {runs}{skipped}")


_CLEAR: Final = text(
    "update research.published_boards set status = null, status_since = null, status_source = null "
    "where season = :season and status is not null"
)
_MARK: Final = text(
    "update research.published_boards b set status = m.status, status_since = m.since, status_source = :source "
    "from unnest(:ids, :statuses, :sinces) as m(player_id, status, since) "
    "where b.season = :season and b.player_id = m.player_id"
).bindparams(
    bindparam("ids", type_=ARRAY(Text)),
    bindparam("statuses", type_=ARRAY(Text)),
    bindparam("sinces", type_=ARRAY(DateTime(timezone=True))),
)


def write_table_statuses(conn: Connection, season: int, read: StatusRead) -> int:
    """The season's published rows marked from the read, inside the caller's transaction; the rows
    marked (one per format a listed player is ranked in)."""
    conn.execute(_CLEAR, {"season": season})
    listed = sorted(read.players.items())
    result = conn.execute(
        _MARK,
        {
            "season": season,
            "source": read.source,
            "ids": [player_id for player_id, _ in listed],
            "statuses": [s.status for _, s in listed],
            "sinces": [s.since for _, s in listed],
        },
    )
    return int(result.rowcount)


def built_set(store: RunStore, run_id: str) -> frozenset[str]:
    """The season-long players the run's last dispatched build was made with, none before one."""
    record = read_json(store, run_key(run_id, BUILD_FILE))
    listed = None if record is None else record.get("seasonLong")
    return frozenset(i for i in listed if isinstance(i, str)) if isinstance(listed, list) else frozenset()


def _record(store: RunStore, run_id: str, ids: frozenset[str], build: str, now: datetime) -> None:
    body = {"seasonLong": sorted(ids), "at": js_iso(now), "build": build}
    store.put(run_key(run_id, BUILD_FILE), encode(body), JSON_TYPE)


@dataclass(frozen=True, slots=True)
class BuildOutcome:
    line: str
    ok: bool = True


@dataclass(frozen=True, slots=True)
class Hour:
    """This publish hour: its dispatcher (or why there is none), what `publish` did, its instant."""

    dispatcher: Dispatcher | str | None
    published: PublishOutcome
    now: datetime


def build_on_change(store: RunStore, marked: Marked, hour: Hour) -> BuildOutcome:
    """The public run's build dispatched when its season-long players moved since its last build."""
    run_id = _pointer(store, LATEST_KEY)
    if run_id is None or run_id not in marked.held:
        return BuildOutcome("designations: no public run to build")
    ids, dispatcher, now = marked.held[run_id], hour.dispatcher, hour.now
    count = f"{len(ids)} season-long"
    if hour.published.run_id == run_id and hour.published.dispatched:
        _record(store, run_id, ids, "the run's own build", now)
        return BuildOutcome(f"designations: run {run_id}, {count}, in the build publish dispatched")
    if ids == built_set(store, run_id):
        return BuildOutcome(f"designations: run {run_id}, {count}, unchanged since its last build")
    if dispatcher is None or isinstance(dispatcher, str):
        why = "--no-dispatch" if dispatcher is None else dispatcher
        _record(store, run_id, ids, f"skipped: {why}", now)
        return BuildOutcome(f"designations: run {run_id}, {count}, moved; the web dispatch skipped ({why})")
    failure = dispatcher.dispatch(run_id)
    if failure is not None:
        return BuildOutcome(
            f"designations: run {run_id}, {count}, moved; the dispatch FAILED ({failure}); retried next hour", ok=False
        )
    _record(store, run_id, ids, "dispatched", now)
    return BuildOutcome(f"designations: run {run_id}, {count}, moved; the web build of it was dispatched")


_RETRIED: Final = "the pages keep the last file; retried at the next publish hour"


def mark_public_runs(engine: Engine | None, store: RunStore) -> Marked:
    """The marking step of a publish hour: the public run and the early run, before the pointer
    moves. With no store it is skipped by name (the table step says whether that fails the hour)."""
    if engine is None:
        return Marked(None, {}, {}, "designations: skipped, no store to read the injury capture from")
    try:
        with engine.connect() as conn:
            return mark_runs(conn, store, (LATEST_KEY, EARLY_KEY))
    except DesignationsError as error:
        return Marked(None, {}, {}, f"designations: FAILED ({error}); {_RETRIED}", ok=False)
    except SQLAlchemyError as error:
        return Marked(None, {}, {}, f"designations: FAILED ({driver_line(error)}); {_RETRIED}", ok=False)


def finish_marks(engine: Engine | None, store: RunStore, marked: Marked, hour: Hour) -> list[BuildOutcome]:
    """After the pointer step and the table: the public run's rows marked in the table (given the
    engine only once the table holds the run), then its build dispatched if its players moved."""
    if marked.read is None:
        return []
    steps: list[BuildOutcome] = []
    run_id = _pointer(store, LATEST_KEY)
    if engine is not None and run_id is not None and run_id in marked.seasons:
        try:
            with engine.begin() as conn:
                rows = write_table_statuses(conn, marked.seasons[run_id], marked.read)
            steps.append(BuildOutcome(f"designations: run {run_id}, {rows} published rows marked"))
        except SQLAlchemyError as error:
            steps.append(BuildOutcome(f"designations: table FAILED ({driver_line(error)}); {_RETRIED}", ok=False))
    steps.append(build_on_change(store, marked, hour))
    return steps
