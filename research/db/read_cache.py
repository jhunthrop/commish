"""THE READ CACHE: a history read's result kept in the store, served while the rows it read are unchanged.

Some reads return the same answer night after night from many megabytes of rows: last season's
usage, ranks and trends, the held-out seasons' outcomes. Those rows only change when an ingest or a
correction lands, and each night still moved them all across the network (the 2026-10-14 transfer
incident). A cached read is served instead when nothing it read has changed:

1. On a miss the read runs as usual while every statement it sends is recorded (its SQL and its
   parameters, the read's `as_of` written as a placeholder). Each statement is then fingerprinted
   on the server, `count(*)` and the sum of a 64-bit hash of every row's text, and the result is
   kept with the statements and their fingerprints as one row of `model_artifacts`
   (`cache/<name>`, a new version each time; older versions of the name are dropped). The read and
   its fingerprints must see one snapshot, or a row committed between them would enter the
   fingerprint and not the result, which would then be served every night after (review HIGH-1):
   so a result is kept only from a REPEATABLE READ or SERIALIZABLE transaction (`snapshot`), and a
   read on any other connection is served when it matches but never kept.
2. On the next call with the same arguments under the same code, each recorded statement is run
   again on the server, as a fingerprint only, with tonight's `as_of` in the placeholder's place.
   Every fingerprint equal means every row it read is the same, so the kept result is the result:
   it is decoded and returned, and a few hundred bytes crossed the network rather than the rows.
   Any fingerprint that differs, or a different code version or argument, is a miss.

That is sound for a read that is a pure function of its arguments and of the rows its statements
return, which treats `as_of` only as a bound it passes to its statements (never as a date it
computes with), and whose statements have no side effect (no `for update`, no `nextval`, no lock:
the fingerprint runs each statement again). Every read cached here is one such; `facts.history`
names them. The result's exact form is `db.value_codec`; a value it cannot write or read back is
not cached, and a kept value that no longer decodes is a miss.
"""

import hashlib
import json
import re
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final, Protocol

from sqlalchemy import Connection, Engine, event, text

from research.db.value_codec import UnencodableError, ValueCodec

CACHE_PREFIX: Final = "cache/"
_AS_OF: Final = {"as_of": True}
_INSTANT: Final = "at"
_FINGERPRINT: Final = (
    "select count(*)::text || ':' || coalesce(sum(hashtextextended(r::text, 0)), 0)::text from ({sql}) as r"
)
_READ_VERBS: Final = ("select", "with")
# What a read must not do, since the fingerprint runs it again: lock rows, move a sequence, take a lock.
_SIDE_EFFECTS: Final = re.compile(
    r"\bfor\s+(?:no\s+key\s+)?(?:update|share|key\s+share)\b|\b(?:nextval|setval|pg_advisory\w*)\s*\(",
    re.IGNORECASE,
)
# The isolation levels under which a read and its fingerprints see one snapshot.
SNAPSHOT_LEVELS: Final = frozenset({"REPEATABLE READ", "SERIALIZABLE"})
# Every float as text with its exact digits whatever a role or pooler sets (the default since
# Postgres 12 is already exact; this pins it), so two different floats never hash alike.
_EXACT_FLOATS: Final = "set local extra_float_digits = 3"


class UncacheableError(ValueError):
    """A statement the cache cannot replay (a write, or a parameter it has no form for)."""


@dataclass(frozen=True, slots=True)
class Recorded:
    sql: str
    parameters: Any  # the JSON form, `as_of` as a placeholder


def _parameter(value: Any, as_of: datetime | None) -> Any:
    if isinstance(value, datetime):
        return _AS_OF if as_of is not None and value == as_of else {_INSTANT: value.isoformat()}
    if value is None or type(value) in (str, int, float, bool):
        return value
    if type(value) in (list, tuple):
        return [_parameter(item, as_of) for item in value]
    raise UncacheableError(f"a statement parameter of type {type(value).__name__}")


def _bound(raw: Any, as_of: datetime | None) -> Any:
    if isinstance(raw, list):
        return [_bound(item, as_of) for item in raw]
    if isinstance(raw, dict):
        if raw == _AS_OF:
            if as_of is None:
                raise UncacheableError("the kept statements name an as_of this call does not have")
            return as_of
        return datetime.fromisoformat(raw[_INSTANT])
    return raw


def recorded(statement: str, parameters: Any, as_of: datetime | None) -> Recorded:
    """One statement as the cache keeps it: a read, its parameters in their JSON form."""
    if not statement.lstrip().lower().startswith(_READ_VERBS):
        raise UncacheableError("a cached read sent a statement that is not a read")
    if _SIDE_EFFECTS.search(statement):
        raise UncacheableError("a cached read sent a statement with a side effect")
    if parameters is not None and not isinstance(parameters, Mapping):
        raise UncacheableError("positional parameters")
    named = {} if parameters is None else {str(k): _parameter(v, as_of) for k, v in parameters.items()}
    return Recorded(statement, named)


def fingerprint(conn: Connection, read: Recorded, as_of: datetime | None) -> str:
    """The rows `read` returns now, as a count and an order-free hash, computed on the server."""
    parameters = {k: _bound(v, as_of) for k, v in read.parameters.items()}
    conn.exec_driver_sql(_EXACT_FLOATS)
    return str(conn.exec_driver_sql(_FINGERPRINT.format(sql=read.sql), parameters or None).scalar_one())


@contextmanager
def snapshot(engine: Engine) -> Iterator[Connection]:
    """A read-only REPEATABLE READ connection: every statement on it sees the store at its first."""
    with engine.connect().execution_options(isolation_level="REPEATABLE READ", postgresql_readonly=True) as conn:
        yield conn


