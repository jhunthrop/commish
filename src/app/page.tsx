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
import { listWireItems } from "@/league-service/wire";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { FrontDoorHero } from "@/league-room/components/front-door-hero";
import { NextDraftModule } from "@/league-room/components/next-draft-module";
import { OpenLeagueShelf, featuredScheduledLeague } from "@/league-room/components/public-league-list";
import { ProofStrip } from "@/league-room/components/proof-strip";
import { SeatClaimSteps } from "@/league-room/components/seat-claim-steps";
import { Wire } from "@/league-room/components/wire";

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
 *
 * 2026-08-25 founder finding, controller-ruled: at xl+, when a league qualifies
 * (`featuredScheduledLeague`), the hero band's headline pairs with `NextDraftModule` in a
 * two-column grid — the SAME merged, capped list the shelf renders, so the module and the
 * shelf's one inked row/card can never disagree about which league is featured
 * (`featuredInHero` tells the shelf to go all-quiet while the module carries that ink instead).
 */
export default async function Home() {
  const nowIso = new Date().toISOString();
  const clock = { now: () => nowIso };

  const [user, { leagues, house }, stats, wireItems] = await Promise.all([
    getCurrentUser(),
    listPublicLeagues(getDb(), normalizeBrowseFilter({}), clock, { sort: "seats_remaining", whenFullOnly: false }),
    getProofCache().stats(() => proofStats(getDb(), { clock })),
    // Task 8: the wire's request-time read, on the page's one clock — see `Wire`'s own docblock
    // for the whole request-time-truth account (deferral D4, no anonymous SSE).
    listWireItems(getDb(), clock),
  ]);

  // D1/E7 (Phase 3.7, Task 5): guided is a signed-in PREFERENCE behavior, never a surface
  // default — see `/browse`'s identical read.
  const helpLevel: HelpLevel = user === null ? "standard" : (await readPreferences(getDb(), user)).helpLevel;

  // 2026-08-25 founder finding, controller-ruled: the SAME capped, merged list the shelf below
  // renders (house whole, member leagues capped at `shelfCap`) — no second query, no second cap.
  // `featuredScheduledLeague` is the exact subset of `featuredLeagueId` that is a genuinely
  // scheduled, ticking draft (never the shelf's own fallback-to-tightest-seats pick), so the hero
  // module and the shelf's one inked row/card can never point at two different leagues.
  const cappedLeagues = leagues.slice(0, UI_CONFIG.frontDoor.shelfCap);
  const featuredLeague = featuredScheduledLeague([...house, ...cappedLeagues]);

  return (
    <>
      <PublicBar
        intent={PAGE_INTENT}
        nav={NAV}
        action={
          <ButtonLink href="/browse">Take a seat</ButtonLink>
        }
      />
      {/* Task 8: the wire — real events under the nav, per the mock. Renders nothing at all
          when the product is too quiet to earn it (`UI_CONFIG.wire.minItems`). */}
      <Wire items={wireItems} />
      <main className="flex flex-col gap-10 bg-surface">
        {/* Task 7: the hero band is the page's one floodlit ground — `.floodlight` (the wash,
            and the `position: relative` its overlays anchor to) and `.yard-lines` (a full-bleed
            child) are Task 2's ground vocabulary, and this wrapper owns the `overflow-hidden`
            that clips both at the band's own edge (Task 2's carry). The inner div is `relative`
            so the content paints above the positioned overlays; each child carries its own
            `Rise` stagger slot (headline 1, sub 2, steps 3, scoreboard 4 — the mock's d1..d4). */}
        <section className="floodlight w-full overflow-hidden">
          <div aria-hidden="true" className="yard-lines" />
          <div className="relative flex flex-col gap-6 px-4 py-10 sm:px-10 sm:py-14">
            {/* 2026-08-25 founder finding, controller-ruled: at xl+ the headline block pairs
                with "THE NEXT DRAFT" module in a two-column grid, vertically centered against
                each other — the right half of the hero band used to be a dead dark field once
                the headline went left-aligned. Below xl (and whenever nothing qualifies —
                `featuredLeague` null) the hero keeps its current single-column shape: real or
                absent, never dressed up (rule 6). */}
            {featuredLeague === null ? (
              <FrontDoorHero />
            ) : (
              <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-center xl:gap-10">
                <FrontDoorHero />
                <NextDraftModule league={featuredLeague} signedIn={user !== null} />
              </div>
            )}
            <SeatClaimSteps />
            <ProofStrip stats={stats} nowIso={nowIso} />
          </div>
        </section>

        <section className="flex w-full flex-col gap-4 border-t border-line px-4 pb-10 pt-8 sm:px-10">
          <OpenLeagueShelf
            house={house}
            leagues={cappedLeagues}
            signedIn={user !== null}
            helpLevel={helpLevel}
            asOfTime={formatAbsoluteTime(nowIso)}
            featuredInHero={featuredLeague !== null}
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
