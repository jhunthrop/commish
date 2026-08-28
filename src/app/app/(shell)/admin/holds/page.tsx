import type { Metadata } from "next";
import { withAdmin } from "@/app/api/admin/_shared";
import { HoldsControl } from "@/admin-room/components/holds-control";
import { OperatorTool } from "@/admin-room/components/operator-tool";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>, and `AdminConsoleNav`'s label for this route.
export const metadata: Metadata = pageTitle("Held payouts");

/**
 * The admin room's held-payout surface (Phase 4, Task 10). Renders no `TopBar` and no `<main>`
 * of its own — `(shell)/layout.tsx` supplies both, `AdminExclusionsPage`'s own discipline
 * (`../exclusions/page.tsx`). Not linked from `TopBar` either, on the identical scoping note: an
 * operator reaches this page from the resolved flag that names the member's id.
 */
export default async function AdminHoldsPage() {
  return withAdmin(async () => {
    return (
      <OperatorTool
        title="Held payouts"
        intent={"Resolve a payout held at settlement. Release pays it to the member's wallet; confiscate forfeits it to the platform. Both are one-way."}
      >
        <HoldsControl />
      </OperatorTool>
    );
  });
}
