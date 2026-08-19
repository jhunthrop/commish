import { getTableColumns, sql, type SQL } from "drizzle-orm";
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

/** The table's own columns, excluding the conflict-target `keys` (JS property names). */
function nonKeyColumns<T extends PgTable>(table: T, keys: readonly string[]) {
  return Object.entries(getTableColumns(table)).filter(([key]) => !keys.includes(key));
}

/**
 * Builds an `onConflictDoUpdate` `set` clause that assigns every non-key column to its
 * `excluded.<column>` value, so callers never hand-list columns (and can't forget one when
 * the schema grows) and never accidentally write a no-op self-assignment (e.g.
 * `{ set: { playerId: rosterSlots.playerId } }`, which updates a column to itself instead of
 * to the incoming row). `keys` are the JS property names of the conflict target columns.
 */
export function excludedSetFor<T extends PgTable>(table: T, keys: readonly string[]): Record<string, SQL> {
  return Object.fromEntries(
    nonKeyColumns(table, keys).map(([key, column]) => {
      assertSafeIdentifier(column.name, "excludedSetFor");
      return [key, sql.raw(`excluded.${column.name}`)];
    }),
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
export function changedRowWhere<T extends PgTable>(table: T, keys: readonly string[]): SQL {
  const columns = nonKeyColumns(table, keys).map(([, column]) => column);
  const tableSide = sql.join(columns.map((column) => sql`${column}`), sql`, `);
  const excludedSide = sql.join(
    columns.map((column) => sql.raw(`excluded.${assertSafeIdentifier(column.name, "changedRowWhere")}`)),
    sql`, `,
  );
  return sql`(${tableSide}) IS DISTINCT FROM (${excludedSide})`;
}
