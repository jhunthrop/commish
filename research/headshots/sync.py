"""THE SYNC: every provider player's copy made once a season, at most two fetches a second.

A player is fetched when his season has no row, when his row is `refresh`, `failed`, or `missing`
after a 404, or when his row is `copied` from a source that has since moved (a rookie's college photo
replaced by his NFL one). A `copied` row from the same source is skipped without a request, and a
`curated` row is never touched. A player with no source image is written `missing` without a request,
once, until his source changes. Each player's
row is committed on its own, so a pass that dies keeps every copy it made. `SYNC_WORKERS` players are
worked on at once; the one throttle, shared under a lock, still starts at most two fetches a second.
"""

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final

import httpx
from sqlalchemy import Engine

from research.errors import ConfigurationError
from research.headshots.bucket import ImageBucket
from research.headshots.config import (
    NO_PHOTO_MARK,
    SYNC_SOURCE_HOSTS,
    SYNC_WORKERS,
    WEBP,
    check_player_id,
    copy_key,
)
from research.headshots.images import FetchFailedError, NoImageError, Source, check_source, fetch, webp_widths
from research.headshots.table import Candidate, Write, candidates, write

COPIED: Final = "copied"
CURATED: Final = "curated"
MISSING: Final = "missing"
FAILED: Final = "failed"
SKIPPED: Final = "skipped"


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

    def add(self, outcome: str) -> None:
        self.counts[outcome] = self.counts.get(outcome, 0) + 1

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


def store_copies(bucket: ImageBucket, season: int, player_id: str, body: bytes) -> None:
    """The image at every kept width, written under his season's keys."""
    for width, webp in webp_widths(body).items():
        bucket.put(copy_key(season, player_id, width), webp, WEBP)


def copy_from(deps: SyncDeps, season: int, player_id: str, source: Source) -> None:
    """One fetch, through the throttle, converted and written; raises NoImageError or FetchFailedError."""
    check_source(source)
    deps.throttle.wait()
    store_copies(deps.bucket, season, player_id, fetch(deps.http, source))


def _sync_one(deps: SyncDeps, season: int, candidate: Candidate) -> Write:
    source = Source(candidate.source_url, SYNC_SOURCE_HOSTS)
    fetched_at: datetime | None = None
    try:
        if not has_source(candidate.source_url):
            raise NoImageError("the source has no photo")
        check_player_id(candidate.player_id)
        fetched_at = deps.now()
        copy_from(deps, season, candidate.player_id, source)
    except NoImageError as error:
        row = Write(MISSING, candidate.source_url, str(error), fetched_at)
    except (FetchFailedError, ConfigurationError) as error:
        row = Write(FAILED, candidate.source_url, str(error), fetched_at)
    else:
        row = Write(COPIED, candidate.source_url, None, fetched_at)
    with deps.engine.begin() as conn:
        write(conn, season, candidate.player_id, row, deps.now())
    return row


def sync(deps: SyncDeps, season: int, limit: int | None = None) -> SyncCounts:
    """One pass over every provider player; `limit` caps the players fetched (an operator's check).

    The players are worked on `deps.workers` at a time and counted in ADP order; the first error a
    player raises (a bucket write that failed) cancels the players not started and fails the pass.
    """
    with deps.engine.connect() as conn:
        everyone = candidates(conn, season)
    counts = SyncCounts()
    taken: list[Candidate] = []
    for candidate in everyone:
        if not due(candidate):
            counts.add(SKIPPED)
            continue
        if limit is not None and len(taken) >= limit:
            break
        taken.append(candidate)
    pool = ThreadPoolExecutor(max_workers=max(1, deps.workers), thread_name_prefix="headshots")
    try:
        futures = [pool.submit(_sync_one, deps, season, candidate) for candidate in taken]
        for candidate, future in zip(taken, futures, strict=True):
            row = future.result()
            counts.add(row.status)
            if row.status == FAILED:
                deps.log(f"headshots: {candidate.player_id} failed, {row.reason}")
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
    return counts
