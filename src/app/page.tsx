import Link from "next/link";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ButtonLink } from "@/components/ui";
import { UI_CONFIG } from "@/components/ui/config";
import { PublicBar, type NavLink } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import type { HelpLevel } from "@/identity/preferences";
import { readPreferences } from "@/identity-service/preferences";
import { formatAbsoluteTime } from "@/league";
import { listPublicLeagues } from "@/league-service/browse";
import { proofStats } from "@/league-service/proof";
import { getProofCache } from "@/league-service/proof-cache-instance";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { FrontDoorHero } from "@/league-room/components/front-door-hero";
import { OpenLeagueShelf } from "@/league-room/components/public-league-list";
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

/**
 * The signed-out landing page (Phase 3.6, Task 5; reshaped by Phase 3.7, Task 6) — the first
 * surface a stranger sees, and the one the founder's "best app I've ever seen" bar is judged on
 * hardest. Everything on it is either a query or a sentence this product can keep: the hero and
 * three-step strip are static copy this task can defend word for word, `ProofStrip` renders only
 * numbers `proofStats` actually earned (Task 4), and the shelf below it is the SAME
 * `listPublicLeagues` read and the SAME `OpenLeagueShelf` `/browse` renders — the front door
 * does not invent a second, decorative shelf, it shows the real one.
 *
 * D3 (Task 6): the front door is the CAPPED teaser — the house shelf plus the first
 * `UI_CONFIG.frontDoor.shelfCap` member leagues, one quiet "See every open league" pill to
 * `/browse`, and NO filter row or query params of its own. `/browse` is the full, filterable
 * lobby; the old one-page-renders-everything front door (the audit's 5,800px finding, E2/D3)
 * dies here. Reading no params also means this page is one fixed document: two visitors always
 * see the same front door.
 *
 * `PublicBar`'s `action` (the ink-pill "Take a seat" CTA) points at `/browse`, never an anchor
 * into this page's own shelf: the shelf IS where a seat is actually taken, on this page or on
 * `/browse`, but a fixed, bookmarkable destination is simpler to reason about than a scroll
 * position, and `/browse` renders the identical shelf this page does. The shelf's own single
 * featured card carries the view's one CARD ink (D2) — the mock itself pairs the nav pill with
 * exactly one inked Join, and rule 5's budget is judged against that founder-approved frame.
 *
 * `proofStats` is read through `getProofCache()` (`@/league-service/proof-cache-instance`) —
 * this is the highest-traffic unauthenticated page in the product, and the three-query read
 * behind the strip is cached for `MATCHMAKING_CONFIG.proof.cacheTtlSeconds` (60s) rather than
 * paid on every render (P4 review, binding CARRY).
 *
 * ONE `now` instant, read once and threaded to every reader that needs it (`listPublicLeagues`'s
 * own clock, the shelf head's "Seat counts as of" sentence) — the same "one instant, every
 * card" discipline `listPublicLeagues` itself already holds internally.
 *
 * E2 (Task 6): the two bands are FULL-WIDTH — no `max-w-6xl` well — with the mock's 40px desktop
 * gutter from the spacing scale (`sm:px-10`; `px-4` keeps the product's usual minimum-viewport
 * gutter below that).
 */
export default async function Home() {
  const nowIso = new Date().toISOString();
  const clock = { now: () => nowIso };

  const [user, { leagues, house }, stats] = await Promise.all([
    getCurrentUser(),
    listPublicLeagues(getDb(), normalizeBrowseFilter({}), clock, { sort: "seats_remaining", whenFullOnly: false }),
    getProofCache().stats(() => proofStats(getDb(), { clock })),
  ]);

  // D1/E7 (Phase 3.7, Task 5): guided is a signed-in PREFERENCE behavior, never a surface
  // default — see `/browse`'s identical read.
  const helpLevel: HelpLevel = user === null ? "standard" : (await readPreferences(getDb(), user)).helpLevel;

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
        <section className="flex w-full flex-col gap-6 px-4 py-10 sm:px-10 sm:py-14">
          <FrontDoorHero />
          <SeatClaimSteps />
          <ProofStrip stats={stats} />
        </section>

        <section className="flex w-full flex-col gap-4 border-t border-line px-4 pb-10 pt-8 sm:px-10">
          <OpenLeagueShelf
            house={house}
            leagues={leagues.slice(0, UI_CONFIG.frontDoor.shelfCap)}
            signedIn={user !== null}
            helpLevel={helpLevel}
            asOfTime={formatAbsoluteTime(nowIso)}
          />
          <div>
            {/* D3's one way out of the teaser: quiet on purpose — the shelf's featured card
                holds this view's card ink (D2), and a doorway is not an action. */}
            <ButtonLink href="/browse" variant="secondary">
              See every open league
            </ButtonLink>
          </div>

          {/* The gauntlet's MEDIUM, re-framed by rule 4 (hairlines, not boxes): "Start your own"
              keeps its own row below the shelf it is not competing with, structured by a thin
              rule and space rather than the bordered card it used to wear. Copy unchanged. */}
          <div className="flex flex-col items-start gap-2 border-t border-line pt-6">
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