class Recording:
    """The statements a block sent, and the first one the cache could not keep, if any."""

    def __init__(self) -> None:
        self.reads: list[Recorded] = []
        self.refused: UncacheableError | None = None


@contextmanager
def recording(conn: Connection, as_of: datetime | None) -> Iterator[Recording]:
    """Every statement `conn` sends inside the block, as the cache keeps it."""
    record = Recording()

    def listen(*args: Any) -> None:
        try:
            record.reads.append(recorded(args[2], args[3], as_of))
        except UncacheableError as error:
            record.refused = record.refused or error

    event.listen(conn, "before_cursor_execute", listen)
    try:
        yield record
    finally:
        event.remove(conn, "before_cursor_execute", listen)


@dataclass(frozen=True, slots=True)
class CacheKey:
    name: str
    # A digest of the code version and the call's arguments (in their order: a mapping's order can
    # be an argument too, so the caller passes pairs, never a dict).
    arguments: str


def key_of(name: str, arguments: Any, code_version: str) -> CacheKey:
    digest = hashlib.sha256(json.dumps([code_version, arguments], default=str).encode()).hexdigest()
    return CacheKey(f"{CACHE_PREFIX}{name}", digest)


_KEPT: Final = text(
    "select payload->>'arguments' as arguments, payload->'reads' as reads, payload->>'value' as value "
    "from research.model_artifacts where name = :n order by version desc limit 1"
)
_NEXT: Final = text("select coalesce(max(version), 0) + 1 from research.model_artifacts where name = :n")
_INSERT: Final = text(
    "insert into research.model_artifacts (name, version, fit_stamp, fitted_on, payload) "
    "values (:n, :v, :stamp, :on, cast(:payload as jsonb)) on conflict do nothing"
)
_DROP_OLDER: Final = text("delete from research.model_artifacts where name = :n and version < :v")


def _still_true(conn: Connection, reads: Any, as_of: datetime | None) -> bool:
    for kept in reads:
        read = Recorded(kept["sql"], kept["parameters"])
        try:
            if fingerprint(conn, read, as_of) != kept["fingerprint"]:
                return False
        except UncacheableError:
            return False
    return True


class ReadThrough(Protocol):
    """What a cached read is called through: the cache, or `UNCACHED`."""

    def through[T](
        self, conn: Connection, name: str, arguments: Any, as_of: datetime | None, read: Callable[[], T]
    ) -> T: ...


@dataclass(frozen=True, slots=True)
class Uncached:
    """Every read read, nothing kept: the default, so only the nightly's passes use the cache."""

    def through[T](
        self, conn: Connection, name: str, arguments: Any, as_of: datetime | None, read: Callable[[], T]
    ) -> T:
        del conn, name, arguments, as_of
        return read()


UNCACHED: Final = Uncached()


@dataclass(frozen=True, slots=True)
class ReadCache:
    """Kept results by name, read and written on `engine` in their own transactions (a read's
    connection may be read-only, and may be another store's), decoded with `codec`, valid for
    `code_version` only. The fingerprints run on the read's own connection."""

    engine: Engine
    codec: ValueCodec
    code_version: str
    log: Callable[[str], None] = lambda line: None

    def kept[T](self, conn: Connection, key: CacheKey, as_of: datetime | None) -> T | None:
        """The kept result when its arguments are these and every fingerprint still holds on `conn`."""
        with self.engine.connect() as store:
            row = store.execute(_KEPT, {"n": key.name}).first()
        if row is None or row.arguments != key.arguments or not _still_true(conn, row.reads, as_of):
            return None
        try:
            value: T = self.codec.loads(row.value)
        except (UnencodableError, TypeError, ValueError, KeyError) as error:
            self.log(f"read cache: {key.name} kept value does not decode ({error}), read again")
            return None
        return value

    def through[T](
        self, conn: Connection, name: str, arguments: Any, as_of: datetime | None, read: Callable[[], T]
    ) -> T:
        """`read()`'s result: the kept one while every row it read is unchanged, else read and kept."""
        key = key_of(name, arguments, self.code_version)
        kept: T | None = self.kept(conn, key, as_of)
        if kept is not None:
            self.log(f"read cache: {name} served")
            return kept
        with recording(conn, as_of) as record:
            value = read()
        if record.refused is not None:
            self.log(f"read cache: {name} not kept, {record.refused}")
            return value
        level = conn.get_isolation_level()
        if level not in SNAPSHOT_LEVELS:
            self.log(f"read cache: {name} not kept, read at {level}, where its fingerprint could see other rows")
            return value
        try:
            encoded = self.codec.dumps(value)
        except UnencodableError as error:
            self.log(f"read cache: {name} not kept, {error}")
            return value
        reads = [
            {"sql": r.sql, "parameters": r.parameters, "fingerprint": fingerprint(conn, r, as_of)} for r in record.reads
        ]
        self._keep(key, reads, encoded)
        self.log(f"read cache: {name} read and kept ({len(reads)} statements)")
        return value

    def _keep(self, key: CacheKey, reads: list[dict[str, Any]], encoded: str) -> None:
        payload = json.dumps({"arguments": key.arguments, "reads": reads, "value": encoded}, allow_nan=False)
        with self.engine.begin() as conn:
            version = int(conn.execute(_NEXT, {"n": key.name}).scalar_one())
            on = f"a read cache, not a fit: {len(reads)} statements fingerprinted (research.db.read_cache)"
            stamp = datetime.now(UTC)
            conn.execute(_INSERT, {"n": key.name, "v": version, "stamp": stamp, "on": on, "payload": payload})
            conn.execute(_DROP_OLDER, {"n": key.name, "v": version})
