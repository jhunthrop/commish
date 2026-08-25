import { getDb } from "@/db/client";
import { moneyDriftFindings, reconcileMoney, type MoneyDriftFinding, type MoneyDriftReport } from "@/money-service/reconcile";
import { createPaymentsProvider } from "@/payments-provider/registry";
import { ok } from "@/lib/api/respond";
import { withAdmin } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One provider handle per PROCESS, not per request — `src/app/api/wallet/deposits/route.ts`'s own
 * idiom, copied rather than shared: each of the three callers (deposits, withdrawals, this route)
 * keeps its own process-wide instance rather than a cross-file singleton, which this route's own
 * job is honest about needing to disclose. With the shipped `mock` provider, whose transfer book
 * lives in this instance's own memory, that means a deposit initiated through the wallet route in
 * a running dev server is invisible to a reconcile check run against THIS instance — three
 * separate in-memory books, not one pooled account. A REAL rail (Column, founder decision 2) has
 * no such gap: every call reaches the bank's own state, not this process's, so the seam itself
 * behaves like one pooled account regardless of how many adapter instances exist locally. Proving
 * reconciliation against the mock (Task 4's own promise, `PaymentsProvider.getPooledBalanceCents`'s
 * docblock) is what `reconcile.test.ts` and `scripts/money-reconcile.ts` do, both by constructing
 * (or driving) one shared mock instance directly — this route's own dev-server gap is disclosed
 * here rather than silently left for someone to rediscover.
 */
let provider: ReturnType<typeof createPaymentsProvider> | undefined;
const getProvider = () => (provider ??= createPaymentsProvider());

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
    const report = await reconcileMoney(getDb(), getProvider());
    return ok<ReconcileDriftBody>({ ...report, findings: moneyDriftFindings(report) });
  });
}
