import { getDb } from "@/db/client";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { DEV_SEED } from "./config";
import { assertLocalSeedTarget } from "./guard";
import { seedDevLeagues } from "./seed-dev-leagues";
import { seedPlayers } from "./seed-players";
import { seedPublicLeagues } from "./seed-public-leagues";
import { seedSeasonLeague } from "./seed-season-league";

/**
 * The ONE seed entry point (`npm run seed`). Later steps add seeders here — a demo league,
 * public leagues at various fill levels — never as separate ad-hoc scripts.
 */
async function main(): Promise<void> {
  // BEFORE getDb(), and before the first upsert: `seedPlayers` mass-upserts every `players`
  // and `player_stat_lines` row, so a guard placed after it would fire far too late.
  assertLocalSeedTarget();
  const db = getDb();
  const playerCounts = await seedPlayers(db, createMockStatsProvider());
  console.log(`seeded ${playerCounts.players} players and ${playerCounts.statLines} stat lines`);
  // The only place that reads DEV_SEED_CLAIM_USER_ID — seedDevLeagues takes it as an explicit
  // parameter rather than reaching into process.env itself. See seed-dev-leagues.ts.
  const claimUserId = process.env[DEV_SEED.claimUserIdEnvVar];
  const dev = await seedDevLeagues(db, { now: () => new Date().toISOString() }, claimUserId);
  console.log(`seeded ${dev.leagues} dev leagues, ${dev.teams} teams and ${dev.drafts} scheduled drafts`);
  const season = await seedSeasonLeague(db, { now: () => new Date().toISOString() }, claimUserId);
  console.log(`seeded a ${season.teams}-team season league with ${season.weeks} weeks (${season.scoredWeeks} scored)`);
  const open = await seedPublicLeagues(db, { now: () => new Date().toISOString() });
  console.log(`seeded ${open.leagues} public matchmaking leagues with ${open.teams} joined managers`);
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
