import { fail, ok, parseJson } from "@/lib/api/respond";
import { clientDraftActionSchema, draftStateView, toDraftAction, type DraftStateView } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { DRAFT_SERVICE_COPY } from "@/draft-service/copy";
import { NO_TEAM_MESSAGE } from "@/lib/leagues/membership";
import { withDraftActor, type RouteContext } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What an accepted action answers: the room as it now stands (the action and every bot pick
 *  batched behind it), one sentence when the room itself has not been told yet
 *  (`DRAFT_SERVICE_COPY.publishDelayed`), else null, and the server's clock at the answer
 *  (`DraftSnapshotBody.servedAt`). */
export interface DraftActionBody {
  readonly draft: DraftStateView;
  readonly notice: string | null;
  readonly servedAt: string;
}

/**
 * Submit a pick, nomination or bid. The acting team is resolved from the session — the body
 * schema has no teamId, and TIMER_EXPIRE isn't in it either: only the server may expire a clock.
 *
 * A mock room's bots pick INSIDE this request (the batched bots round, 2026-09-25): the store
 * appends every consecutive bot seat's pick to the same commit, each stamped at its own reveal
 * instant, and the answer carries them all; the room reveals each at its stamp. The pick's own
 * follow-through (the room's facts, then the facts frame) runs after this response has gone.
 *
 * THE FAIL-FAST PUBLISH (item 4): the write is committed before the room is told; when the
 * telling failed inside its bounded time, the envelope says so in a person's words rather than
 * answering as if the room already knew. The pick stands either way.
 */
export async function POST(request: Request, context: RouteContext) {
  return withDraftActor(request, context, async (actor, req) => {
    if (actor.teamId === null) return fail(NO_TEAM_MESSAGE, 403);

    const parsed = await parseJson(req, clientDraftActionSchema);
    if (!parsed.ok) return parsed.response;

    const action = toDraftAction(parsed.value, actor.teamId, new Date().toISOString());
    const result = await getDraftStore().applyAction(actor.draftId, action, { actor: { id: actor.userId } });
    if (!result.ok) return fail(result.reason, 409);
    const body: DraftActionBody = { draft: draftStateView(result.state), notice: result.published ? null : DRAFT_SERVICE_COPY.publishDelayed, servedAt: new Date().toISOString() };
    return ok(body);
  });
}
