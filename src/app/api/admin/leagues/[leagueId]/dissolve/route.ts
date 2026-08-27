import { getDb } from "@/db/client";
import { dissolutionPreview, dissolveLeague } from "@/money-service/dissolution";
import { fail, ok } from "@/lib/api/respond";
import { withAdmin } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

interface DissolveLeagueBody {
  readonly leagueId: string;
  readonly refundedMembers: number;
  readonly totalRefundedCents: number;
}

export interface DissolvePreviewBody {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly seatedCount: number;
}

/**
 * The read-then-confirm door (operator review, 2026-08-27, finding D1/D3): the league's own name
 * and seated count, so `DissolveLeagueControl` can name the object and state the consequence
 * BEFORE the operator confirms the one-way `POST` below. `GET`, not `POST` — this door moves no
 * money and changes no state, `reconcile/route.ts`'s own reasoning for the identical distinction.
 */
export async function GET(request: Request, { params }: RouteContext) {
  return withAdmin(request, async () => {
    const { leagueId } = await params;
    const preview = await dissolutionPreview(getDb(), leagueId);
    if (!preview.ok) return fail(preview.reason, preview.status);
    return ok<DissolvePreviewBody>({ leagueId, leagueName: preview.leagueName, seatedCount: preview.seatedCount });
  });
}

/**
 * The operator-triggered dissolution door (Phase 4, Task 9): `withAdmin` -> `await params` ->
 * `dissolveLeague` -> `fail`/`ok`, the same fixed order `POST /api/admin/flags/[flagId]/resolve`
 * uses. No request body: the only input this decision takes is WHICH league, already named by
 * the path, and `operatorUserId` comes from `withAdmin`'s own verified session — never from a
 * body that could name a different operator, `resolve/route.ts`'s own reasoning verbatim.
 *
 * No rate limiter, unlike `resolve/route.ts`'s `resolveRequests`: that door can be asked to
 * decide the same flag, or a fresh one, arbitrarily often. This one cannot — `dissolveLeague`'s
 * own guarded `UPDATE ... WHERE status = 'scheduled'` makes a second call against the same
 * league answer `DISSOLUTION_REFUSALS.draftStarted` rather than refund twice, so the action is
 * already bounded by its own idempotent guard rather than a request budget.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return withAdmin(request, async (operatorUserId) => {
    const { leagueId } = await params;
    const result = await dissolveLeague(getDb(), { leagueId, operatorUserId });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<DissolveLeagueBody>({ leagueId, refundedMembers: result.refundedMembers, totalRefundedCents: result.totalRefundedCents });
  });
}
