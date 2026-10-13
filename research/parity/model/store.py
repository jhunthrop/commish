"""THE STORE AS IT STOOD: a point-in-time copy of the dev database for each side of a model case.

The model cases run on real data, the dev copy restored from the production dump
(`PARITY_SOURCE_DATABASE_URL`, opened read only, `public`), because no recording could stand in for
four seasons of observations. A board is rebuilt at a past moment, so the copy is the store AS IT
STOOD at that moment: every legacy row whose own write stamp (`ingested_at`, `fetched_at`,
`captured_at`, `created_at`, `resolved_at`, `computed_at`, `frozen_at`) is at or before it. An
`as_of` alone is not enough: the win totals are stamped with the publisher's date, two days
before the job that wrote them ran, and a box score is stamped after its game but written later
still. `model_artifacts` is copied whole, because the fits it holds are inputs the code pins, not
facts the store learned.

The TypeScript side reads the copy as it is (the drizzle-built legacy schema); the Python side
reads the same rows through phase A's loader, in a research schema migrated by alembic, with the
oracle's committed fits seeded as artifacts.
"""

import json
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Final

import psycopg
from sqlalchemy import Engine

from research.db.engine import make_engine
from research.db.legacy import LEGACY_TABLES
from research.db.url import database_url_from_env, sqlalchemy_url
from research.load_legacy import load
from research.model.artifacts import publish_artifact
from research.model.instants import js_iso
from research.model.seed import committed_at
from research.parity import databases

SOURCE_VARIABLE: Final = "PARITY_SOURCE_DATABASE_URL"
_WRITE_STAMPS: Final = (
    "ingested_at",
    "created_at",
    "fetched_at",
    "captured_at",
    "resolved_at",
    "computed_at",
    "frozen_at",
)
_COPIED_WHOLE: Final = frozenset(("model_artifacts",))
_REPO: Final = Path(__file__).resolve().parents[3]
_EXPORTER: Final = _REPO / "research" / "parity" / "ts" / "artifacts.ts"


def source_url() -> str:
    return database_url_from_env(SOURCE_VARIABLE).replace("postgresql+psycopg://", "postgresql://", 1)


def _columns(conn: psycopg.Connection, table: str) -> list[str]:
    rows = conn.execute(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = %s order by ordinal_position",
        (table,),
    )
    return [str(row[0]) for row in rows]


# A board's reasons carry no write stamp of their own: they belong to the generation of their
# (season, source) in `preseason_projections`, and are kept exactly when that generation is.
_REASONS_OF_A_KEPT_GENERATION: Final = (
    ' as r where exists (select 1 from public."preseason_projections" as p'
    " where p.season = r.season and p.source = r.source and p.as_of <= %(moment)s)"
)
# A stored board is the claim made AT its moment (`as_of`), written a few seconds later: a copy
# of the store at that moment holds the board, so the fit check has its generation to compare.
_BOARD_AT_ITS_MOMENT: Final = ' where "as_of" <= %(moment)s'


def _filter_for(table: str, columns: list[str]) -> str:
    if table in _COPIED_WHOLE:
        return ""
    if table == "preseason_board_reasons":
        return _REASONS_OF_A_KEPT_GENERATION
    if table == "preseason_projections":
        return _BOARD_AT_ITS_MOMENT
    stamp = next((column for column in _WRITE_STAMPS if column in columns), None)
    return "" if stamp is None else f' where "{stamp}" <= %(moment)s'


def _copy_table(source: psycopg.Connection, target: psycopg.Connection, table: str, moment: datetime) -> None:
    columns = _columns(source, table)
    order = ' order by "id"' if "id" in columns else ""
    listed = ", ".join(f'"{column}"' for column in columns)
    query = (
        f'copy (select {listed} from public."{table}"{_filter_for(table, columns)}{order}) to stdout (format binary)'
    )
    with (
        source.cursor().copy(query, {"moment": moment}) as out,
        target.cursor().copy(f'copy "{table}" ({listed}) from stdin (format binary)') as into,
    ):
        for chunk in out:
            into.write(chunk)
    sequence = (
        target.execute("select pg_get_serial_sequence(%s, 'id')", (f'public."{table}"',)).fetchone()
        if "id" in columns
        else None
    )
    if sequence is not None and sequence[0] is not None:
        # The copied ids are the dev copy's; the sequence moves past them so a new row can land.
        target.execute(
            f'select setval(%s, coalesce((select max(id) from public."{table}"), 0) + 1, false)',
            (sequence[0],),
        )


def legacy_copy_at(moment: datetime, database: str) -> str:
    """A drizzle-built scratch database holding the dev store as it stood at `moment`."""
    url = databases.build_with_drizzle(database)
    with psycopg.connect(source_url()) as source, psycopg.connect(url) as target:
        source.read_only = True
        target.execute("set session_replication_role = replica")
        for entry in LEGACY_TABLES.values():
            _copy_table(source, target, entry.legacy, moment)
        target.commit()
    return url


def oracle_fits() -> dict[str, dict[str, object]]:
    """The oracle's committed fits, as `ts/artifacts.ts` prints them."""
    completed = subprocess.run(["npx", "tsx", str(_EXPORTER)], cwd=_REPO, check=True, capture_output=True, text=True)
    exported: dict[str, dict[str, object]] = json.loads(completed.stdout)
    return exported


@dataclass(frozen=True, slots=True)
class ScratchPair:
    """One case's two scratch databases: the legacy copy and its research twin."""

    moment: datetime
    legacy_url: str
    research_url: str

    def research_engine(self) -> Engine:
        return make_engine(sqlalchemy_url(self.research_url))


def scratch_pair_at(moment: datetime, label: str, fits: dict[str, dict[str, object]]) -> ScratchPair:
    """The legacy copy at `moment`, loaded into a research schema, with the fits seeded."""
    legacy = legacy_copy_at(moment, f"parity_model_{label}_legacy")
    research = databases.build_with_alembic(f"parity_model_{label}_research")
    load(sqlalchemy_url(legacy), sqlalchemy_url(research), replace=False)
    engine = make_engine(sqlalchemy_url(research))
    with engine.begin() as conn:
        for name, entry in fits.items():
            file = str(entry["file"])
            publish_artifact(
                conn,
                name,
                1,
                entry["payload"],
                committed_at(file),
                f"the committed constant {file} (parity seed at {js_iso(moment)})",
            )
    engine.dispose()
    return ScratchPair(moment, legacy, research)
