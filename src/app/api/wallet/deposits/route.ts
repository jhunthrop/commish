import { getDb } from "@/db/client";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { initiateDeposit } from "@/money-service/deposits";
import { depositRequestSchema } from "@/money-service/schemas";
import { MONEY_STATES } from "@/money/states";
import { createPaymentsProvider } from "@/payments-provider/registry";
import type { TransferIntent } from "@/payments-provider/contract";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { depositRateLimited } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The outermost edge is the only place a wall clock or a random id is allowed. */
const systemClock = { now: () => new Date().toISOString() };

/**
 * One provider handle per PROCESS, not per request, built lazily so importing this module (a
 * build-time event) constructs nothing. Lazy-but-shared matters for the mock arm specifically:
 * its transfer book is in-memory, and Seam A's replay law — a double-submitted form resolves to
 * the SAME transfer — only holds across two HTTP requests if both reach the same instance. A
 * real rail is stateless per request and does not care.
 */
let provider: ReturnType<typeof createPaymentsProvider> | undefined;
const getProvider = () => (provider ??= createPaymentsProvider());

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
        provider: getProvider(),
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
