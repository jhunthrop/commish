import { getDb } from "@research/db/client";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { fail, ok, parseJson, parseQuery } from "@/lib/api/respond";
import { clearSelfExclusion, exclusionPreview, setSelfExclusion } from "@/money-service/exclusion";
import { clearExclusionRequestSchema } from "@/money-service/schemas";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { withAdmin } from "@/app/api/admin/_shared";
import { exclusionRateLimited } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The outermost edge is the only place a wall clock is allowed. */
const systemClock = { now: () => new Date().toISOString() };

export interface SetExclusionBody {
  readonly selfExcludedAt: string;
}

/**
 * The self-exclusion SET door (Task 7 Step 2): the caller's own one-way stamp, from the account
 * room. `setSelfExclusion` is idempotent, so a repeat call is a normal 200 with the ORIGINAL
 * timestamp, never an error — a member re-confirming this decision is not a mistake.
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId) => {
    const limited = exclusionRateLimited(userId);
    if (limited !== null) return limited;

    const selfExcludedAt = await setSelfExclusion(getDb(), userId, systemClock, getAuditLogger());
    return ok<SetExclusionBody>({ selfExcludedAt });
  });
}

export interface ExclusionPreviewBody {
  readonly userId: string;
  readonly displayName: string;
  readonly selfExcludedAt: string;
}

/**
 * The read-then-confirm door (operator review, 2026-08-27, finding D1/D3): the member's own name
 * and the date they excluded themselves, so `ExclusionControl` can name the object and state the
 * consequence BEFORE the operator confirms the one-way `DELETE` below. Operator-only, `withAdmin`
 * — a member has no reason to look up another account's exclusion date, and this door answers
 * ONLY that question, never their own (`GET /api/wallet` is where a member reads their own
 * standing). Query-string, not path-scoped: this route carries no `[userId]` segment, the same
 * reason `DELETE`'s body carries the id rather than the path.
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const url = new URL(request.url);
    const parsed = parseQuery(Object.fromEntries(url.searchParams), clearExclusionRequestSchema);
    if (!parsed.ok) return parsed.response;

    const preview = await exclusionPreview(getDb(), parsed.value.userId);
    if (!preview.ok) return fail(preview.reason, 404);
    return ok<ExclusionPreviewBody>({ userId: parsed.value.userId, displayName: preview.displayName, selfExcludedAt: preview.selfExcludedAt });
  });
}

export interface ClearExclusionBody {
  readonly userId: string;
}

/**
 * The self-exclusion CLEAR door (Task 7 Step 2): operator-only, `withAdmin`-gated, audited as
 * `self_exclusion_cleared` (fix round: replaces the generic `admin_action` this writer used to
 * append — see `clearSelfExclusion`'s own docblock). Lives on the SAME route as the member's
 * own `POST` (a different HTTP method, not a second file) because the master route inventory
 * names exactly one file here; a support conversation clearing a member's own decision reuses the
 * door the member set it through, rather than growing a second wallet route the plan never named.
 * `withAdmin` answers 401/404/500 on its own two failure classes (ruling 14: never 403 for
 * "signed in, not an operator"); `clearSelfExclusion`'s own refusal (not excluded, or no such
 * user) answers 404 here too, for the identical "tell a stranger nothing they did not already
 * have" reason.
 */
export async function DELETE(request: Request) {
  return withAdmin(request, async (operatorUserId, req) => {
    const parsed = await parseJson(req, clearExclusionRequestSchema);
    if (!parsed.ok) return parsed.response;

    const result = await clearSelfExclusion(getDb(), {
      userId: parsed.value.userId,
      operatorUserId,
      clock: systemClock,
      audit: getAuditLogger(),
    });
    if (!result.ok) return fail(result.reason, 404);
    return ok<ClearExclusionBody>({ userId: parsed.value.userId });
  });
}
