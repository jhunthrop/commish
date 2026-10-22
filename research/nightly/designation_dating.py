"""THE CAPTURE JOB DATES THE NEWEST INJURY CAPTURE FOR THE API (Lane 134, B115).

Every API instance reads the dated status pair from `app.designation_datings` (Lane 133): one row per
injury capture, keyed by the capture's digest, holding each listed player's run start under his status.
Until this lane the first API instance to see a new hourly capture computed that dating itself, behind
the request on a CPU-throttled instance (20 s, once a timeout). Now the hourly capture harvest writes
the row right after it stores the capture, so an instance only reads it; the API keeps its own dating
as the fallback when no row exists.

ONE DEFINITION. The row is the one the API would write for the same capture:
- the capture is the one the API's `Designations` reads (`designations.newest_readable`: the newest
  by-date capture that passes the floor, else the roster sweep's);
- the digest is `inseason.DatingDigest`: the run read's version (`designation_runs.RUNS_VERSION`, derived
  from the read's inputs), the capture's stamp in Go's RFC 3339 (nanosecond form, trailing zeros
  dropped), then each listed player id and his status ("" for a code we do not know) in id order, one
  line each;
- the runs are `boards.DesignationRuns` (the same query text) encoded as `inseason.encodeRuns`: a JSON
  array of {player, status, since} in player then status order;
- the first writer of a digest wins (`on conflict do nothing`) and each write deletes the rows whose
  capture is over `DATINGS_KEPT` older than its own.
`api/testdata/designation-dating.json` pins the version, digest and runs for recorded captures, and both
lanes' tests hold their side to it.

A digest that does not match the API's (a capture the two parsers read apart) is only a row no API
instance looks up: the instance then dates the capture itself, as before. It is never a wrong dating.

THE GRANT. The job's role writes into the API's schema: `usage` on schema `app` and `select, insert,
delete` on `app.designation_datings` (the role owning the schema grants it once).
"""

import hashlib
import json
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import Connection, text

from research.model.designations import status_of
from research.nightly.designation_runs import RUNS_VERSION, designation_runs
from research.nightly.designations import newest_readable

DATINGS_TABLE: Final = "app.designation_datings"
# How far behind the newest capture a kept dating is deleted (the API's DatingsKept).
DATINGS_KEPT: Final = timedelta(hours=48)

_KEPT: Final = text(f"select true from {DATINGS_TABLE} where capture_digest = :digest")
_KEEP: Final = text(
    f"insert into {DATINGS_TABLE} (capture_digest, capture_at, runs, dated_at) "
    "values (:digest, :capture_at, cast(:runs as jsonb), :dated_at) on conflict (capture_digest) do nothing"
)
_FORGET: Final = text(f"delete from {DATINGS_TABLE} where capture_at < :cutoff")


def go_instant(value: datetime) -> str:
    """`value` as Go formats a UTC time.Time in RFC 3339 with nanoseconds: the fraction's trailing zeros
    dropped, none at all on a whole second, and Z."""
    utc = value.astimezone(UTC)
    fraction = f".{utc.microsecond:06d}".rstrip("0") if utc.microsecond else ""
    return f"{utc.strftime('%Y-%m-%dT%H:%M:%S')}{fraction}Z"


def dating_digest(capture_at: datetime, statuses: Mapping[str, str]) -> str:
    """`inseason.DatingDigest`: the sha256 of the run read's version, the capture's stamp and each listed
    player under his status (`""` for a code we do not know), in id order, one line each."""
    lines = [RUNS_VERSION, go_instant(capture_at), *(f"{i}\t{statuses[i]}" for i in sorted(statuses))]
    return hashlib.sha256("".join(f"{line}\n" for line in lines).encode("utf-8")).hexdigest()


def encode_runs(runs: Mapping[tuple[str, str], datetime]) -> str:
    """`inseason.encodeRuns`: the runs as the table keeps them, in player then status order."""
    kept = [
        {"player": player, "status": status, "since": go_instant(since)}
        for (player, status), since in sorted(runs.items())
    ]
    return json.dumps(kept, separators=(",", ":"), ensure_ascii=False)


@dataclass(frozen=True, slots=True)
class DatingOutcome:
    """What the step did, as the job's line: dated here, dated already, or nothing to date."""

    line: str
    dated: bool = False


def date_newest_capture(conn: Connection, now: datetime) -> DatingOutcome:
    """The capture the API reads dated into `app.designation_datings` unless a row holds it already, in
    the caller's transaction. Raises DesignationsError when the newest captures do not read (the API
    serves none either) and SQLAlchemyError when the table refuses (a missing grant or migration)."""
    readable = newest_readable(conn)
    if readable is None:
        return DatingOutcome("designation-dating: no injury capture yet, nothing to date")
    capture = readable.capture
    entries = capture.entries or {}
    statuses = {player_id: status_of(e.designation) or "" for player_id, e in entries.items()}
    digest = dating_digest(capture.at, statuses)
    stamp = go_instant(capture.at)
    if conn.execute(_KEPT, {"digest": digest}).first() is not None:
        return DatingOutcome(f"designation-dating: the capture of {stamp} is dated already ({digest[:12]})")
    started = time.monotonic()
    runs = designation_runs(conn, capture.at)
    took = round((time.monotonic() - started) * 1000)
    row = {"digest": digest, "capture_at": capture.at, "runs": encode_runs(runs), "dated_at": now}
    kept = conn.execute(_KEEP, row).rowcount == 1
    conn.execute(_FORGET, {"cutoff": capture.at - DATINGS_KEPT})
    how = "kept" if kept else "found an API instance's row kept first"
    return DatingOutcome(
        f"designation-dating: the capture of {stamp} dated, {len(runs)} runs read in {took} ms, {how} "
        f"in {DATINGS_TABLE} ({digest[:12]})",
        dated=kept,
    )
