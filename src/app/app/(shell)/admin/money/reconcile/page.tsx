import { PageTitle } from "@/components/ui";
import { withAdmin } from "@/app/api/admin/_shared";
import { ReconcileDriftPanel } from "@/admin-room/components/reconcile-drift-panel";

export const dynamic = "force-dynamic";

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
      <>
        <header className="flex flex-col gap-1">
          <PageTitle>Money reconciliation</PageTitle>
          <p className="text-sm text-text-muted">
            The ledger&apos;s pooled balance against the bank&apos;s own, plus the internal checks a healthy book always passes. Recomputed fresh on every load.
          </p>
        </header>

        <ReconcileDriftPanel />
      </>
    );
  });
}
