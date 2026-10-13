import { getDb } from "@research-ts/db/client";
import { moneyDriftFindings, reconcileMoney, type MoneyDriftFinding, type MoneyDriftReport } from "@/money-service/reconcile";
import { getSharedPaymentsProvider } from "@/payments-provider/registry";
import { ok } from "@/lib/api/respond";
import { withAdmin } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `getSharedPaymentsProvider()` (`@/payments-provider/registry`, Task 12 fix): the SAME
 * process-wide instance `wallet/deposits/route.ts` and `wallet/withdrawals/route.ts` share, not a
 * handle local to this file. This route used to keep its own — with the shipped `mock` provider,
 * whose transfer book lives in memory, that meant a deposit initiated through the wallet route was
 * INVISIBLE to a reconcile check run against this route's own separate instance: three separate
 * in-memory books, not one pooled account, the exact gap this route's docblock used to disclose
 * rather than silently leave for someone to rediscover. Sharing the instance closes it. A REAL
 * rail (Column, founder decision 2) never had this gap: every call reaches the bank's own state,
 * not this process's. Proving reconciliation against the mock (Task 4's own promise,
 * `PaymentsProvider.getPooledBalanceCents`'s docblock) is still `reconcile.test.ts`'s and
 * `scripts/money-reconcile.ts`'s job, both by constructing (or driving) their own mock instance
 * directly — unaffected by this route's own handle.
 */

/** `MoneyDriftReport` plus the named findings the panel and the script both render from — the
 *  ONE place `moneyDriftFindings` runs server-side, so a browser never re-derives what counts as
 *  drift on its own (`src/money-service` is on the client-boundary's banned value-import list). */
export interface ReconcileDriftBody extends MoneyDriftReport {
  readonly findings: readonly MoneyDriftFinding[];
}

/**
 * The admin-room reconciliation door (Phase 4, Task 11): `withAdmin` -> `reconcileMoney` ->
 * `moneyDriftFindings` -> `ok`. `GET`, not `POST` — this door moves no money and changes no
 * state; it is the level-triggered read the brief names (a script and this same button, no
 * scheduler), so every call recomputes the whole report from the current database state and
 * nothing here is cached between requests (`ok`'s own `no-store` header already forbids the
 * browser from doing so on its own).
 */
export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const report = await reconcileMoney(getDb(), getSharedPaymentsProvider());
    return ok<ReconcileDriftBody>({ ...report, findings: moneyDriftFindings(report) });
  });
}
