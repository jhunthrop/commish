// THE PEEK-DOCUMENT BUILD, BY HAND — writes `player_peek_documents` for every scoring hash a league
// is currently using, right now.
//
// Run: npm run peek:documents:build
//
// WHY IT EXISTS SEPARATELY FROM THE EVENTS. Every rebuild in production is event-driven (the peek
// document design's own §3.4 table), and events only fire when an input moves. A deploy that has
// just carried the migration has no documents at all and nothing has moved yet, so the first build
// is the rollout step the design names (§6). After it, the events keep the rows fresh and this
// script is only ever an operator's deliberate re-run.
//
// IT RUNS THE JOB'S OWN STEP, not a second writer. The step backfills any missing
// `leagues.scoring_hash` first and then calls `writePeekDocuments`, which is exactly what a queued
// rebuild does, so a hand run and a queued run cannot produce different rows.
//
// IT IS IDEMPOTENT IN CONTENT. `writePeekDocuments` counts only rows that actually changed. It is
// not idempotent in ROWS: each run stamps a new `as_of` generation, which is what a point-in-time
// store is for.
import { createDb } from "@research/db/client";
import { backfillLeagueScoringHashes, scoringHashesInUse } from "@/league-service/scoring-hash";
import { runPeekDocumentStep } from "@/jobs/defs/peek-document-job";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set. Run this through `npm run peek:documents:build`, which loads .env.local.");
  }
  const db = createDb(url);
  const clock = { now: () => new Date().toISOString() };

  const healed = await backfillLeagueScoringHashes(db);
  if (healed > 0) console.log(`backfilled ${healed} league scoring hash${healed === 1 ? "" : "es"}`);

  const hashes = await scoringHashesInUse(db);
  if (hashes.length === 0) {
    console.log("no league carries a scoring hash, so there is nothing to build.");
    await db.$client.end();
    return;
  }

  for (const scoringHash of hashes) {
    const startedAt = performance.now();
    const outcome = await runPeekDocumentStep(db, clock, { scoringHash, playerIds: null, reason: "operator" });
    console.log(`${outcome.summary}, in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
  }
  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
