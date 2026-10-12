// THE PROPS SNAPSHOT'S CLI — a thin wire around `@research-ts/projections/odds/snapshot`, where the whole
// implementation moved when the durable job system became a second caller living in `src/` (which
// may not import `scripts/`). This file's only jobs: parse `--dry-run`, wire a real db, set the
// exit code.
//
// Run: npm run projections:odds:snapshot
// Dry run (fetches the event list only, makes no odds requests, writes nothing):
// npm run projections:odds:snapshot -- --dry-run
import { createDb } from "@research-ts/db/client";
import { requireEnv } from "@research-ts/projections/odds/http";
import { runOddsSnapshot, selectUpcomingEvents } from "@research-ts/projections/odds/snapshot";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const apiKey = requireEnv("ODDS_API_KEY");

  if (dryRun) {
    const { credits } = await selectUpcomingEvents(apiKey);
    console.log("Dry run: event list fetched only, no odds requests made, nothing written.");
    console.log(`Credits after /events: remaining=${credits.remaining} used=${credits.used}`);
    return;
  }

  const db = createDb(requireEnv("DATABASE_URL"));
  try {
    await runOddsSnapshot(db, apiKey);
  } finally {
    await db.$client.end();
  }
}

// ENTRY-POINT GUARD, kept from the pre-split file (found the hard way: an unguarded `main()` ran
// a second, real, credit-spending snapshot the moment another script imported this module).
// Nothing imports this file any more — the logic lives in src — but the guard costs nothing and
// the lesson was expensive.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
