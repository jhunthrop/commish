import { getDb } from "@/db/client";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { submitKycVerification } from "@/money-service/kyc";
import { kycSubmissionRequestSchema } from "@/money-service/schemas";
import { MONEY_STATES } from "@/money/states";
import { createKycProvider } from "@/payments-provider/kyc-registry";
import type { KycProviderStatus } from "@/payments-provider/kyc-contract";
import { withCurrentUser } from "@/app/api/leagues/_shared";
import { kycRateLimited } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The outermost edge is the only place a wall clock is allowed. */
const systemClock = { now: () => new Date().toISOString() };

/**
 * One provider handle per PROCESS, not per request — `src/app/api/wallet/deposits/route.ts`'s
 * own reasoning for the sibling seam: lazy-but-shared matters for the mock arm specifically,
 * whose submission book is in-memory, so a replayed idempotency key only resolves to the same
 * submission across two requests if both reach the same instance.
 */
let provider: ReturnType<typeof createKycProvider> | undefined;
const getProvider = () => (provider ??= createKycProvider());

export interface SubmitKycBody {
  readonly status: KycProviderStatus;
}

/**
 * The KYC submit door (Task 7 Step 1): `submitKycVerification` looks up the submitted state's
 * `minAge` from `MONEY_STATES.enabled` (empty in production — money ships dark, decision 7) and
 * refuses `stateNotEnabled` when it is not there; otherwise it submits to the provider and writes
 * back whatever it currently reports. `"pending"` is a normal 200, not an error — a submission
 * awaiting manual review is exactly what the account room's KYC panel is built to render
 * (Task 12).
 */
export async function POST(request: Request) {
  return withCurrentUser(request, async (userId, req) => {
    const limited = kycRateLimited(userId);
    if (limited !== null) return limited;

    const parsed = await parseJson(req, kycSubmissionRequestSchema);
    if (!parsed.ok) return parsed.response;

    const outcome = await submitKycVerification(
      getDb(),
      { userId, ...parsed.value },
      { provider: getProvider(), states: MONEY_STATES, clock: systemClock, audit: getAuditLogger() },
    );
    if (!outcome.ok) return fail(outcome.reason, outcome.status);
    return ok<SubmitKycBody>({ status: outcome.status });
  });
}
