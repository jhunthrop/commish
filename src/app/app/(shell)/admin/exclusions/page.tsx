import type { Metadata } from "next";
import { withAdmin } from "@/app/api/admin/_shared";
import { ExclusionControl } from "@/admin-room/components/exclusion-control";
import { OperatorTool } from "@/admin-room/components/operator-tool";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>, and `AdminConsoleNav`'s label for this route.
export const metadata: Metadata = pageTitle("Self exclusion");

/**
 * The admin room's self-exclusion clear surface (Task 7 Step 2). Renders no `TopBar` and no
 * `<main>` of its own — `(shell)/layout.tsx` supplies both, the same discipline `AdminQueuePage`
 * follows. Not linked from `TopBar` (Task 7's own scoping note, `top-bar.tsx`'s docblock already
 * warns against a sixth icon-only control at 360px): an operator reaches this page directly, from
 * the support conversation that names the member's id, the same way a held-trade detail page is
 * reached by id rather than by a nav link enumerating every open trade.
 */
export default async function AdminExclusionsPage() {
  return withAdmin(async () => {
    return (
      <OperatorTool
        title="Self exclusion"
        intent={"Clear self exclusion for a member who asked support to reopen paid play. This is recorded on the platform record."}
      >
        <ExclusionControl />
      </OperatorTool>
    );
  });
}
