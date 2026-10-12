import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { envOrUndefined } from "@research/lib/env";
import { createTank01Client } from "@research/stats/tank01/client";
import { TANK01_CONFIG } from "@research/stats/tank01/config";
import { readManifest } from "@/stats/tank01/fixtures";

/**
 * Re-records every committed Tank01 fixture from the live API. Founder-run, once, on the first
 * day there is a key.
 *
 * The adapter's tests must pass UNCHANGED across this run. If they do not, the authored fixtures
 * were wrong about the upstream shape, and this script is exactly the thing that surfaces it —
 * which is why the manifest carries a provenance field instead of a comment: the flip from
 * authored to recorded is a reviewable diff.
 *
 * Trimming is NOT automated. The player list is 5.5 MB and the whole point of the committed
 * fixtures is that they are small enough to read in a review. This script writes the full
 * responses; trim them by hand afterwards, keeping every field the mapper reads and keeping the
 * cross-file invariant that every box-score player id appears in the player list.
 */
async function main(): Promise<void> {
  const apiKey = envOrUndefined(TANK01_CONFIG.envVars.apiKey);
  if (apiKey === undefined) {
    throw new Error(`${TANK01_CONFIG.envVars.apiKey} is not set. Put a RapidAPI Tank01 key in .env.local first.`);
  }
  const client = createTank01Client({ apiKey });
  const manifest = readManifest();
  const dir = resolve(process.cwd(), "src/stats/tank01/fixtures");

  for (const entry of manifest.entries) {
    const body = await client.get(entry.path, entry.query);
    writeFileSync(resolve(dir, entry.file), `${JSON.stringify(body, null, 2)}\n`);
    console.log(`recorded ${entry.file} from ${entry.path}`);
  }

  const updated = { ...manifest, provenance: "recorded-from-live-api", recordedAt: new Date().toISOString() };
  writeFileSync(resolve(dir, "manifest.json"), `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`recorded ${manifest.entries.length} fixtures; provenance is now recorded-from-live-api`);
  console.log("NEXT: trim the large responses by hand, then run `npm test -- src/stats/tank01` and expect it to pass with NO test edits.");
}

main().then(() => process.exit(0)).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
