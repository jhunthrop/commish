import type { Db } from "@/db/client";
import { players, playerStatLines } from "@/db/schema";
import { excludedSetFor } from "@/db/upsert";
import type { StatsProvider } from "@/stats/provider";
import { assertLocalSeedTarget } from "./guard";

const BATCH = 500;

function chunks<T>(arr: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Idempotent: upserts players AND stat lines from the provider — existing rows are updated
 * to the provider's current values, not left stale (a licensed feed can revise a stat line
 * mid-week). The returned counts are the number of players / stat lines the provider
 * supplied for this run, not the number of rows newly inserted (the two are identical only
 * on a fresh, empty database). Safe to run repeatedly.
 *
 * Guarded in its own right, not only at the entry point: this is the largest write in the
 * repo (every player × every week) and the one that used to run before any check at all.
 */
export async function seedPlayers(db: Db, provider: StatsProvider): Promise<{ players: number; statLines: number }> {
  assertLocalSeedTarget();
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
