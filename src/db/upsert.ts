import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Builds an `onConflictDoUpdate` `set` clause that assigns every non-key column to its
 * `excluded.<column>` value, so callers never hand-list columns (and can't forget one when
 * the schema grows) and never accidentally write a no-op self-assignment (e.g.
 * `{ set: { playerId: rosterSlots.playerId } }`, which updates a column to itself instead of
 * to the incoming row). `keys` are the JS property names of the conflict target columns.
 */
export function excludedSetFor<T extends PgTable>(table: T, keys: readonly string[]): Record<string, SQL> {
  const columns = getTableColumns(table);
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !keys.includes(key))
      .map(([key, column]) => [key, sql.raw(`excluded.${column.name}`)]),
  );
}
