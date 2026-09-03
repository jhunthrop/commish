import { z } from "zod";
import { withAdmin } from "@/app/api/admin/_shared";
import { getDb } from "@/db/client";
import { rerunJob } from "@/jobs/rerun";
import { fail, ok, parseJson } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

const rerunSchema = z.object({ jobId: z.number().int().positive() });

/**
 * The admin jobs page's one action: enqueue a FRESH copy of a terminal job (dead-lettered or
 * succeeded), new idempotency key, history untouched. Gated by `withAdmin` like every route under
 * `api/admin/**` (the `admin-routes.test.ts` tripwire).
 */
export function POST(request: Request): Promise<Response> {
  return withAdmin(request, async (operatorUserId, req) => {
    const parsed = await parseJson(req, rerunSchema);
    if (!parsed.ok) return parsed.response;

    const result = await rerunJob(getDb(), { now: () => new Date().toISOString() }, parsed.value.jobId);
    if (!result.ok) {
      return result.reason === "not-found"
        ? fail("No job with that id.", 404)
        : fail("That job is still pending or running. Let it finish.", 409);
    }
    console.log(`[admin] operator ${operatorUserId} re-ran job ${parsed.value.jobId} as job ${result.newJobId}`);
    return ok({ newJobId: result.newJobId });
  });
}
