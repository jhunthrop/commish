import Link from "next/link";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ButtonLink } from "@/components/ui";
import { PublicBar, type NavLink } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { formatAbsoluteTime } from "@/league";
import { listPublicLeagues } from "@/league-service/browse";
import { proofStats } from "@/league-service/proof";
import { getProofCache } from "@/league-service/proof-cache-instance";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { BrowseFilters, type BrowseFilterOption } from "@/league-room/components/browse-filters";
import { FrontDoorHero } from "@/league-room/components/front-door-hero";
import { HouseLeagueShelf, PublicLeagueList, seatCountsAsOfSentence } from "@/league-room/components/public-league-list";
import { ProofStrip } from "@/league-room/components/proof-strip";
import { SeatClaimSteps } from "@/league-room/components/seat-claim-steps";

export const dynamic = "force-dynamic";

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/";

/**
 * The mock's three nav links (Task 16, F5) — `PublicBar` renders bare on every other public
 * surface (`/browse`, `/reviews`, `/app/join/[code]`); the front door alone fills these in.
 * "How it works" points at `/league-rules` (the addendum's Task 21 Step 4 page, stubbed real by
 * this task — see `src/app/league-rules/page.tsx`): a nav item pointing at a route nobody
 * created is the footer-to-a-404 failure with a bigger font.
 */
const NAV: readonly NavLink[] = [
  { href: "/browse", label: "Open leagues" },
  { href: "/league-rules", label: "How it works" },
  { href: "/reviews", label: "Reviews" },
];

const first = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

/**
 * The signed-out landing page (Phase 3.6, Task 5) — the first surface a stranger sees, and the
 * one the founder's "best app I've ever seen" bar is judged on hardest. Everything on it is
 * either a query or a sentence this product can keep: the hero and three-step strip are static
 * copy this task can defend word for word, `ProofStrip` renders only numbers `proofStats`
 * actually earned (Task 4), and the shelf below it is the SAME `listPublicLeagues` read and the
 * SAME `OpenLeagueCard`/`HouseLeagueShelf`/`BrowseFilters` components `/browse` renders — the
 * front door does not invent a second, decorative shelf, it shows the real one.
 *
 * `PublicBar`'s `action` (the ink-pill "Take a seat" CTA — the front door's ONE ink action,
 * rule 5) points at `/browse`, never an anchor into
 * this page's own shelf: the shelf IS where a seat is actually taken, on this page or on
 * `/browse`, but a fixed, bookmarkable destination is simpler to reason about than a scroll
 * position, and `/browse` renders the identical shelf this page does.
 *
 * `proofStats` is read through `getProofCache()` (`@/league-service/proof-cache-instance`) —
 * this is the highest-traffic unauthenticated page in the product, and the three-query read
 * behind the strip is cached for `MATCHMAKING_CONFIG.proof.cacheTtlSeconds` (60s) rather than
 * paid on every render (P4 review, binding CARRY).
 *
 * ONE `now` instant, read once and threaded to every reader that needs it (`listPublicLeagues`'s
 * own clock, the shelf header's "Seat counts as of" sentence) — the same "one instant, every
 * card" discipline `listPublicLeagues` itself already holds internally.
 */
export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = normalizeBrowseFilter({
    experienceTier: first(params.experienceTier),
  });
  const sort = first(params.sort) === "soonest" ? "soonest" : "seats_remaining";
  const whenFullOnly = first(params.whenFull) === "1";
  const active: BrowseFilterOption =
    whenFullOnly ? "when_full" : sort === "soonest" ? "soonest" : filter.experienceTier === "beginner" ? "newer" : "all";

  const nowIso = new Date().toISOString();
  const clock = { now: () => nowIso };

  const [user, { leagues, house }, stats] = await Promise.all([
    getCurrentUser(),
    listPublicLeagues(getDb(), filter, clock, { sort, whenFullOnly }),
    getProofCache().stats(() => proofStats(getDb(), { clock })),
  ]);

  return (
    <>
      <PublicBar
        intent={PAGE_INTENT}
        nav={NAV}
        action={
          <ButtonLink href="/browse">Take a seat</ButtonLink>
        }
      />
      <main className="flex flex-col gap-10 bg-surface">
        <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:py-14">
          <FrontDoorHero />
          <SeatClaimSteps />
          <ProofStrip stats={stats} />
        </section>

        <section className="mx-auto flex w-full max-w-6xl flex-col gap-4 border-t border-line px-4 pb-10 pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-semibold leading-display text-text-primary">Open leagues</h2>
            <p className="text-sm text-text-muted">{seatCountsAsOfSentence(formatAbsoluteTime(nowIso))}</p>
          </div>
          <HouseLeagueShelf leagues={house} signedIn={user !== null} />
          <BrowseFilters active={active} />
          <PublicLeagueList leagues={leagues} signedIn={user !== null} />

          {/* The gauntlet's MEDIUM: "Start your own" used to be a tile among tiles, reading as
              an afterthought rather than a category of its own. Its own row, its own framing,
              below the shelf it is not competing with. */}
          <div className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface-elevated p-4">
            <h3 className="font-display text-lg font-semibold leading-display text-text-primary">Start your own league</h3>
            <p className="max-w-prose text-sm text-text-muted">
              Your rules, your people. The platform still runs the chores: the draft room, the
              schedule, and the scoring. Snake or auction, any scoring preset, private or public.
            </p>
            {/* /app is auth-gated by middleware.ts, so a signed-out visitor lands at sign-in
                first rather than an error, exactly like the shelf's own identical link. */}
            <Link href="/app#create-league" className="text-sm font-medium text-accent underline">
              Create a league
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
