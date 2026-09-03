import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ButtonLink } from "@/components/ui";
import { MICRO_LABEL, UI_CONFIG } from "@/components/ui/config";
import { PublicBar, STOREFRONT_NAV, type NavLink } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { formatAbsoluteTime } from "@/league";
import { listPublicLeagues } from "@/league-service/browse";
import { proofStats } from "@/league-service/proof";
import { getProofCache } from "@/league-service/proof-cache-instance";
import { listWireItems } from "@/league-service/wire";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { listReviews } from "@/review-service/reviews";
import { excludeFixtureReviews } from "./reviews/fixture-filter";
import { FrontDoorHero } from "@/league-room/components/front-door-hero";
import { FrontDoorLowerThird } from "@/league-room/components/front-door-lower-third";
import { OpenLeagueShelf, featuredFillingLeague } from "@/league-room/components/public-league-list";
import { Wire } from "@/league-room/components/wire";

export const dynamic = "force-dynamic";

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/";

/**
 * The nav links (Task 16, F5). GAMEDAY (2026-08-28): the base pair moved to `STOREFRONT_NAV`
 * (`@/components/app-shell/public-bar`) — the front door used to be the only public surface that
 * filled `nav` in at all, so a stranger who landed on `/support`, `/legal/terms` or
 * `/league-rules` from a search result had one door back into the product and it was the
 * wordmark. Every public surface carries the same two links now, and this page appends its own
 * conditional third rather than owning a private copy of the base.
 *
 * D3 (flow analysis; storefront review): "Reviews" is appended ONLY once the feed genuinely has
 * something to show — `hasRealReviews` below reads the SAME fixture-exclusion `/reviews` itself
 * applies (`excludeFixtureReviews`, `./reviews/fixture-filter`), so the nav never advertises a
 * room this task already knows is empty (the site's one review today is a fixture, filed by the
 * onboarding e2e spec).
 */
const REVIEWS_NAV_LINK: NavLink = { href: "/reviews", label: "Reviews" };

/**
 * The signed-out landing page (Phase 3.6, Task 5; reshaped by Phase 3.7, Task 6) — the first
 * surface a stranger sees, and the one the founder's "best app I've ever seen" bar is judged on
 * hardest. SUNDAY v5 (Direction A): the BOARD is the hero — a two-line broadcast headline, then
 * the real shelf. Everything on it is either a query or a sentence this product can keep: the
 * proof numbers render only what `proofStats` actually earned, now inside the lower third, and
 * the shelf is the SAME `listPublicLeagues` read and the SAME `OpenLeagueShelf` `/browse`
 * renders — the front door does not invent a second, decorative shelf, it shows the real one.
 *
 * D3 (Task 6): the front door is the CAPPED teaser — the house shelf plus the first
 * `UI_CONFIG.frontDoor.shelfCap` member leagues, one quiet "See every open league" pill to
 * `/browse`, and NO filter row or query params of its own. `/browse` is the full, filterable
 * lobby; the old one-page-renders-everything front door (the audit's 5,800px finding, E2/D3)
 * dies here. Reading no params also means this page is one fixed document: two visitors always
 * see the same front door.
 *
 * `PublicBar`'s `action` points at `/browse` when nothing on the shelf is genuinely filling;
 * once `featuredLeague` names a room, the hero's verb IS that room's seat and this pill steps
 * back to quiet. (v5's law 6 retired the one-ink-per-view arithmetic — the verb has a place
 * instead of a count — but two loud "Take a seat"s an inch apart is still one too many.)
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
 * The 2026-08-25 hero-module ruling is superseded by v5's law 6: the featured room's second
 * rendering lives in the lower third now, and `featuredInHero` still tells the shelf to go
 * all-quiet so the two renderings cannot disagree about which league leads.
 */
