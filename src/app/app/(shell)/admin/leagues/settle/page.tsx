import type { Metadata } from "next";
import { withAdmin } from "@/app/api/admin/_shared";
import { SettleLeagueControl } from "@/admin-room/components/settle-league-control";
import { OperatorTool } from "@/admin-room/components/operator-tool";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>, and `AdminConsoleNav`'s label for this route.
export const metadata: Metadata = pageTitle("Settle league");

/**
 * The admin room's settlement surface (Phase 4, Task 10). Renders no `TopBar` and no `<main>` of
 * its own — `(shell)/layout.tsx` supplies both, `AdminDissolveLeaguePage`'s own discipline
 * (`../dissolve/page.tsx`). Not linked from `TopBar` either, on the identical scoping note: an
 * operator reaches this page from the season-close checklist that names the league's id.
 */
export default async function AdminSettleLeaguePage() {
  return withAdmin(async () => {
    return (
      <OperatorTool
        title="Settle league"
        intent={"Pay a finished league's published prize table and close its escrow at zero. Winners with an open review get their payout held instead."}
      >
        <SettleLeagueControl />
      </OperatorTool>
    );
  });
}
