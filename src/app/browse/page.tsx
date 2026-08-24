import Link from "next/link";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { AppShell } from "@/components/app-shell/app-shell";
import { shellData } from "@/components/app-shell/shell-data";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { listPublicLeagues } from "@/league-service/browse";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { BrowseFilters } from "@/league-room/components/browse-filters";
import { HouseLeagueShelf, PublicLeagueList } from "@/league-room/components/public-league-list";

export const dynamic = "force-dynamic";

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/browse";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

const first = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? null : null;

/**
 * The public front door to matchmaking, and the only page under a non-`/app` prefix that reads
 * league data. `middleware.ts` does not redirect outside `/app`, so this renders for a
 * signed-out visitor by design — `getCurrentUser()` returning null is the expected case, not an
 * error, and the only thing it changes is whether a card offers a join button or a sign-in
 * link. The signed-in chrome (`TopBar`) appears only when there is a person to name.
 *
 * The intro line always offers a "Start your own league" path alongside the browse, not only
 * inside `PublicLeagueList`'s empty state: a commissioner arriving to recruit for their own
 * group is a real visitor to this page, and results matching their filters should not be the
 * only way they find their way out of browsing someone else's leagues.
 *
 * Phase 3.5, Task 8: `listPublicLeagues` now orders by seats-remaining first (Step 4) and every
 * `PublicLeagueSummary` carries `startTrigger` (Step 3, `PublicLeagueList`'s own card reads it) —
 * both land here for free, since this page already renders whatever `listPublicLeagues` answers
 * with, unfiltered by field.
 *
 * Phase 3.5 addendum, Task 14: `listPublicLeagues` now answers `BrowseBody` — `leagues` AND
 * `house` — and §4.1's hybrid lobby means the house shelf renders FIRST, above the filters and
 * the member list, the founder's "view and join like FFPC and Apex" made literal page order.
 *
 * Task 2: this page sits outside `/app`, so it is never wrapped by `(shell)/layout.tsx` — it
 * calls `shellData` and renders `AppShell` ITSELF, and only when there is a user (`/browse` is
 * reachable signed out by design, and a signed-in shell around a stranger would be chrome they
 * cannot use). Signed out, the header is `PublicBar` (Task 16, F6) — this page's own copy-pasted
 * inline header is gone.
 */
export default async function BrowsePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = normalizeBrowseFilter({
    format: first(params.format),
    experienceTier: first(params.experienceTier),
    stakeTier: first(params.stakeTier),
    participationTier: first(params.participationTier),
  });
  const user = await getCurrentUser();
  const { leagues, house } = await listPublicLeagues(getDb(), filter);

  const content = (
    <>
      <PageTitle>Open leagues</PageTitle>
      <p className="max-w-prose text-text-muted">
        Leagues looking for managers, with a draft still to come. Pick one that matches how you
        like to play. Recruiting your own group instead?{" "}
        {/* /app is auth-gated by middleware.ts, so a signed-out visitor lands at sign-in
            first rather than an error, exactly like the empty state's identical link. */}
        <Link href="/app#create-league" className="font-medium text-accent underline">
          Start your own league
        </Link>
        .
      </p>
      {/* Phase 3.5 addendum, Task 14: §4.1's hybrid lobby — the house shelf leads, the member
          list follows. `HouseLeagueShelf` renders nothing at all when the shelf is empty, so
          an unreconciled database (or a rung mid-restock) never shows an apology above a
          member list that is doing just fine on its own. */}
      <HouseLeagueShelf leagues={house} signedIn={user !== null} />
      <BrowseFilters filter={filter} />
      <PublicLeagueList leagues={leagues} signedIn={user !== null} />
    </>
  );

  if (user === null) {
    return (
      <>
        <PublicBar intent={PAGE_INTENT} />
        <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">{content}</main>
        <PublicFooter />
      </>
    );
  }

  const { rail, liveState } = await shellData(getDb(), user);
  return (
    <AppShell user={{ displayName: user.displayName, avatar: user.avatarUrl, isAdmin: user.isAdmin }} rail={rail} liveState={liveState}>
      {content}
    </AppShell>
  );
}
