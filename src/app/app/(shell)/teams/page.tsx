import type { Metadata } from "next";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { clubIndex } from "@/teams/club-index";
import { ClubIndexGrid } from "@/teams/components/club-index-grid";

export const metadata: Metadata = pageTitle("Teams");

/**
 * THE INDEX OF THE 32 CLUBS — the route `TEAM_PAGE_CONFIG.routeBase` has always named and nothing
 * served until now (integrity cleanup, 2026-09-10). `link-integrity.source.test.ts` caught it:
 * `/app/teams` was spelled in source, every club page hung off it, and the base itself 404'd, so
 * a reader who shortened the URL or a crawler that walked up from a club page found nothing.
 * Adding the index is the fix the team analysis page already implied, rather than renaming the
 * base to a route that serves by accident.
 *
 * Signed-in like every page under this shell, and league-free for the same reason the club page
 * is: a club is the league's opponent pool, not any one league's property. No database read at
 * all — `clubIndex` derives from the same constant `resolveTeamRoute` calls canonical, so this
 * page cannot render an empty shelf that looks like an outage.
 *
 * Renders no `TopBar` and no `<main>` of its own — `(shell)/layout.tsx` supplies both.
 */
export default async function TeamsIndexPage() {
  await requireCurrentUser();
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Teams</PageTitle>
      <ClubIndexGrid rows={clubIndex()} />
    </div>
  );
}
