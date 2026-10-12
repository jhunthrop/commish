import { getDb } from "@research/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ButtonLink } from "@/components/ui";
import { UI_CONFIG } from "@/components/ui/config";
import { PublicBar, STOREFRONT_NAV, type NavLink } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { LEAGUE_CONFIG } from "@/league";
import { listPublicLeagues } from "@/league-service/browse";
import { proofStats } from "@/league-service/proof";
import { getProofCache } from "@/league-service/proof-cache-instance";
import { listWireItems } from "@/league-service/wire";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
// The PURE module, not the client shelf: a server render may not CALL a client module's export.
import { featuredFillingLeague } from "@/matchmaking/shelf-order";
import { listReviews } from "@/review-service/reviews";
import { excludeFixtureReviews } from "./reviews/fixture-filter";
import { CrewDoor } from "@/league-room/components/crew-door";
import { FrontDoorHero } from "@/league-room/components/front-door-hero";
import { OpenLeagueShelf } from "@/league-room/components/public-league-list";
import { TrustFacts } from "@/league-room/components/trust-facts";
import { Wire } from "@/league-room/components/wire";

export const dynamic = "force-dynamic";

/** This page's own path — its `PublicBar`'s sign-in link returns here (Task 16, F6). */
const PAGE_INTENT = "/";

/**
 * The nav links (Task 16, F5). GAMEDAY (2026-08-28): the base pair moved to `STOREFRONT_NAV`
 * (`@/components/app-shell/public-bar`) — every public surface carries the same two links, and
 * this page appends its own conditional third rather than owning a private copy of the base.
 *
 * D3 (flow analysis; storefront review): "Reviews" is appended ONLY once the feed genuinely has
 * something to show — `hasRealReviews` below reads the SAME fixture-exclusion `/reviews` itself
 * applies (`excludeFixtureReviews`), so the nav never advertises a room this task already knows
 * is empty.
 */
const REVIEWS_NAV_LINK: NavLink = { href: "/reviews", label: "Reviews" };

/**
 * The signed-out landing page, rebuilt to the FRONT DOOR BLUEPRINT (2026-09-02,
 * `docs/superpowers/specs/2026-09-02-front-door-design.md` — the four mocks in
 * `.superpowers/mocks/` and canvas.json's laws). TWO DOORS, ONE PAGE: the lobby shelf IS the
 * landing (find-a-seat leads), and bring-your-crew is never hidden — its own band directly
 * under the shelf, outline verb.
 *
 * WHAT THE REBUILD KEPT, finding by finding: the conditional Reviews nav (D3); the quiet/loud
 * nav-pill arithmetic (E2 — loud only while nothing genuinely fills, because the featured ROW
 * carries the page's one solid verb otherwise); the hero band's ground (Task 7/Task 2); the one
 * real shelf, capped (D3 — `/browse` stays the full lobby); the cached `proofStats` read (P4
 * CARRY) with its floors (law 7); the one-`now` discipline; full-width bands (E2); the wire's
 * request-time truth (D4).
 *
 * WHAT IT SUPERSEDED, and where each duty went (the spec's own table, condensed):
 * 1. The hero's verb row — the featured row is the featured room's one loud rendering now
 *    (ending the 2026-08-25 hero-module ruling's chain); the practice invitation lives in the
 *    trust cards.
 * 2. `FrontDoorLowerThird` — deleted. Its subject cell was the featured row said twice; its
 *    earned numbers render as `TrustFacts`' quiet proof line, same floors, same null-is-absent.
 * 3. The Gameday "Start your own league" closing band — the CREW BAND under the shelf is that
 *    door now, where a commissioner scanning the shelf actually is; `/app#create-league`
 *    survives as the signed-out create verb's sign-in intent.
 * 4. The wire moves from under-nav to the page's foot — the blueprint's "lobby pulse" position;
 *    what it renders is unchanged.
 * 5. The "See every open league" pill joins the sorting-sentence row on the shelf's own foot
 *    line, beside the honest count of what the cap held back.
 */
