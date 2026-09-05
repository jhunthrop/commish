import { getDb } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { getSimRun } from "@/draft-service/sim/store";
import { toSimRunView, type SimRunView } from "@/draft-service/sim/view";
import { withCurrentUser } from "@/app/api/draft/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly simRunId: string }>;
}

/** One sim run, by id — never another user's, even if the id is guessed: a sim's own numbers
 *  carry no secret, but the row's existence and its config are still the requester's own. */
export async function GET(request: Request, { params }: RouteContext) {
  return withCurrentUser(request, async (userId) => {
    const { simRunId } = await params;
    const db = getDb();
    const row = await getSimRun(db, simRunId);
    if (row === null || row.userId !== userId) return fail("Sim run not found.", 404);
    return ok<SimRunView>(await toSimRunView(db, row));
  });
}
