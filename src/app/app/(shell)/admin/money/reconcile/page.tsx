import type { Metadata } from "next";
import { withAdmin } from "@/app/api/admin/_shared";
import { ReconcileDriftPanel } from "@/admin-room/components/reconcile-drift-panel";
import { OperatorTool } from "@/admin-room/components/operator-tool";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>, and `AdminConsoleNav`'s label for this route.
export const metadata: Metadata = pageTitle("Money reconciliation");

/**
 * The admin room's reconciliation surface (Phase 4, Task 11). Renders no `TopBar` and no
 * `<main>` of its own — `(shell)/layout.tsx` supplies both, `AdminHoldsPage`'s own discipline
 * (`../../holds/page.tsx`). Not linked from `TopBar` either, on the identical scoping note: an
 * operator reaches this page directly, the same way every other admin surface in this phase is
 * reached rather than from a nav link.
 */
export default async function AdminMoneyReconcilePage() {
  return withAdmin(async () => {
    return (
      <OperatorTool
        title="Money reconciliation"
        intent={"The ledger's pooled balance against the bank's own, plus the internal checks a healthy book always passes. Recomputed fresh on every load."}
      >
        <ReconcileDriftPanel />
      </OperatorTool>
    );
  });
}
