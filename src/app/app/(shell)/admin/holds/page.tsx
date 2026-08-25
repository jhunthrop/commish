import { PageTitle } from "@/components/ui";
import { withAdmin } from "@/app/api/admin/_shared";
import { HoldsControl } from "@/admin-room/components/holds-control";

export const dynamic = "force-dynamic";

/**
 * The admin room's held-payout surface (Phase 4, Task 10). Renders no `TopBar` and no `<main>`
 * of its own — `(shell)/layout.tsx` supplies both, `AdminExclusionsPage`'s own discipline
 * (`../exclusions/page.tsx`). Not linked from `TopBar` either, on the identical scoping note: an
 * operator reaches this page from the resolved flag that names the member's id.
 */
export default async function AdminHoldsPage() {
  return withAdmin(async () => {
    return (
      <>
        <header className="flex flex-col gap-1">
          <PageTitle>Held payouts</PageTitle>
          <p className="text-sm text-text-muted">
            Resolve a payout held at settlement. Release pays it to the member&apos;s wallet; confiscate forfeits it to the platform. Both are one-way.
          </p>
        </header>

        <HoldsControl />
      </>
    );
  });
}
