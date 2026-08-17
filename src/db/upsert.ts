import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/** A bare, lowercase SQL identifier — the only shape safe to interpolate via `sql.raw`. */
const SAFE_SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Builds an `onConflictDoUpdate` `set` clause that assigns every non-key column to its
 * `excluded.<column>` value, so callers never hand-list columns (and can't forget one when
 * the schema grows) and never accidentally write a no-op self-assignment (e.g.
 * `{ set: { playerId: rosterSlots.playerId } }`, which updates a column to itself instead of
 * to the incoming row). `keys` are the JS property names of the conflict target columns.
 *
 * `column.name` is normally schema-defined, not user input — but it reaches `sql.raw`
 * unparameterized, so this asserts it looks like a plain identifier before interpolating it,
 * rather than trusting every current and future caller of this helper to only ever pass
 * schema-safe table shapes.
 */
export function excludedSetFor<T extends PgTable>(table: T, keys: readonly string[]): Record<string, SQL> {
  const columns = getTableColumns(table);
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !keys.includes(key))
      .map(([key, column]) => {
        if (!SAFE_SQL_IDENTIFIER.test(column.name)) {
          throw new Error(`excludedSetFor: unsafe SQL identifier "${column.name}" for column "${key}".`);
        }
        return [key, sql.raw(`excluded.${column.name}`)];
      }),
  );
}
