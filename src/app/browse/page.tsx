import Link from "next/link";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell/app-shell";
import { shellData } from "@/components/app-shell/shell-data";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import type { HelpLevel } from "@/identity/preferences";
import { readPreferences } from "@/identity-service/preferences";
import { formatAbsoluteTime } from "@/league";
import { listPublicLeagues } from "@/league-service/browse";
import { listWireItems } from "@/league-service/wire";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { BrowseFilters, type BrowseFilterOption } from "@/league-room/components/browse-filters";
import { OpenLeagueShelf } from "@/league-room/components/public-league-list";
import { PracticeEntryLink } from "@/league-room/components/practice-entry-link";
import { Wire } from "@/league-room/components/wire";

export const dynamic = "force-dynamic";

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/browse";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

const first = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? null : null;

/**
 * The full, filterable lobby (D3's other half — the front door is the capped teaser, this page
 * is the whole shelf), and the only page under a non-`/app` prefix that reads league data.
 * `middleware.ts` does not redirect outside `/app`, so this renders for a signed-out visitor by
 * design — `getCurrentUser()` returning null is the expected case, not an error, and the only
 * thing it changes is whether a card offers a join button or a sign-in link. The signed-in
 * chrome (`TopBar`) appears only when there is a person to name.
 *
 * The lede always offers a "Start your own league" path alongside the browse, not only inside
 * the shelf's empty state: a commissioner arriving to recruit for their own group is a real
 * visitor to this page, and results matching their filters should not be the only way they find
 * their way out of browsing someone else's leagues.
 *
 * Phase 3.7, Task 6 (E3/F2): the page renders ONE `OpenLeagueShelf` — the merged head (this
 * band's title is the page's own `h1`, `headingLevel={1}`), the house explainer row, the filter
 * pills, the legend line, and house + member cards in one grid — where a `PageTitle`, a floating
 * "Commish house leagues" section, `BrowseFilters` and a member list used to stack as four
 * siblings.
 *
 * Task 2: this page sits outside `/app`, so it is never wrapped by `(shell)/layout.tsx` — it
 * calls `shellData` and renders `AppShell` ITSELF, and only when there is a user (`/browse` is
 * reachable signed out by design, and a signed-in shell around a stranger would be chrome they
 * cannot use). Signed out, the header is `PublicBar` (Task 16, F6).
 */
export default async function BrowsePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = normalizeBrowseFilter({
    format: first(params.format),
    experienceTier: first(params.experienceTier),
    stakeTier: first(params.stakeTier),
    participationTier: first(params.participationTier),
  });
  // Phase 3.6, Task 5, Step 4: the shelf's own sort pill and when-full toggle — separate query
  // params, never a `BrowseFilter` axis (`BrowseQueryOptions`'s own docblock, `@/league-service/
  // browse.ts`).
  const sort = first(params.sort) === "soonest" ? "soonest" : "seats_remaining";
  const whenFullOnly = first(params.whenFull) === "1";
  const active: BrowseFilterOption =
    whenFullOnly ? "when_full" : sort === "soonest" ? "soonest" : filter.experienceTier === "beginner" ? "newer" : "all";

  const nowIso = new Date().toISOString();
  const clock = { now: () => nowIso };
  const [user, { leagues, house }] = await Promise.all([
    getCurrentUser(),
    listPublicLeagues(getDb(), filter, clock, { sort, whenFullOnly }),
  ]);

  // D1/E7 (Phase 3.7, Task 5): guided is a signed-in PREFERENCE behavior, never a surface
  // default — a stranger gets `standard` (every definition one click away), a member gets
  // their own stored choice, so a guided-preference member keeps inline captions here.
  const helpLevel: HelpLevel = user === null ? "standard" : (await readPreferences(getDb(), user)).helpLevel;

  const content = (
    <>
      {/* Task 9: the same quiet practice invitation the front door carries, above the shelf so
          it never fights the shelf's own filters or cards for attention — one line, one link,
          never the view's ink action. */}
      <PracticeEntryLink signedIn={user !== null} />
      <OpenLeagueShelf
        house={house}
        leagues={leagues}
        signedIn={user !== null}
        helpLevel={helpLevel}
        asOfTime={formatAbsoluteTime(nowIso)}
        headingLevel={1}
        intro={
          <p className="max-w-prose text-text-muted">
            Leagues looking for managers, with a draft still to come. Pick one that matches how
            you like to play. Recruiting your own group instead?{" "}
            {/* /app is auth-gated by middleware.ts, so a signed-out visitor lands at sign-in
                first rather than an error, exactly like the empty state's identical link. */}
            <Link href="/app#create-league" className="font-medium text-accent underline">
              Start your own league
            </Link>
            .
          </p>
        }
        filters={<BrowseFilters active={active} />}
      />
    </>
  );

  if (user === null) {
    // Task 8: the wire mounts on the SIGNED-OUT branch only (per the Spec — the signed-in view
    // is `AppShell` chrome, not the public nav), so its read runs only when there is a wire to
    // feed. Awaited here rather than in the `Promise.all` above: the branch is not known until
    // `getCurrentUser()` resolves, and a member's browse should not pay for a read it never
    // renders. Same `clock` instant as every card on the page.
    const wireItems = await listWireItems(getDb(), clock);
    return (
      <>
        <PublicBar intent={PAGE_INTENT} />
        {/* Real events under the nav, per the mock — nothing at all when the product is too
            quiet to earn it (`UI_CONFIG.wire.minItems`). */}
        <Wire items={wireItems} />
        {/* Full-bleed, no `max-w-*`, matching `AppShell`'s own signed-in `<main>` (NEW-2): the
            open-league shelf is the busiest page in the product and is not under `/app`, so it
            never inherited the shell's full-width fix. A long-form reading surface keeps its own
            `max-w-prose` on its paragraph column instead, same as the shell's own carve-out. */}
        <main className="flex w-full min-w-0 flex-col gap-6 px-4 py-4">{content}</main>
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
