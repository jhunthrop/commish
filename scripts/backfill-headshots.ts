// Backfills `players.headshot_url` for rows ingested before migration 0045 existed (founder
// directive 2026-08-26: show the players' pictures — Tank01's `espnHeadshot` was always in the
// feed; we only started storing it today). Run once after deploying 0045 to any database whose
// players predate it: npm run stats:headshots (dotenv -e .env.local -- tsx scripts/backfill-headshots.ts)
//
// Reuses the process-wide singletons (`@/stats-pipeline`) exactly like `ingest-adp.ts` — the
// same provider, the same request ledger, the same database `getDb()` serves. With
// STATS_PROVIDER=tank01 this is a real-money read (the memoized player list's 2 requests), so
// the budget line prints last and always, the same discipline the other ingest scripts keep.
//
// Idempotent by construction: every write is an absolute upsert of the feed's current URL, so a
// re-run refreshes and never duplicates. A player the feed no longer lists keeps whatever URL
// (or NULL) it already has — this script adds facts, it never invents an absence.
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { players } from "@/db/schema";
import { getIngestionBudget, getStatsProvider } from "@/stats-pipeline";

async function main(): Promise<void> {
  const db = getDb();
  const budget = getIngestionBudget();
  const before = await budget.remaining();

  const listed = await getStatsProvider().listPlayers();
  const withUrl = listed.filter((player) => player.headshotUrl !== null);
  let updated = 0;
  for (const player of withUrl) {
    const rows = await db
      .update(players)
      .set({ headshotUrl: player.headshotUrl })
      .where(eq(players.id, player.id))
      .returning({ id: players.id });
    updated += rows.length;
  }
  console.log(`the feed carries ${withUrl.length} headshot URL(s) across ${listed.length} listed players; ${updated} players rows took one`);

  const remaining = await budget.remaining();
  const metered = getStatsProvider().requestCost === "metered";
  console.log(metered ? `budget: ${before} -> ${remaining} requests remaining` : "this run debited nothing: the configured provider answers locally");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
