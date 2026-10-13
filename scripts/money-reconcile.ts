// Reconciles the money ledger against the bank and its own internal invariants, and exits
// non-zero if anything disagrees.
// Run: npm run money:reconcile
//
// The operator's cron-able check (Phase 4, Task 11) — level-triggered by ruling 12 (the
// founder-gated bucket has said "no production scheduler" for three phases running), so this
// script and the admin-room drift panel's own "Refresh" button
// (`src/admin-room/components/reconcile-drift-panel.tsx`) are the only two callers of
// `reconcileMoney`, and neither stores a "last reconciled" flag anywhere — every run recomputes
// the whole report from the database's CURRENT state.
//
// OPERATOR RUNBOOK, until a production scheduler exists (Phase 2 Plan D, `audit:verify`'s own
// runbook note): run this on a recurring reminder, and always after any batch reconciliation with
// the bank (a settlement day, a large deposit/withdrawal batch). It answers four checks, each its
// own figure — the bank agreement, the double-entry law, the floor on `user_available`, and
// escrow-by-league consistency — and names every one that disagrees, to the cent.
import { getDb } from "@research-ts/db/client";
import { moneyDriftFindings, reconcileMoney } from "@/money-service/reconcile";
import { formatUsd } from "@/money/config";
import { createPaymentsProvider } from "@/payments-provider/registry";

async function main(): Promise<void> {
  const report = await reconcileMoney(getDb(), createPaymentsProvider());

  console.log(`Ledger pooled balance: ${formatUsd(report.ledgerFboPoolCents)}`);
  console.log(`Bank pooled balance:   ${formatUsd(report.providerPooledBalanceCents)}`);
  console.log(`Ledger assets:         ${formatUsd(report.assetsCents)}`);
  console.log(`Ledger liabilities:    ${formatUsd(report.liabilitiesCents)}`);

  const findings = moneyDriftFindings(report);
  if (findings.length === 0) {
    console.log("Clean. The ledger agrees with the bank, and every internal check passed.");
    return;
  }

  for (const finding of findings) console.error(`DRIFT [${finding.code}] ${finding.message}`);
  console.error(`${findings.length} check(s) failed. Nothing has been repaired: reconciliation only reports drift, it never corrects it.`);
  process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
