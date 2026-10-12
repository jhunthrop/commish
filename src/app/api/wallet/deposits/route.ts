import { getDb } from "@research/db/client";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { initiateDeposit } from "@/money-service/deposits";
import { depositRequestSchema } from "@/money-service/schemas";
import { MONEY_STATES } from "@/money/states";
import { getSharedPaymentsProvider } from "@/payments-provider/registry";
import type { TransferIntent } from "@/payments-provider/contract";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { depositRateLimited } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The outermost edge is the only place a wall clock or a random id is allowed. */
const systemClock = { now: () => new Date().toISOString() };

export interface InitiateDepositBody {
  readonly transfer: TransferIntent;
}

/**
 * The deposit door (Task 5): `moneyGates` refuses 403 with one `MONEY_REFUSALS` sentence — and
 * today refuses EVERYONE, because `MONEY_STATES.enabled` ships empty (decision 7: money is dark
 * until the founder names a state with counsel). Amounts are server-validated against
 * `MONEY_CONFIG.deposit` bounds by `depositRequestSchema` before the writer runs; a DECLINE
 * comes back 200 as a `failed` transfer with its typed reason, because a bank saying no is a
 * business outcome the form renders, not an error.
 *
 * `getSharedPaymentsProvider()` (`@/payments-provider/registry`, Task 12 fix): ONE process-wide
 * instance, shared with `withdrawals/route.ts` and `admin/money/reconcile/route.ts` — not a
 * handle local to this file. See that function's own docblock for the collision this used to
 * leave reachable.
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = depositRateLimited(userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, depositRequestSchema);
    if (!parsed.ok) return parsed.response;

    const outcome = await initiateDeposit(
      getDb(),
      { userId, ...parsed.value },
      {
        provider: getSharedPaymentsProvider(),
        audit: getAuditLogger(),
        clock: systemClock,
        newId: () => crypto.randomUUID(),
        states: MONEY_STATES,
      },
    );
    if (!outcome.ok) return fail(outcome.reason, outcome.status);
    return ok<InitiateDepositBody>({ transfer: outcome.transfer });
  });
}
