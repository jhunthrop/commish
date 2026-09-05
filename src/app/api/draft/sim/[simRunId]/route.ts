import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { getSimRun } from "@/draft-service/sim/store";
import { withCurrentUser } from "@/app/api/draft/_shared";
import type { SimRunView } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly simRunId: string }>;
}

function toView(row: NonNullable<Awaited<ReturnType<typeof getSimRun>>>): SimRunView {
  return {
    id: row.id,
    leagueId: row.leagueId,
    config: row.config,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    summary: row.summary,
    error: row.error,
  };
}

/** One sim run, by id — never another user's, even if the id is guessed: a sim's own numbers
 *  carry no secret, but the row's existence and its config are still the requester's own. */
export async function GET(request: Request, { params }: RouteContext) {
  return withCurrentUser(request, async (userId) => {
    const { simRunId } = await params;
    const row = await getSimRun(getDb(), simRunId);
    if (row === null || row.userId !== userId) return fail("Sim run not found.", 404);
    return ok<SimRunView>(toView(row));
  });
}
