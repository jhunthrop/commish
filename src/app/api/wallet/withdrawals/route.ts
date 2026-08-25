import { getDb } from "@/db/client";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { initiateWithdrawal } from "@/money-service/withdrawals";
import { withdrawalRequestSchema } from "@/money-service/schemas";
import { MONEY_STATES } from "@/money/states";
import { createPaymentsProvider } from "@/payments-provider/registry";
import type { TransferIntent } from "@/payments-provider/contract";
import { withCurrentUser } from "@/app/api/leagues/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The outermost edge is the only place a wall clock or a random id is allowed. */
const systemClock = { now: () => new Date().toISOString() };

/** One provider handle per PROCESS — `src/app/api/wallet/deposits/route.ts`'s exact reasoning:
 *  the mock's in-memory transfer book must be the SAME instance across requests for Seam A's
 *  replay law to hold. */
let provider: ReturnType<typeof createPaymentsProvider> | undefined;
const getProvider = () => (provider ??= createPaymentsProvider());

export interface InitiateWithdrawalBody {
  readonly transfer: TransferIntent;
  /** Rendered from the provider's own bank descriptor — the UI never invents either figure. */
  readonly feeCents: number;
  readonly feePercentBasisPoints: number;
  readonly etaDescription: string;
}

/**
 * The withdrawal door (Task 6): `moneyGates` refuses 403 with one `MONEY_REFUSALS` sentence —
 * self-exclusion is deliberately NOT one of the reachable refusals here (`door: "withdraw"`,
 * `@/money-service/gates`'s own docblock). Amounts are bounded below by `withdrawalRequestSchema`
 * (`MONEY_CONFIG.withdrawal.minCents`); the true ceiling is the member's LOCKED available
 * balance, enforced by `initiateWithdrawal`'s own reservation posting, never a read this route
 * performs itself. A DECLINE comes back 200 as a `failed` transfer with its typed reason, the
 * same business-outcome discipline `initiateDeposit` uses.
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const parsed = await parseJson(req, withdrawalRequestSchema);
    if (!parsed.ok) return parsed.response;

    const outcome = await initiateWithdrawal(
      getDb(),
      { userId, ...parsed.value },
      {
        provider: getProvider(),
        audit: getAuditLogger(),
        clock: systemClock,
        newId: () => crypto.randomUUID(),
        states: MONEY_STATES,
      },
    );
    if (!outcome.ok) return fail(outcome.reason, outcome.status);
    return ok<InitiateWithdrawalBody>({
      transfer: outcome.transfer,
      feeCents: outcome.feeCents,
      feePercentBasisPoints: outcome.feePercentBasisPoints,
      etaDescription: outcome.etaDescription,
    });
  });
}