export default async function Home() {
  const nowIso = new Date().toISOString();
  const clock = { now: () => nowIso };

  const [user, { leagues, house }, stats, wireItems, reviewsPage] = await Promise.all([
    getCurrentUser(),
    listPublicLeagues(getDb(), normalizeBrowseFilter({}), clock, { sort: "seats_remaining", whenFullOnly: false }),
    getProofCache().stats(() => proofStats(getDb())),
    // Task 8: the wire's request-time read, on the page's one clock — see `Wire`'s own docblock
    // for the whole request-time-truth account (deferral D4, no anonymous SSE).
    listWireItems(getDb(), clock),
    // D3: whether the nav's own "Reviews" link has anything honest to advertise — the same first
    // page `/reviews` itself reads, so "is there anything real to show" is answered once.
    listReviews(getDb(), {}),
  ]);


  // 2026-08-25 founder finding, controller-ruled (Q5, wave-1 review: name and comment repointed
  // to what the sit-and-go shelf actually produces — storefront review R1 retired the
  // scheduled-kickoff fact this used to describe). The SAME capped, merged list the shelf below
  // renders (house whole, member leagues capped at `shelfCap`) — no second query, no second cap.
  // `featuredFillingLeague` is the exact subset of `featuredLeagueId` that is genuinely FILLING —
  // at least one seat taken, never the shelf's own fallback-to-tightest-seats pick a shelf where
  // nothing has a single seat taken falls back to — so the hero module and the shelf's one inked
  // row/card can never point at two different leagues.
  const cappedLeagues = leagues.slice(0, UI_CONFIG.frontDoor.shelfCap);
  const featuredLeague = featuredFillingLeague([...house, ...cappedLeagues]);

  const hasRealReviews = excludeFixtureReviews(reviewsPage.reviews).length > 0;
  const nav: readonly NavLink[] = hasRealReviews ? [...STOREFRONT_NAV, REVIEWS_NAV_LINK] : STOREFRONT_NAV;

  return (
    <>
      <PublicBar
        intent={PAGE_INTENT}
        signedIn={user !== null}
        nav={nav}
        action={
          // The rail's persistent verb, in the amber the verb owns — law 6 lets one act repeat,
          // and this is the same act the hero and the lower third carry.
          <ButtonLink href="/browse" variant="verb">
            Take a seat
          </ButtonLink>
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
        {/* SUNDAY v5 (Direction A, founder-approved from the mockups): the hero shrinks to the
            broadcast register — one line, one sub, the money fact, the verb — because the promise
            it used to assert in six text blocks is ON SCREEN one band below: real rooms with live
            seat meters. `SeatClaimSteps` (the three-step strip) is retired with it: "Pick a seat"
            above a board of Join verbs was the control's own label restated as prose, and the one
            fact it carried a visitor cannot see elsewhere ("your seat holds for 10 minutes") is
            said at the moment it is true, on the hold page. `NextDraftModule` is retired because
            the lower third is law 6's place for the featured room, and two renderings of the same
            subject on one screen is the disagreement the module existed to prevent. */}
        <section className="floodlight w-full overflow-hidden">
          <div aria-hidden="true" className="yard-lines" />
          <div className="relative px-4 py-10 sm:px-10 sm:py-14">
            <FrontDoorHero />
          </div>
        </section>

        <section className="flex w-full flex-col gap-4 border-t border-line px-4 pb-10 pt-8 sm:px-10">
          <OpenLeagueShelf
            house={house}
            leagues={cappedLeagues}
            signedIn={user !== null}
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
        </section>

        {/*
          THE CLOSING BAND (Gameday, 2026-08-28). The gauntlet's MEDIUM put "Start your own" in a
          row below the shelf, structured by a hairline instead of the bordered card it used to
          wear, and that was right about the box and wrong about the weight: an `h3` at `text-lg`
          with an underlined text link under it is how the last thing a stranger reads on the
          storefront ended up being the quietest thing on the page. Copy is UNCHANGED — what moved
          is that it is a real band on its own ground (the shelf's own last row is a hairline away,
          and two hairlines a few pixels apart read as a rendering accident), the heading takes a
          display size, and the way in is the same quiet pill the shelf's own doorway uses rather
          than a third spelling of "a link that is really a button".

          Still quiet, deliberately: this page's one ink action belongs to the seat (E2), and a
          commissioner recruiting their own group is not the visitor this door is built for.

          `/app` is auth-gated by `middleware.ts`, so a signed-out visitor lands at sign-in first
          rather than an error, exactly like the shelf's own identical link.
        */}
        <section className="w-full border-t border-line bg-surface-elevated">
          <div className="flex w-full flex-col gap-6 px-4 py-10 sm:px-10 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-prose flex-col gap-2">
              <p className={`${MICRO_LABEL} text-text-faint`}>Your own group</p>
              <h2 className="font-display text-display-md font-semibold leading-display text-text-primary">Start your own league</h2>
              <p className="text-text-muted">
                Your rules, your people. The platform still runs the chores: the draft room, the
                schedule, and the scoring. Snake or auction, any scoring preset, private or public.
              </p>
            </div>
            <ButtonLink href="/app#create-league" variant="secondary" className="shrink-0">
              Create a league
            </ButtonLink>
          </div>
        </section>

        {/* Law 6: the screen ends in a lower third — the subject (the room closest to firing),
            the proof the operator can measure, and the one verb. `ProofStrip`'s three numbers
            moved here; the strip itself is retired. */}
        <FrontDoorLowerThird stats={stats} featuredLeague={featuredLeague} signedIn={user !== null} />
      </main>
      <PublicFooter />
    </>
  );
}
