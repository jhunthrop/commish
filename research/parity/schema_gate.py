"""THE SCHEMA GATE: a database built by alembic must equal one built by drizzle, catalog for catalog.

Read from Postgres's own catalog rather than from either tool's idea of the schema, so the
comparison is of what each actually created: column order, types, nullability and defaults;
every constraint's definition; every index's definition; every enum's labels; every sequence and
what owns it. At `0001_baseline` the two must be identical for the research tables. At head the
only allowed difference is the one this lane's second revision makes on purpose.
"""

from collections.abc import Iterable
from dataclasses import dataclass

import psycopg

from research.db.schema import METADATA
from research.parity import databases

RESEARCH_TABLES: tuple[str, ...] = tuple(sorted(METADATA.tables))
ENUM_TYPES: tuple[str, ...] = ("board_moment_kind", "capsule_source", "player_position", "week_status")

# The deliberate head-only difference: revision 0002 adds the implementation tag to the register.
HEAD_ONLY: frozenset[str] = frozenset(
    {
        "column register_freeze_rows.implementation text null default 'typescript'::text",
        "ordinal register_freeze_rows.15 implementation",
    }
)

COLUMNS_SQL = """
select c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
       pg_get_expr(d.adbin, d.adrelid)
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = 'public' and c.relname = any(%s) and a.attnum > 0 and not a.attisdropped
order by c.relname, a.attnum
"""

CONSTRAINTS_SQL = """
select c.relname, k.conname, pg_get_constraintdef(k.oid)
from pg_constraint k
join pg_class c on c.oid = k.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = any(%s)
"""

INDEXES_SQL = """
select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any(%s)
"""

ENUMS_SQL = """
select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder)
from pg_type t join pg_enum e on e.enumtypid = t.oid
where t.typname = any(%s) group by t.typname
"""

SEQUENCES_SQL = """
select s.relname, t.relname, a.attname
from pg_class s
join pg_depend d on d.objid = s.oid and d.deptype = 'a'
join pg_class t on t.oid = d.refobjid
join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
where s.relkind = 'S' and t.relname = any(%s)
"""


def catalog(url: str, tables: Iterable[str] = RESEARCH_TABLES) -> frozenset[str]:
    """Every catalog fact about `tables` as one comparable line each."""
    names = list(tables)
    facts: set[str] = set()
    with psycopg.connect(url) as conn:
        for table, ordinal, column, type_, notnull, default in conn.execute(COLUMNS_SQL, (names,)):
            null = "not null" if notnull else "null"
            facts.add(f"column {table}.{column} {type_} {null} default {default}".replace(" default None", ""))
            facts.add(f"ordinal {table}.{ordinal} {column}")
        for table, name, definition in conn.execute(CONSTRAINTS_SQL, (names,)):
            facts.add(f"constraint {table}.{name} {definition}")
        for table, name, definition in conn.execute(INDEXES_SQL, (names,)):
            facts.add(f"index {table}.{name} {definition}")
        for name, labels in conn.execute(ENUMS_SQL, (list(ENUM_TYPES),)):
            facts.add(f"enum {name} {labels}")
        for sequence, table, column in conn.execute(SEQUENCES_SQL, (names,)):
            facts.add(f"sequence {sequence} owned by {table}.{column}")
    return frozenset(facts)


@dataclass(frozen=True)
class SchemaGateResult:
    """What the gate found: catalog lines only one side has, at the baseline and at head."""

    facts_compared: int
    baseline_only_drizzle: frozenset[str]
    baseline_only_alembic: frozenset[str]
    head_unexpected: frozenset[str]

    @property
    def passed(self) -> bool:
        return not (self.baseline_only_drizzle or self.baseline_only_alembic or self.head_unexpected)


def run_schema_gate() -> SchemaGateResult:
    drizzle = catalog(databases.build_with_drizzle("parity_schema_drizzle"))
    baseline = catalog(databases.build_with_alembic("parity_schema_alembic", "0001_baseline"))
    head = catalog(databases.build_with_alembic("parity_schema_alembic", "head"))
    # Head may differ from drizzle only by HEAD_ONLY, and only by adding it.
    unexpected = ((head - drizzle) - HEAD_ONLY) | (drizzle - head)
    missing = HEAD_ONLY - head
    unexpected |= frozenset(f"missing at head: {line}" for line in missing)
    return SchemaGateResult(
        facts_compared=len(drizzle),
        baseline_only_drizzle=drizzle - baseline,
        baseline_only_alembic=baseline - drizzle,
        head_unexpected=frozenset(unexpected),
    )
