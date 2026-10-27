"""THE SYNC: every provider player's copy made once a season, at most two fetches a second.

A player is fetched when his season has no row, when his row is `refresh`, `failed`, or `missing`
after a 404, or when his row is `copied` from a source that has since moved (a rookie's college photo
replaced by his NFL one). A `copied` row from the same source is skipped without a request, and a
`curated` row is never touched: under his advisory lock the sync re-reads his row, skips the bucket
write when it is curated, and writes the row with one statement that leaves a curated row alone. A player with no
source image is written `missing` without a request, once, until his source changes. Each player's
row is committed on its own, so a pass that dies keeps every copy it made. `SYNC_WORKERS` players are
worked on at once; the one throttle, shared under a lock, still starts at most two fetches a second.
"""

import re
import threading
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final
from urllib.parse import urlsplit

import httpx
from sqlalchemy import Engine

from research.errors import ConfigurationError
from research.headshots.bucket import ImageBucket
from research.headshots.config import (
    NO_PHOTO_MARK,
    SYNC_SOURCE_HOSTS,
    SYNC_WORKERS,
    SYNC_WORKERS_RANGE,
    WEBP,
    check_player_id,
    copy_key,
)
from research.headshots.images import FetchFailedError, NoImageError, Source, check_source, fetch, webp_widths
from research.headshots.table import (
    CURATED_STATUS,
    Candidate,
    Write,
    candidates,
    lock_player,
    row_status,
    write_unless_curated,
)

COPIED: Final = "copied"
CURATED: Final = CURATED_STATUS
MISSING: Final = "missing"
FAILED: Final = "failed"
SKIPPED: Final = "skipped"

_URL: Final = re.compile(r"https?://[^\s'\"<>)]+")


class Throttle:
    """At most one call to `wait` returns per `interval` seconds, on the clock it is given, across
    threads: a waiter holds the lock while it sleeps, so the next one is spaced from it."""

    def __init__(self, interval: float, clock: Callable[[], float], sleep: Callable[[float], None]) -> None:
        self.interval = interval
        self.clock = clock
        self.sleep = sleep
        self.last: float | None = None
        self._lock = threading.Lock()

    def wait(self) -> float:
        """Returns the clock's time the call was let through."""
        with self._lock:
            if self.last is not None:
                due = self.last + self.interval - self.clock()
                if due > 0:
                    self.sleep(due)
            self.last = self.clock()
            return self.last


@dataclass(frozen=True, slots=True)
class SyncDeps:
    engine: Engine
    http: httpx.Client
    bucket: ImageBucket
    throttle: Throttle
    now: Callable[[], datetime]
    log: Callable[[str], None]
    workers: int = SYNC_WORKERS


@dataclass(slots=True)
class SyncCounts:
    counts: dict[str, int] = field(default_factory=dict)
    unmapped: int = 0

    def add(self, outcome: str) -> None:
        self.counts[outcome] = self.counts.get(outcome, 0) + 1

    @property
    def systemic(self) -> bool:
        """Whether every player the pass worked on died of an unmapped error: the bucket or the
        database is unreachable, not one player's source."""
        # Mapped failures (a 500 from the source) count as worked, so one of them keeps a pass whose
        # other players all died unmapped from being systemic.
        worked = sum(self.counts.get(outcome, 0) for outcome in (COPIED, MISSING, FAILED))
        return self.unmapped > 0 and self.unmapped == worked

    def line(self) -> str:
        order = (COPIED, SKIPPED, MISSING, FAILED)
        return ", ".join(f"{self.counts.get(outcome, 0)} {outcome}" for outcome in order)


def due(candidate: Candidate) -> bool:
    """Whether the sync fetches him (the rules in the module's docstring)."""
    if candidate.status == CURATED:
        return False
    if candidate.status == COPIED:
        return candidate.copied_from != candidate.source_url
    if candidate.status == MISSING and not has_source(candidate.source_url):
        return candidate.copied_from != candidate.source_url
    return True


def has_source(url: str | None) -> bool:
    return bool(url) and NO_PHOTO_MARK not in (url or "")


def check_workers(workers: object) -> int:
    """The worker count, or a ConfigurationError naming SYNC_WORKERS when it is not an integer in range."""
    low, high = SYNC_WORKERS_RANGE
    if isinstance(workers, bool) or not isinstance(workers, int) or not low <= workers <= high:
        raise ConfigurationError(f"SYNC_WORKERS must be an integer from {low} to {high}, not {workers!r}.")
    return workers


def error_reason(error: BaseException) -> str:
    """A row's reason for an error nobody mapped: its class, and the scheme and host of each URL its
    message names, never the message (a path, query, fragment or userinfo can carry a secret)."""
    origins = [origin for origin in dict.fromkeys(_origin(url) for url in _URL.findall(str(error))) if origin]
    named = f" ({', '.join(origins)})" if origins else ""
    return f"{type(error).__name__}{named}"


def _origin(url: str) -> str | None:
    try:
        parts = urlsplit(url)
        return f"{parts.scheme}://{parts.hostname}" if parts.hostname else None
    except ValueError:
        return None


