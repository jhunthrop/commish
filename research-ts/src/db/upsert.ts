import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/** A bare, lowercase SQL identifier — the only shape safe to interpolate via `sql.raw`. */
const SAFE_SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * `column.name` is normally schema-defined, not user input — but both helpers below splice it
 * into `sql.raw` unparameterized, so this asserts it looks like a plain identifier before
 * interpolating it, rather than trusting every current and future caller to only ever pass
 * schema-safe table shapes.
 */
function assertSafeIdentifier(name: string, caller: string): string {
  if (!SAFE_SQL_IDENTIFIER.test(name)) {
    throw new Error(`${caller}: unsafe SQL identifier "${name}".`);
  }
  return name;
}

/** The table's own SQL name, for the one expression below that has to spell it out. */
function tableNameOf<T extends PgTable>(table: T): string {
  return getTableName(table);
}

/** The table's own columns, excluding the conflict-target `keys` (JS property names). */
function nonKeyColumns<T extends PgTable>(table: T, keys: readonly string[]) {
  return Object.entries(getTableColumns(table)).filter(([key]) => !keys.includes(key));
}

/**
 * The value one non-key column actually receives on conflict.
 *
 * Normally `excluded.<column>` — the incoming row wins outright. A column named in `keepWhenNull`
 * (JS property names) is written as `COALESCE(excluded.<column>, <table>.<column>)` instead, which
 * means "the incoming row wins when it HAS a value, and a stored value survives an incoming null".
 *
 * WHAT THAT IS FOR, and it is narrow on purpose: a nullable column added to an existing archive
 * after the rows were written. A re-ingestion that can resolve the new fact fills it; one that
 * cannot (an upstream file that has not published it for that row yet) leaves what is already
 * there rather than erasing a fact the archive has and the current run does not. Every other
 * column keeps the plain last-writer-wins rule, because for them an incoming null IS the fact.
 *
 * Shared by `excludedSetFor` and `changedRowWhere` so the value a row is compared against is
 * always, by construction, the value it would be written to.
 */
function incomingExpression(columnName: string, tableName: string, keep: boolean, caller: string): SQL {
  const column = assertSafeIdentifier(columnName, caller);
  if (!keep) return sql.raw(`excluded.${column}`);
  return sql.raw(`coalesce(excluded.${column}, ${assertSafeIdentifier(tableName, caller)}.${column})`);
}

/**
 * Builds an `onConflictDoUpdate` `set` clause that assigns every non-key column to its
 * `excluded.<column>` value, so callers never hand-list columns (and can't forget one when
 * the schema grows) and never accidentally write a no-op self-assignment (e.g.
 * `{ set: { playerId: rosterSlots.playerId } }`, which updates a column to itself instead of
 * to the incoming row). `keys` are the JS property names of the conflict target columns.
 *
 * `keepWhenNull` names the columns an incoming null must NOT erase — see `incomingExpression`.
 */
export function excludedSetFor<T extends PgTable>(table: T, keys: readonly string[], keepWhenNull: readonly string[] = []): Record<string, SQL> {
  const tableName = tableNameOf(table);
  return Object.fromEntries(
    nonKeyColumns(table, keys).map(([key, column]) => [
      key,
      incomingExpression(column.name, tableName, keepWhenNull.includes(key), "excludedSetFor"),
    ]),
  );
}

/**
 * Builds an `onConflictDoUpdate` `where` clause that only fires an update when at least one
 * non-key column's incoming value actually differs from what's stored — a row-value
 * `IS DISTINCT FROM` comparison over every non-key column, the same set `excludedSetFor` assigns.
 *
 * This is what makes an upsert's own idempotency independent of whatever the CALLER believes
 * changed: a caller that resubmits a row with values identical to what's already stored (a lost
 * cache, a retried tick, a re-ingested week) produces no update and no row in `RETURNING` for
 * it — the write genuinely didn't happen, rather than merely being labeled a no-op after the
 * fact. `src/stats-pipeline/persist.ts` uses `RETURNING` row counts against this `where` to
 * decide whether `stat_weeks.version` truly needs to advance, rather than trusting the tick's
 * own `changed` list (which can be stale the moment its source — a Redis digest snapshot — is
 * lost or evicted).
 */
export function changedRowWhere<T extends PgTable>(table: T, keys: readonly string[], keepWhenNull: readonly string[] = []): SQL {
  const tableName = tableNameOf(table);
  const entries = nonKeyColumns(table, keys);
  const tableSide = sql.join(entries.map(([, column]) => sql`${column}`), sql`, `);
  const incomingSide = sql.join(
    entries.map(([key, column]) => incomingExpression(column.name, tableName, keepWhenNull.includes(key), "changedRowWhere")),
    sql`, `,
  );
  return sql`(${tableSide}) IS DISTINCT FROM (${incomingSide})`;
}
