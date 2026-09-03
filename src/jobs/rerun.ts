// THE OPERATOR RE-RUN — a FRESH job copying the old one's name and payload, never a rewrite of
// history: the dead-lettered row and its runs stay exactly as they ended, and the new job gets a
// new idempotency key minted from the operator action's instant.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { enqueueJob } from "./store";

export type RerunResult =
  | { readonly ok: true; readonly newJobId: number }
  | { readonly ok: false; readonly reason: "not-found" | "still-active" };

/**
 * A `pending` or `running` job is refused (`still-active`): it does not need a second copy, it
 * needs to finish. Everything terminal — `succeeded` included, for an operator who wants a
 * cadence pass outside its schedule — re-enqueues.
 */
export async function rerunJob(db: Db, clock: Clock, jobId: number): Promise<RerunResult> {
  const rows = await db.select().from(jobs).where(eq(jobs.id, jobId));
  const row = rows[0];
  if (row === undefined) return { ok: false, reason: "not-found" };
  if (row.status === "pending" || row.status === "running") return { ok: false, reason: "still-active" };

  const now = new Date(clock.now());
  const result = await enqueueJob(db, clock, {
    name: row.name,
    idempotencyKey: `rerun:${row.id}:${now.toISOString()}`,
    payload: row.payload,
    maxAttempts: row.maxAttempts,
    runAt: now,
  });
  // The key carries the instant, so a conflict means the same operator double-clicked within one
  // clock reading — treat the existing enqueue as the answer either way.
  return result.jobId === null ? { ok: false, reason: "still-active" } : { ok: true, newJobId: result.jobId };
}
