import { getDb } from "@/db/client";
import { reportReview } from "@/review-service/reviews";
import { reportReviewSchema } from "@/review-service/schemas";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { reportRateLimited } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly reviewId: string }>;
}

/**
 * The in-product half of ruling 18: reporting is the only lever a signed-in reader has, and it
 * is a SIGNAL, not an action — there is no admin role behind this route to act on it, only
 * `scripts/remove-review.ts`, run by a human operator who reads the report table directly.
 *
 * Idempotent by primary key (`reportReview`'s own docblock): a second report from the same
 * reader for the same review answers 200, not 409 — it's the same report.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = reportRateLimited(userId);
    if (limited !== null) return limited;

    const { reviewId } = await params;
    const parsed = await parseJson(req, reportReviewSchema);
    if (!parsed.ok) return parsed.response;

    const result = await reportReview(getDb(), { reviewId, reporterUserId: userId, reason: parsed.value.reason });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<{ readonly reported: true }>({ reported: true });
  });
}
