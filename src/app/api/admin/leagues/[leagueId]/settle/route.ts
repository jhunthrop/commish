import { getDb } from "@/db/client";
import { settleSeasonPayouts } from "@/money-service/settlement";
import { settleSeasonRequestSchema } from "@/money-service/schemas";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { withAdmin } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly leagueId: string }>;
}

interface SettleLeagueBody {
  readonly leagueId: string;
  readonly alreadySettled: boolean;
  readonly prizesPaidCents: number;
  readonly heldCents: number;
  readonly rakeCents: number;
}

/**
 * The operator-triggered settlement door (Phase 4, Task 10): `withAdmin` -> `await params` ->
 * `parseJson` -> `settleSeasonPayouts` -> `fail`/`ok`, the dissolve route's own fixed order. The
 * body names WHO finished where and nothing else — `settleSeasonRequestSchema` has no amount
 * field to parse, so every dollar figure is the league's own stored `payout_table`, read under
 * lock by the service. `operatorUserId` comes from `withAdmin`'s verified session, never from a
 * body that could name a different operator.
 *
 * No rate limiter, the dissolve route's own reasoning: `settleSeasonPayouts` answers a repeat as
 * a clean idempotent no-op under its own `leagues FOR UPDATE`, so the action is already bounded
 * by its own guard rather than a request budget.
 */
export async function POST(request: Request, { params }: RouteContext) {
  return withAdmin(request, async (operatorUserId, req) => {
    const { leagueId } = await params;
    const parsed = await parseJson(req, settleSeasonRequestSchema);
    if (!parsed.ok) return parsed.response;

    const result = await settleSeasonPayouts(getDb(), { leagueId, operatorUserId, standings: parsed.value.standings });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<SettleLeagueBody>({
      leagueId,
      alreadySettled: result.alreadySettled,
      prizesPaidCents: result.prizesPaidCents,
      heldCents: result.heldCents,
      rakeCents: result.rakeCents,
    });
  });
}
