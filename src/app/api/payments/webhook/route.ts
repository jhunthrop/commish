import { getDb } from "@research-ts/db/client";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { fail, ok } from "@/lib/api/respond";
import {
  DEPOSIT_ALARMS,
  recordDepositCompleted,
  recordDepositReturned,
  type DepositCompletedOutcome,
  type DepositReturnedOutcome,
} from "@/money-service/deposits";
import type { PostDeps } from "@/money-service/post";
import {
  WITHDRAWAL_ALARMS,
  recordWithdrawalCompleted,
  recordWithdrawalFailed,
  recordWithdrawalReturned,
  type WithdrawalCompletedOutcome,
  type WithdrawalFailedOutcome,
  type WithdrawalReturnedOutcome,
} from "@/money-service/withdrawals";
import { PAYMENTS_PROVIDER_CONFIG } from "@/payments-provider/config";
import { INGEST_REFUSALS, ingestProviderCallback, type PaymentsEvent } from "@/payments-provider/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The outermost edge is the only place a wall clock or a random id is allowed. */
const systemClock = { now: () => new Date().toISOString() };
const postingDeps = (): PostDeps => ({ audit: getAuditLogger(), clock: systemClock, newId: () => crypto.randomUUID() });

/**
 * THE one ingestion door for provider callbacks, and the only production caller of
 * `ingestProviderCallback` (Task 5 Step 3). Signature FIRST, over the raw bytes, reading the
 * header `PAYMENTS_PROVIDER_CONFIG.webhookSignatureHeader` names — a missing or unverifiable
 * signature is a 401 whose body echoes NOTHING of the payload; a verified-but-malformed body is
 * a 400. Only a fully translated `PaymentsEvent` ever reaches a money writer.
 *
 * STATUS DISCIPLINE for the writers' alarm outcomes, chosen by what a provider RETRY would do
 * (the Task 4 carry: never make the provider retry into the same alarm):
 *  - unknown ref / disagreement → 200: redelivery reproduces the alarm verbatim, so it is
 *    logged with full context server-side, acknowledged, and left to Task 11's reconciliation
 *    (ledger-vs-bank drift is the surface built to catch exactly this class).
 *  - return-before-completion → 503: the ONE alarm redelivery genuinely heals, because the
 *    completion callback is being retried too and posts first.
 *  - failure-after-completion → 200: invalid on the seam's own transition graph (Task 6's
 *    `WITHDRAWAL_ALARMS.failureAfterCompletion`); redelivery reproduces it verbatim, the same
 *    class as unknown-ref/disagreement.
 *  - a thrown error → 500: the provider redelivers into a bug we want the retries for.
 *
 * `withdrawal_completed`, `withdrawal_failed` and `withdrawal_returned` (Task 6) ride the same
 * dispatch as the deposit fates, through `@/money-service/withdrawals`'s three writers.
 */
export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get(PAYMENTS_PROVIDER_CONFIG.webhookSignatureHeader) ?? undefined;
  const ingested = ingestProviderCallback({ body, signature });
  if (!ingested.ok) {
    return fail(ingested.reason, ingested.reason === INGEST_REFUSALS.malformedPayload ? 400 : 401);
  }

  const event = ingested.event;
  try {
    switch (event.type) {
      case "deposit_completed":
        return answer(await recordDepositCompleted(getDb(), event, postingDeps()), event);
      case "deposit_returned":
        return answer(await recordDepositReturned(getDb(), event, postingDeps()), event);
      case "withdrawal_completed":
        return answer(await recordWithdrawalCompleted(getDb(), event, postingDeps()), event);
      case "withdrawal_failed":
        return answer(await recordWithdrawalFailed(getDb(), event, postingDeps()), event);
      case "withdrawal_returned":
        return answer(await recordWithdrawalReturned(getDb(), event, postingDeps()), event);
    }
  } catch (error: unknown) {
    console.error("[payments] webhook handler failed", { type: event.type, ref: event.ref }, error);
    return fail("Something went wrong on our side.", 500);
  }
}

/** See the module docblock's status discipline. The alarm sentence is logged, never echoed. */
function answer(
  outcome: DepositCompletedOutcome | DepositReturnedOutcome | WithdrawalCompletedOutcome | WithdrawalFailedOutcome | WithdrawalReturnedOutcome,
  event: PaymentsEvent,
): Response {
  if (outcome.ok) return ok({ received: true });
  console.error("[payments] webhook alarm", {
    alarm: outcome.alarm,
    type: event.type,
    ref: event.ref,
    amountCents: event.amountCents,
  });
  if (outcome.alarm === DEPOSIT_ALARMS.returnBeforeCompletion || outcome.alarm === WITHDRAWAL_ALARMS.returnBeforeCompletion) {
    return fail("Not ready for this callback yet. Deliver it again.", 503);
  }
  return ok({ received: true });
}
