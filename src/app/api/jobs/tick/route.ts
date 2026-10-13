// THE VERCEL-SHAPED RUNNER — the same `runTick` the local runner loops, behind one bounded,
// authenticated request. Vercel Cron (min granularity one minute) GETs this with
// `Authorization: Bearer <CRON_SECRET>`; the handler runs one tick inside its budget and returns
// what it did. Overlapping ticks are safe by construction: claims are SKIP LOCKED, schedule fires
// dedupe on their idempotency key, and checkpoint resume carries a long job across ticks.
//
// vercel.json when this deploys:
//   { "crons": [{ "path": "/api/jobs/tick", "schedule": "* * * * *" }] }
// with CRON_SECRET set in the project env (Vercel sends it as the Authorization bearer).
import { randomUUID } from "node:crypto";
import { getDb } from "@research-ts/db/client";
import { JOB_DEFINITIONS } from "@/jobs/registry";
import { handleTick } from "@/jobs/tick-handler";

export const dynamic = "force-dynamic";
/** Headroom above the tick budget ceiling (`tick-handler.ts`), so a raised `JOBS_TICK_BUDGET_MS`
 *  still finishes its in-flight job and answers instead of being killed mid-write. */
export const maxDuration = 300;

function tick(request: Request): Promise<Response> {
  return handleTick(request, {
    db: getDb(),
    definitions: JOB_DEFINITIONS,
    env: process.env,
    workerId: `vercel:${process.pid}:${randomUUID().slice(0, 8)}`,
  });
}

/** Vercel Cron calls GET. */
export function GET(request: Request): Promise<Response> {
  return tick(request);
}

/** POST kept for a manual `curl` kick with the same bearer — identical semantics. */
export function POST(request: Request): Promise<Response> {
  return tick(request);
}
