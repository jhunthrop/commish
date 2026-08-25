import { PageTitle } from "@/components/ui";
import { withAdmin } from "@/app/api/admin/_shared";
import { ExclusionControl } from "@/admin-room/components/exclusion-control";

export const dynamic = "force-dynamic";

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
      <>
        <header className="flex flex-col gap-1">
          <PageTitle>Self exclusion</PageTitle>
          <p className="text-sm text-text-muted">
            Clear self exclusion for a member who asked support to reopen paid play. This is recorded on the platform record.
          </p>
        </header>

        <ExclusionControl />
      </>
    );
  });
}
