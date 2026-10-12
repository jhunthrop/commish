// THE PEEK-FACTS REFRESH, BY HAND — writes one `player_peek_facts` row per board player, right now.
//
// Run: npm run peek:facts:refresh
//
// WHY IT EXISTS SEPARATELY FROM THE SWEEP. The two scheduled triggers (the nightly capsule sweep and
// the `season-week` job's own `peek-facts` step) both write these rows as part of larger work. This
// is the rollout step the design names: after a deploy carries the migration, every board player
// needs a row BEFORE anyone opens a peek, and running the capsule sweep by hand to get one would
// also spend real money on capsule generation nobody asked for. This runs the same pass and the same
// writer, and nothing else.
//
// IT IS IDEMPOTENT. `writePeekFacts` counts only rows that actually changed, so a second run at the
// same moment writes nothing.
import { collectBoardFacts } from "@research/capsules/collect";
import { writeRefresh } from "@/league-service/peek/peek-facts";
import { createDb } from "@research/db/client";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is not set. Run this through `npm run peek:facts:refresh`, which loads .env.local.");
  }
  const db = createDb(url);
  const startedAt = performance.now();
  const asOf = new Date();
  const refresh = await writeRefresh(db, await collectBoardFacts(db, asOf));
  console.log(
    `peek facts at ${asOf.toISOString()}: ${refresh.players} rows built, ${refresh.changed} changed, ` +
      `${refresh.withTouchesRank} with a touches rank, in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
