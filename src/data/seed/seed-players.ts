import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { players, playerStatLines } from "@/db/schema";
import type { StatsProvider } from "@/stats/provider";

const BATCH = 500;

function chunks<T>(arr: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Builds an `onConflictDoUpdate` `set` clause that assigns every non-key column to its
 * `excluded.<column>` value, so callers never hand-list columns (and can't forget one when
 * the schema grows). `keys` are the JS property names of the conflict target columns.
 */
function excludedSetFor<T extends PgTable>(table: T, keys: readonly string[]): Record<string, SQL> {
  const columns = getTableColumns(table);
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => !keys.includes(key))
      .map(([key, column]) => [key, sql.raw(`excluded.${column.name}`)]),
  );
}

/**
 * Idempotent: upserts players AND stat lines from the provider — existing rows are updated
 * to the provider's current values, not left stale (a licensed feed can revise a stat line
 * mid-week). The returned counts are the number of players / stat lines the provider
 * supplied for this run, not the number of rows newly inserted (the two are identical only
 * on a fresh, empty database). Safe to run repeatedly.
 */
export async function seedPlayers(db: Db, provider: StatsProvider): Promise<{ players: number; statLines: number }> {
  const allPlayers = await provider.listPlayers();
  for (const batch of chunks(allPlayers, BATCH)) {
    await db
      .insert(players)
      .values(batch.map((p) => ({ id: p.id, name: p.name, position: p.position, nflTeam: p.nflTeam })))
      .onConflictDoUpdate({ target: players.id, set: excludedSetFor(players, ["id"]) });
  }

  let statCount = 0;
  // Ask the provider week by week — the interface is week-scoped so a live feed can be polled the same way.
  for (let week = 1; ; week++) {
    const lines = await provider.getWeeklyStatLines(week);
    if (lines.length === 0) break;
    for (const batch of chunks(lines, BATCH)) {
      await db
        .insert(playerStatLines)
        .values([...batch])
        .onConflictDoUpdate({
          target: [playerStatLines.playerId, playerStatLines.week],
          set: excludedSetFor(playerStatLines, ["playerId", "week"]),
        });
    }
    statCount += lines.length;
  }
  return { players: allPlayers.length, statLines: statCount };
}
