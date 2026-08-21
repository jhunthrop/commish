import { chatMessageIdSchema, reportMessage, reportMessageSchema } from "@/chat-service";
import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { withLeagueMemberActor } from "@/app/api/leagues/_shared";
import { chatReportRateLimited } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string; readonly messageId: string }>;
}

/**
 * The in-product half of ruling 12: reporting is the only lever a member has, and it is a
 * SIGNAL, not an action — there is no path here that lets a member remove or hide anything, only
 * `resolveFlag`'s operator door. Mirrors `POST /api/reviews/[reviewId]/report` exactly.
 *
 * `withLeagueMemberActor` is "you may report what you can see, and only that": the actor's own
 * `leagueId` (from their real membership, never the request body) is what `reportMessage` scopes
 * the message lookup to, so a message id borrowed from another league is a 404, not a report.
 *
 * Idempotent by primary key (`reportMessage`'s own docblock): a second report from the same
 * reader for the same message answers 200, not 409 — it's the same report.
 */
export async function POST(request: Request, context: RouteContext) {
  return withLeagueMemberActor(request, context, async (actor, req) => {
    const limited = chatReportRateLimited(actor.userId);
    if (limited !== null) return limited;

    const { messageId } = await context.params;
    // A path param is untrusted input like any other — validated HERE, before the service
    // touches the database, same as the reactions route's own `id` check.
    const id = chatMessageIdSchema.safeParse(messageId);
    if (!id.success) return fail(`messageId: ${id.error.issues[0]?.message ?? "That isn't a message we can report."}`, 400);

    const parsed = await parseJson(req, reportMessageSchema);
    if (!parsed.ok) return parsed.response;

    const result = await reportMessage(getDb(), {
      messageId,
      leagueId: actor.leagueId,
      reporterUserId: actor.userId,
      reason: parsed.value.reason,
    });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<{ readonly reported: true }>({ reported: true });
  });
}
