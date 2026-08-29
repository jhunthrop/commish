import type { Metadata } from "next";
import { withAdmin } from "@/app/api/admin/_shared";
import { DissolveLeagueControl } from "@/admin-room/components/dissolve-league-control";
import { OperatorTool } from "@/admin-room/components/operator-tool";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>, and `AdminConsoleNav`'s label for this route.
export const metadata: Metadata = pageTitle("Dissolve league");

/**
 * The admin room's league-dissolution surface (Phase 4, Task 9). Renders no `TopBar` and no
 * `<main>` of its own — `(shell)/layout.tsx` supplies both, `AdminExclusionsPage`'s own
 * discipline (`../../exclusions/page.tsx`). Not linked from `TopBar` either, on the identical
 * scoping note that page's own docblock states: an operator reaches this page directly, from the
 * support conversation that names the league's id, the same way that page is reached rather than
 * from a nav link enumerating every open league.
 */
export default async function AdminDissolveLeaguePage() {
  return withAdmin(async () => {
    return (
      <OperatorTool
        title="Dissolve league"
        intent={"Close a league that did not fill before its draft. This cannot be undone. Every seated member is refunded their entry fee and told why."}
      >
        <DissolveLeagueControl />
      </OperatorTool>
    );
  });
}
