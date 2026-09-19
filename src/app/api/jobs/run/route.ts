// THE SELF-WAKE ROUTE (draft-room performance round, item 3): one queued job, run at its own due
// instant in its own invocation. `after()` keeps this invocation alive past the 202 for the
// sleep and the run; `maxDuration` covers one hop's longest sleep (`JOBS_CONFIG.selfWakeMaxSleepMs`)
// plus a pick's own work, and is deliberately NOT the stream's 300 or the tick's, so this route
// is bundled into a Vercel function of its own: a pick's follow-through (the room's facts) can
// never share an instance with the stream that relays its frame.
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { JOB_DEFINITIONS } from "@/jobs/registry";
import { handleJobRun } from "@/jobs/run-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function POST(request: Request): Promise<Response> {
  return handleJobRun(request, {
    db: getDb(),
    definitions: JOB_DEFINITIONS,
    env: process.env,
    workerId: `vercel-run:${process.pid}:${randomUUID().slice(0, 8)}`,
    defer: (work) => after(work),
  });
}
