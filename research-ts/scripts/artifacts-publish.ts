// Publishes every committed model artifact record (`data/model-artifacts/**/v<n>.json`) into the
// `model_artifacts` table of the database `DATABASE_URL` names. Idempotent: a record already in the
// store with the same payload reports `unchanged`; one with a different payload under the same
// version is refused, because a version is immutable.
// Run: npm run artifacts:publish   (loads .env.local; DATABASE_URL names the target)
//
// A warm server instance sees a newly published version only once the code pins it; the loader
// memoizes each pinned version per instance, so a deploy that bumps a pin reads the new row on its
// first request.
import { createDb } from "@research-ts/db/client";
import { envOrUndefined } from "@research-ts/lib/env";
import { MODEL_ARTIFACT_RECORDS_DIR, publishCommittedModelArtifacts } from "./lib/model-artifact-records";

function requireDatabaseUrl(): string {
  const value = envOrUndefined("DATABASE_URL");
  if (value === undefined) {
    throw new Error("DATABASE_URL is not set. Run this through `npm run artifacts:publish`, which loads .env.local.");
  }
  return value;
}

async function main(): Promise<void> {
  const db = createDb(requireDatabaseUrl());
  try {
    const published = await publishCommittedModelArtifacts(db, MODEL_ARTIFACT_RECORDS_DIR);
    for (const entry of published) {
      console.log(`${entry.outcome.padEnd(9)} ${entry.name} v${entry.version}  (${entry.path})`);
    }
    const inserted = published.filter((entry) => entry.outcome === "inserted").length;
    console.log(`${published.length} records, ${inserted} inserted, ${published.length - inserted} already published.`);
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
