import { getDb } from "@/db/client";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { seedDevLeagues } from "./seed-dev-leagues";
import { seedPlayers } from "./seed-players";

/**
 * The ONE seed entry point (`npm run seed`). Later steps add seeders here — a demo league,
 * public leagues at various fill levels — never as separate ad-hoc scripts.
 */
async function main(): Promise<void> {
  const db = getDb();
  const playerCounts = await seedPlayers(db, createMockStatsProvider());
  console.log(`seeded ${playerCounts.players} players and ${playerCounts.statLines} stat lines`);
  const dev = await seedDevLeagues(db, { now: () => new Date().toISOString() });
  console.log(`seeded ${dev.leagues} dev leagues, ${dev.teams} teams and ${dev.drafts} scheduled drafts`);
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