export default async function Home() {
  const nowIso = new Date().toISOString();
  const clock = { now: () => nowIso };

  const [user, { leagues, house }, stats, wireItems, reviewsPage] = await Promise.all([
    getCurrentUser(),
    listPublicLeagues(getDb(), normalizeBrowseFilter({}), clock, { sort: "seats_remaining", whenFullOnly: false }),
    getProofCache().stats(() => proofStats(getDb())),
    listWireItems(getDb(), clock),
    listReviews(getDb(), {}),
  ]);

  // The SAME capped, merged list the shelf renders (house whole, member leagues capped at
  // `shelfCap`) — no second query, no second cap. `featuredFillingLeague` decides ONLY whether
  // the nav pill may stay loud: the shelf itself computes its own featured row from the same
  // function over the same list, so the two can never point at different rooms.
  const cappedLeagues = leagues.slice(0, UI_CONFIG.frontDoor.shelfCap);
  const shelf = [...house, ...cappedLeagues];
  const featuredLeague = featuredFillingLeague(shelf);
  const moreRooms = Math.max(0, leagues.length - cappedLeagues.length);
  // THE PEOPLE ALREADY INSIDE (Sideline, 2026-09-10): summed over the SAME list the shelf
  // renders, so the hero's figure and the board under it can never disagree — and deduped the
  // way the shelf dedupes, since a league open on both reads would otherwise be counted twice.
  const inside = shelf
    .filter((league, index, all) => all.findIndex((other) => other.id === league.id) === index)
    .reduce(
      (total, league) => ({ seatsTaken: total.seatsTaken + league.filledTeams, openRooms: total.openRooms + 1 }),
      { seatsTaken: 0, openRooms: 0 },
    );

  // The create sheet's defaults ARE the service's (`LEAGUE_CONFIG.defaults`), threaded from the
  // one place a server render may read them — the client boundary bans the import below deck.
  const createDefaults = {
    teamCount: LEAGUE_CONFIG.defaults.teamCount,
    scoringPreset: LEAGUE_CONFIG.defaults.scoringPreset,
    draftDaysFromCreation: LEAGUE_CONFIG.defaults.draftDaysFromCreation,
  };

  const hasRealReviews = excludeFixtureReviews(reviewsPage.reviews).length > 0;
  const nav: readonly NavLink[] = hasRealReviews ? [...STOREFRONT_NAV, REVIEWS_NAV_LINK] : STOREFRONT_NAV;

  return (
    <>
      <PublicBar
        intent={PAGE_INTENT}
        signedIn={user !== null}
        nav={nav}
        action={
          // E2, unchanged in spirit: the rail's persistent doorway. LOUD only while nothing on
          // the shelf genuinely fills — the moment a room does, its own row wears the page's one
          // solid amber and this pill steps back to quiet.
          <ButtonLink href="/browse" variant={featuredLeague === null ? "verb" : "secondary"}>
            Take a seat
          </ButtonLink>
        }
      />
      <main className="flex flex-col gap-8 bg-surface">
        {/* SIDELINE ruling (2026-09-11): the hero sits on the page's own ground (Chalk/Graphite,
            `body`'s `--commish-color-surface`) — no wash, no yard lines, no decorative
            background of any kind. The headline, the paragraph and the "who is already inside"
            card carry the band; energy on this surface comes only from a live event, and there
            is none here. Retires the floodlight/yard-lines ground from the retired
            timing-tower direction (Task 7, superseded). */}
        <section className="w-full px-4 py-10 sm:px-10 sm:py-12">
          <FrontDoorHero inside={inside} />
        </section>

        <section className="flex w-full flex-col gap-3 border-t border-line px-4 pt-8 sm:px-10">
          <OpenLeagueShelf
            house={house}
            leagues={cappedLeagues}
            signedIn={user !== null}
            asOfIso={nowIso}
          />
          {/* The sorting sentence and the one quiet way out of the capped teaser (D3), on the
              shelf's own foot line. The count is the honest remainder the cap held back. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-muted">
              {`Sorted by soonest draft you can still join${moreRooms > 0 ? ` · ${moreRooms} more ${moreRooms === 1 ? "room" : "rooms"} in the full lobby` : ""}`}
            </p>
            <ButtonLink href="/browse" variant="secondary">
              See every open league
            </ButtonLink>
          </div>
        </section>

        {/* THE SECOND DOOR (law 1): bring-your-crew, never hidden — its own band under the
            shelf, outline verb, opening the create sheet. */}
        <div className="w-full px-4 sm:px-10">
          <CrewDoor signedIn={user !== null} defaults={createDefaults} />
        </div>

        {/* TRUST IS FACTS (law 4): the three fact cards and the earned proof line. */}
        <section className="w-full px-4 pb-8 sm:px-10">
          <TrustFacts stats={stats} signedIn={user !== null} />
        </section>

        {/* THE WIRE, the lobby's pulse, at the page's foot per the blueprint — real events or
            nothing at all (`UI_CONFIG.wire.minItems`), request-time truth (D4), unchanged. */}
        <Wire items={wireItems} />
      </main>
      <PublicFooter />
    </>
  );
}
