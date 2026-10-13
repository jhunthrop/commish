"""THE SCHEMA GATE: the migrations build exactly the declared schema, and the legacy map is whole.

Three checks, each against a real Postgres:

1. A database migrated by alembic from nothing holds what `research.db.schema` declares, two ways:
   alembic's own metadata comparison finds no difference, and, because that comparison skips CHECK
   constraints, the migrated database's catalog (every column, every constraint from
   `pg_constraint` including the checks, every index) equals that of a database built straight
   from the declaration with `METADATA.create_all`, line for line.
2. Every research table's legacy entry (`research.db.legacy`) accounts for every column of the
   legacy table as the drizzle journal builds it: read into the research table or dropped with a
   reason. A legacy column added on main without a decision here fails the gate.
3. With `--against URL`, a live database's `research` schema equals the migrated one, catalog line
   for catalog line (Postgres's own catalog, so what was actually created is what is compared).
"""

from dataclasses import dataclass

import psycopg
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, pool, text

from research.db.legacy import LEGACY_SCHEMA, LEGACY_TABLES, NOT_CARRIED, check_complete
from research.db.schema import METADATA, RESEARCH_SCHEMA
from research.db.url import sqlalchemy_url
from research.parity import databases

_MIGRATED = "parity_schema_alembic"
_LEGACY = "parity_schema_drizzle"
_DECLARED = "parity_schema_declared"
_VERSION_TABLE = "alembic_version"

COLUMNS_SQL = """
select c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
       pg_get_expr(d.adbin, d.adrelid), a.attidentity
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = %s and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
"""

CONSTRAINTS_SQL = """
select c.relname, k.conname, pg_get_constraintdef(k.oid)
from pg_constraint k
join pg_class c on c.oid = k.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = %s
  -- Postgres 18 catalogues NOT NULL as a named constraint (contype 'n'); 17 does not. Nullability is
  -- compared through the columns query, so these rows would only differ by server version.
  and k.contype <> 'n'
"""

INDEXES_SQL = "select tablename, indexname, indexdef from pg_indexes where schemaname = %s"

LEGACY_COLUMNS_SQL = """
select table_name, column_name from information_schema.columns where table_schema = %s
"""


def catalog(url: str, schema: str = RESEARCH_SCHEMA) -> frozenset[str]:
    """Every catalog fact about one schema's tables as one comparable line each."""
    facts: set[str] = set()
    with psycopg.connect(url) as conn:
        for table, ordinal, column, type_, notnull, default, identity in conn.execute(COLUMNS_SQL, (schema,)):
            null = "not null" if notnull else "null"
            facts.add(f"column {table}.{column} {type_} {null} default {default} identity {identity!r}")
            facts.add(f"ordinal {table}.{ordinal} {column}")
        for table, name, definition in conn.execute(CONSTRAINTS_SQL, (schema,)):
            facts.add(f"constraint {table}.{name} {definition}")
        for table, name, definition in conn.execute(INDEXES_SQL, (schema,)):
            facts.add(f"index {table}.{name} {definition}")
    return frozenset(facts)


def _declared(name: str | None, kind: str, _parent: object) -> bool:
    """The research schema's own tables: not other schemas, not alembic's version table."""
    if kind == "schema":
        return name == RESEARCH_SCHEMA
    return not (kind == "table" and name == "alembic_version")


def metadata_differences(url: str) -> tuple[str, ...]:
    """What alembic's comparison finds between a migrated database and the declared metadata."""
    engine = create_engine(sqlalchemy_url(url), poolclass=pool.NullPool)
    try:
        with engine.connect() as conn:
            context = MigrationContext.configure(
                conn,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    "include_schemas": True,
                    "include_name": _declared,
                },
            )
            return tuple(repr(diff) for diff in compare_metadata(context, METADATA))
    finally:
        engine.dispose()


def legacy_map_problems(url: str) -> tuple[str, ...]:
    """Every legacy column no entry accounts for, every stale entry, every missing legacy table."""
    check_complete()
    columns: dict[str, set[str]] = {}
    with psycopg.connect(url) as conn:
        for table, column in conn.execute(LEGACY_COLUMNS_SQL, (LEGACY_SCHEMA,)):
            columns.setdefault(str(table), set()).add(str(column))
    problems: list[str] = []
    for entry in LEGACY_TABLES.values():
        if entry.legacy not in columns:
            problems.append(f"legacy table {entry.legacy} (for {entry.table}) does not exist")
            continue
        problems.extend(entry.unaccounted(columns[entry.legacy]))
    problems.extend(
        f"legacy table {name} is listed as not carried but does not exist"
        for name in NOT_CARRIED
        if name not in columns
    )
    return tuple(problems)


def build_declared(database: str) -> str:
    """A fresh database holding exactly the declaration, built with `METADATA.create_all`."""
    url = databases.recreate(database)
    engine = create_engine(sqlalchemy_url(url), poolclass=pool.NullPool)
    try:
        with engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{RESEARCH_SCHEMA}"'))
            METADATA.create_all(conn)
    finally:
        engine.dispose()
    return url


def declared_differences(migrated_url: str, declared_url: str) -> tuple[str, ...]:
    """Catalog lines only one side has, alembic's version table aside."""
    migrated = frozenset(line for line in catalog(migrated_url) if f" {_VERSION_TABLE}." not in line)
    declared = catalog(declared_url)
    return (
        *(f"only the migration: {line}" for line in sorted(migrated - declared)),
        *(f"only the declaration: {line}" for line in sorted(declared - migrated)),
    )


@dataclass(frozen=True)
class SchemaGateResult:
    facts: int
    metadata_differences: tuple[str, ...]
    catalog_differences: tuple[str, ...]
    legacy_map_problems: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return not (self.metadata_differences or self.catalog_differences or self.legacy_map_problems)


def run_schema_gate() -> SchemaGateResult:
    try:
        migrated = databases.build_with_alembic(_MIGRATED)
        declared = build_declared(_DECLARED)
        legacy = databases.build_with_drizzle(_LEGACY)
        return SchemaGateResult(
            len(catalog(migrated)),
            metadata_differences(migrated),
            declared_differences(migrated, declared),
            legacy_map_problems(legacy),
        )
    finally:
        for name in (_MIGRATED, _DECLARED, _LEGACY):
            databases.drop(name)


def against_live(url: str) -> tuple[frozenset[str], frozenset[str]]:
    """A live database's `research` schema against a freshly migrated one (the live one is only
    read): catalog lines only the live database has, and lines only the migration has."""
    try:
        migrated = catalog(databases.build_with_alembic(_MIGRATED))
    finally:
        databases.drop(_MIGRATED)
    live = catalog(url)
    return live - migrated, migrated - live