def store_copies(bucket: ImageBucket, season: int, player_id: str, body: bytes) -> None:
    """The image at every kept width, written under his season's keys."""
    for width, webp in webp_widths(body).items():
        bucket.put(copy_key(season, player_id, width), webp, WEBP)


def fetch_copy(deps: SyncDeps, source: Source) -> bytes:
    """One fetch, through the throttle; raises NoImageError or FetchFailedError."""
    check_source(source)
    deps.throttle.wait()
    return fetch(deps.http, source)


def _copy_under_lock(
    deps: SyncDeps, season: int, candidate: Candidate, body: bytes, fetched_at: datetime | None
) -> Write | None:
    """His bucket write and ledger write under his lock, so a curation lands wholly before or after;
    None when his row is curated. The fetch is outside the lock; a fetch a curation then makes
    pointless is discarded, which is acceptable at this scale."""
    row = Write(COPIED, candidate.source_url, None, fetched_at)
    with deps.engine.begin() as conn:
        lock_player(conn, season, candidate.player_id)
        if row_status(conn, season, candidate.player_id) == CURATED:
            return None
        store_copies(deps.bucket, season, candidate.player_id, body)
        write_unless_curated(conn, season, candidate.player_id, row, deps.now())
    return row


def _sync_one(deps: SyncDeps, season: int, candidate: Candidate) -> Write | None:
    """His row as the sync leaves it; None when a curation landed first and his row is not touched."""
    source = Source(candidate.source_url, SYNC_SOURCE_HOSTS)
    fetched_at: datetime | None = None
    try:
        if not has_source(candidate.source_url):
            raise NoImageError("the source has no photo")
        check_player_id(candidate.player_id)
        fetched_at = deps.now()
        return _copy_under_lock(deps, season, candidate, fetch_copy(deps, source), fetched_at)
    except NoImageError as error:
        row = Write(MISSING, candidate.source_url, str(error), fetched_at)
    except (FetchFailedError, ConfigurationError) as error:
        row = Write(FAILED, candidate.source_url, str(error), fetched_at)
    with deps.engine.begin() as conn:
        written = write_unless_curated(conn, season, candidate.player_id, row, deps.now())
    return row if written else None


def _record_unmapped(deps: SyncDeps, season: int, candidate: Candidate, error: BaseException) -> str:
    """Marks his row failed for an error nobody mapped, as far as the ledger will take it; returns the reason."""
    reason = error_reason(error)
    row = Write(FAILED, candidate.source_url, reason, None)
    try:
        with deps.engine.begin() as conn:
            write_unless_curated(conn, season, candidate.player_id, row, deps.now())
    except Exception as write_error:  # the ledger is itself the trouble; the log line still names him
        reason = f"{reason} (his row was not written: {error_reason(write_error)})"
    return reason


def _take_due(everyone: list[Candidate], limit: int | None, counts: SyncCounts) -> list[Candidate]:
    """The players to work on, in ADP order; the rest are counted skipped."""
    taken: list[Candidate] = []
    for candidate in everyone:
        if not due(candidate):
            counts.add(SKIPPED)
            continue
        if limit is not None and len(taken) >= limit:
            break
        taken.append(candidate)
    return taken


def _collect(deps: SyncDeps, season: int, futures: dict[Future[Write | None], Candidate], counts: SyncCounts) -> None:
    for future in as_completed(futures):
        candidate = futures[future]
        error = future.exception()
        if error is None:
            row = future.result()
            counts.add(SKIPPED if row is None else row.status)
            if row is not None and row.status == FAILED:
                deps.log(f"headshots: {candidate.player_id} failed, {row.reason}")
            continue
        if not isinstance(error, Exception):
            raise error  # SystemExit, KeyboardInterrupt: the process is being stopped, not a player failing
        counts.add(FAILED)
        counts.unmapped += 1
        deps.log(f"headshots: {candidate.player_id} failed, {_record_unmapped(deps, season, candidate, error)}")


def sync(deps: SyncDeps, season: int, limit: int | None = None) -> SyncCounts:
    """One pass over every provider player; `limit` caps the players fetched (an operator's check).

    The players are worked on `deps.workers` at a time and collected as they finish. An error a
    player raises that nobody mapped (a bucket or database error) fails only his row: it is logged,
    counted and kept in the ledger, and the other players carry on; `SyncCounts.systemic` says when
    every player died so. Anything that is not an `Exception` (an interrupt, an exit), or any error
    leaving the collection, cancels the players not started and propagates.
    """
    workers = check_workers(deps.workers)
    with deps.engine.connect() as conn:
        everyone = candidates(conn, season)
    counts = SyncCounts()
    taken = _take_due(everyone, limit, counts)
    pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="headshots")
    try:
        futures = {pool.submit(_sync_one, deps, season, candidate): candidate for candidate in taken}
        _collect(deps, season, futures, counts)
    except BaseException:
        pool.shutdown(wait=False, cancel_futures=True)
        raise
    pool.shutdown(wait=True)
    return counts
