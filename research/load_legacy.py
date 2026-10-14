"""THE ONE-SHOT LEGACY LOAD: the legacy `public` research tables copied into the `research` schema.

    LEGACY_DATABASE_URL=... RESEARCH_DATABASE_URL=... uv run python -m research.load_legacy [--replace]

Run once per target: in development from the local copy of production (localhost:5432/commish,
`public`) into a `research` schema migrated by alembic, and once at cutover from production into
the Neon `commish` database. The source is opened read only. Every research table is filled from
its legacy counterpart through `research.db.legacy`, in foreign-key order, inside ONE target
transaction: a load that fails anywhere leaves the target exactly as it was.

THE SOURCE IS READ FROM ONE SNAPSHOT: a single REPEATABLE READ, READ ONLY transaction holds for
the whole load, so every table is copied as of the same moment even if a legacy writer runs; a
snapshot that cannot be held fails the load with `SnapshotError` and nothing is written. The
legacy writers (the Vercel cron's jobs) are still stopped before the cutover load.

Before a table is copied, its legacy entry must account for every legacy column (read, or dropped
with a reason), a column dropped as a constant must hold only that constant, and every invariant a
derivation relies on must hold. One of those is how a board's reasons find their board: a legacy
reason carries no stamp, so it takes the one `as_of` generation its `(season, source)` holds in
`preseason_projections` (the TypeScript deleted and replaced the two together), and the load
refuses if any `(season, source)` holds more than one. After, the
manifest prints, per table, the legacy row count, the rows kept by design, and the rows that
landed. A table whose landed count differs from its legacy count fails the load unless its entry
keeps rows by a stated filter, and then the landed count must equal the filtered count exactly.
Counts are not enough to trust a copy, so each table is also fingerprinted on both sides: the md5
of every row's text, sorted and hashed again, over the legacy rows as research rows and over what
landed. A table whose fingerprints differ fails the load.
The URLs are never printed.
"""

import argparse
import logging
import sys
from collections.abc import Sequence
from dataclasses import dataclass

import psycopg
from psycopg import IsolationLevel
from psycopg.errors import SerializationFailure, SnapshotTooOld
from sqlalchemy import Table

from research.db.legacy import LEGACY_SCHEMA, LEGACY_TABLES, NEW_IN_RESEARCH, NOT_CARRIED, LegacyTable, check_complete
from research.db.schema import METADATA, RESEARCH_SCHEMA
from research.db.url import database_url_from_env
from research.errors import ResearchError
from research.logging_setup import configure_logging

SOURCE_VARIABLE = "LEGACY_DATABASE_URL"
TARGET_VARIABLE = "RESEARCH_DATABASE_URL"
_READ_ONLY = "-c default_transaction_read_only=on"


class LoadError(ResearchError):
    """The load refused or failed; the target transaction was rolled back."""


class SnapshotError(LoadError):
    """The source could not be read from one snapshot: the copy would not be of one moment."""


def _open_snapshot(source: psycopg.Connection) -> None:
    """One REPEATABLE READ, READ ONLY transaction on the source for the whole load: every count,
    COPY and fingerprint of every table reads the same snapshot, so the copy is of one moment even
    while the legacy writers run (they should still be stopped for the cutover, README)."""
    source.isolation_level = IsolationLevel.REPEATABLE_READ
    source.read_only = True
    source.execute("set timezone = 'UTC'")
    row = source.execute("select current_setting('transaction_isolation')").fetchone()
    if row is None or row[0] != "repeatable read":
        raise SnapshotError(
            f"the source transaction runs at {row[0] if row else 'an unknown level'}, not repeatable read"
        )


@dataclass(frozen=True)
class ManifestRow:
    table: str
    legacy: str
    legacy_rows: int
    kept_rows: int
    landed_rows: int
    filter_why: str | None
    fingerprints_match: bool

    @property
    def explained(self) -> bool:
        if self.landed_rows != self.kept_rows or not self.fingerprints_match:
            return False
        return self.legacy_rows == self.kept_rows or self.filter_why is not None


