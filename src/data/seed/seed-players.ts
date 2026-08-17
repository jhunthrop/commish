import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players, playerStatLines } from "@/db/schema";
import type { StatsProvider } from "@/stats/provider";

const BATCH = 500;

function chunks<T>(arr: readonly T[], size: number): readonly (readonly T[])[] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Idempotent: upserts players and stat lines from the provider. Safe to run repeatedly. */
export async function seedPlayers(db: Db, provider: StatsProvider): Promise<{ players: number; statLines: number }> {
  const allPlayers = await provider.listPlayers();
  for (const batch of chunks(allPlayers, BATCH)) {
    await db
      .insert(players)
      .values(batch.map((p) => ({ id: p.id, name: p.name, position: p.position, nflTeam: p.nflTeam })))
      .onConflictDoUpdate({ target: players.id, set: { name: sql`excluded.name`, position: sql`excluded.position`, nflTeam: sql`excluded.nfl_team` } });
  }

  let statCount = 0;
  // Ask the provider week by week — the interface is week-scoped so a live feed can be polled the same way.
  for (let week = 1; ; week++) {
    const lines = await provider.getWeeklyStatLines(week);
    if (lines.length === 0) break;
    for (const batch of chunks(lines, BATCH)) {
      await db.insert(playerStatLines).values([...batch]).onConflictDoNothing({ target: [playerStatLines.playerId, playerStatLines.week] });
    }
    statCount += lines.length;
  }
  return { players: allPlayers.length, statLines: statCount };
}
