// One-shot: run the nightly capsule sweep's own step over the whole board with no tick deadline
// and a budget wide enough for every eligible player, paced exactly as the nightly job is. Used
// after a writer or fact-sheet change lands, when the facts hash has moved for everyone and the
// nightly ceiling of `CAPSULE_CONFIG.sweepGenerationBudget` would take weeks to catch up.
// (dotenv -e .env.local -- tsx scripts/capsule-regenerate.ts [budget])
import { CAPSULE_CONFIG } from "@/capsules/config";
import { createDb } from "@/db/client";
import type { Clock } from "@/domain/timing";
import { runCapsuleSweepStep } from "@/jobs/defs/capsule-sweep-job";

const DEFAULT_BUDGET = 2_000;
const systemClock: Clock = { now: () => new Date().toISOString() };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run capsules:regenerate\`, which loads .env.local.`);
  }
  return value;
}

function budgetArg(): number {
  const raw = process.argv[2];
  if (raw === undefined) return DEFAULT_BUDGET;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`budget must be a positive integer, got ${raw}`);
  return parsed;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const apiKey = requireEnv(CAPSULE_CONFIG.gateway.envVars.apiKey);
  const startedAt = Date.now();
  const outcome = await runCapsuleSweepStep(db, systemClock, { apiKey }, { budget: budgetArg() });
  console.log(outcome.summary);
  for (const line of outcome.detail) console.log(`  ${line}`);
  console.log(`Elapsed: ${((Date.now() - startedAt) / 60_000).toFixed(1)} min.`);
  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