def _libpq(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def _legacy_columns(source: psycopg.Connection, entry: LegacyTable) -> list[str]:
    rows = source.execute(
        "select column_name from information_schema.columns where table_schema = %s and table_name = %s",
        (LEGACY_SCHEMA, entry.legacy),
    ).fetchall()
    return [str(row[0]) for row in rows]


def _check_entry(source: psycopg.Connection, entry: LegacyTable) -> None:
    problems = entry.unaccounted(_legacy_columns(source, entry))
    if problems:
        raise LoadError("; ".join(problems))
    for column, dropped in entry.dropped.items():
        if dropped.constant is None:
            continue
        others = source.execute(
            f'select count(*) from "{LEGACY_SCHEMA}"."{entry.legacy}" where "{column}" is distinct from %s',
            (dropped.constant,),
        ).fetchone()
        if others is None or others[0] != 0:
            raise LoadError(f"{entry.legacy}.{column} is dropped as the constant {dropped.constant!r} but holds others")
    for invariant in entry.invariants:
        broken = _count(source, entry.violations_sql(invariant))
        if broken:
            raise LoadError(f"{entry.legacy}: {broken} row(s) break the invariant the map relies on ({invariant.why})")


def _count(conn: psycopg.Connection, sql: str) -> int:
    row = conn.execute(sql).fetchone()
    return int(row[0]) if row is not None else 0


def _copy(source: psycopg.Connection, target: psycopg.Connection, entry: LegacyTable, table: Table) -> None:
    columns = [c.name for c in table.columns]
    listed = ", ".join(f'"{c}"' for c in columns)
    with (
        source.cursor().copy(f"COPY ({entry.select_sql(columns)}) TO STDOUT") as out,
        target.cursor().copy(f'COPY "{RESEARCH_SCHEMA}"."{table.name}" ({listed}) FROM STDIN') as into,
    ):
        for block in out:
            into.write(block)
    for column in (c for c in table.columns if c.identity is not None):
        target.execute(
            f"select setval(pg_get_serial_sequence('{RESEARCH_SCHEMA}.{table.name}', '{column.name}'), "
            f'coalesce((select max("{column.name}") from "{RESEARCH_SCHEMA}"."{table.name}"), 0) + 1, false)'
        )


def _fingerprint(conn: psycopg.Connection, rows_sql: str) -> str:
    """Order-independent: the md5 of each row's text, sorted, hashed once more."""
    row = conn.execute(
        "select md5(coalesce(string_agg(h, '' order by h), '')) "
        f"from (select md5(r::text) as h from ({rows_sql}) as r) as hashed"
    ).fetchone()
    return str(row[0]) if row is not None else ""


def _load_table(source: psycopg.Connection, target: psycopg.Connection, table: Table) -> ManifestRow:
    entry = LEGACY_TABLES[table.name]
    _check_entry(source, entry)
    legacy_rows = _count(source, f'select count(*) from "{LEGACY_SCHEMA}"."{entry.legacy}"')
    kept_rows = _count(source, entry.count_sql())
    _copy(source, target, entry, table)
    landed = _count(target, f'select count(*) from "{RESEARCH_SCHEMA}"."{table.name}"')
    columns = [c.name for c in table.columns]
    listed = ", ".join(f'"{c}"' for c in columns)
    same = _fingerprint(source, entry.select_sql(columns)) == _fingerprint(
        target, f'select {listed} from "{RESEARCH_SCHEMA}"."{table.name}"'
    )
    why = entry.keep.why if entry.keep else None
    return ManifestRow(table.name, entry.legacy, legacy_rows, kept_rows, landed, why, same)


def _prepare_target(target: psycopg.Connection, replace: bool) -> None:
    names = [t.name for t in METADATA.sorted_tables]
    occupied = [n for n in names if _count(target, f'select count(*) from "{RESEARCH_SCHEMA}"."{n}"') > 0]
    if occupied and not replace:
        raise LoadError(f"the target already holds rows in {', '.join(occupied)}; pass --replace to load over them")
    if occupied:
        listed = ", ".join(f'"{RESEARCH_SCHEMA}"."{n}"' for n in names)
        target.execute(f"TRUNCATE {listed}")


def load(source_url: str, target_url: str, replace: bool) -> list[ManifestRow]:
    check_complete()
    manifest: list[ManifestRow] = []
    with (
        psycopg.connect(_libpq(source_url), options=_READ_ONLY) as source,
        psycopg.connect(_libpq(target_url)) as target,
    ):
        _prepare_target(target, replace)
        # UTC on both sides so the text COPY renders instants identically.
        _open_snapshot(source)
        target.execute("set timezone = 'UTC'")
        try:
            for table in METADATA.sorted_tables:
                if table.name not in NEW_IN_RESEARCH:
                    manifest.append(_load_table(source, target, table))
        except (SerializationFailure, SnapshotTooOld) as lost:
            target.rollback()
            raise SnapshotError(f"the source snapshot could not be held ({lost}); nothing was written") from lost
        failed = [row.table for row in manifest if not row.explained]
        if failed:
            target.rollback()
            print_manifest(manifest)
            raise LoadError(f"unexplained mismatch in {', '.join(failed)}; nothing was written")
        target.commit()
    return manifest


def print_manifest(manifest: Sequence[ManifestRow]) -> None:
    header = f"{'research table':<30} {'legacy table':<30} {'legacy':>9} {'kept':>9} {'landed':>9} {'rows':>5}  result"
    lines = [header, "-" * len(header)]
    for row in manifest:
        verdict = "ok" if row.explained else "MISMATCH"
        rows = "same" if row.fingerprints_match else "DIFF"
        lines.append(
            f"{row.table:<30} {row.legacy:<30} {row.legacy_rows:>9} {row.kept_rows:>9} {row.landed_rows:>9} "
            f"{rows:>5}  {verdict}"
        )
        if row.filter_why is not None and row.kept_rows != row.legacy_rows:
            lines.append(f"  {row.legacy_rows - row.kept_rows} left behind by design: {row.filter_why}")
    lines.extend(f"not carried: {name} ({why})" for name, why in NOT_CARRIED.items())
    lines.append(
        f"load: {len(manifest)} tables, {sum(r.legacy_rows for r in manifest)} legacy rows, "
        f"{sum(r.landed_rows for r in manifest)} landed"
    )
    sys.stdout.write("\n".join(lines) + "\n")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.load_legacy", description="copy the legacy tables into research")
    parser.add_argument("--replace", action="store_true", help="truncate the research tables first")
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    try:
        manifest = load(database_url_from_env(SOURCE_VARIABLE), database_url_from_env(TARGET_VARIABLE), args.replace)
    except LoadError as refusal:
        sys.stderr.write(f"load_legacy: {refusal}\n")
        return 1
    print_manifest(manifest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
