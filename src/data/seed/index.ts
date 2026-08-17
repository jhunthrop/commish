import { getDb } from "@/db/client";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { seedPlayers } from "./seed-players";

/**
 * The ONE seed entry point (`npm run seed`). Later steps add seeders here — a demo league,
 * public leagues at various fill levels — never as separate ad-hoc scripts.
 */
async function main(): Promise<void> {
  const db = getDb();
  const result = await seedPlayers(db, createMockStatsProvider());
  console.log(`seeded ${result.players} players and ${result.statLines} stat lines`);
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
