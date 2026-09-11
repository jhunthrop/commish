"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui";
import { ChapterBand } from "@/components/ui/chapter-band";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { rollBandConsequence } from "@/matchmaking/roll";
import { featuredFillingLeague, sortBySoonestJoinableDraft } from "@/matchmaking/shelf-order";
import { moneyIsLive } from "@/money/states";
import { JoinSheet } from "./join-sheet";
import { LeagueRow, LeagueRowsHeader } from "./league-row";
import { OpenLeagueCard } from "./open-league-card";

/**
 * The house sentence and the featured-league selectors MOVED to `@/matchmaking/shelf-order`
 * (front door blueprint, 2026-09-02): this module is a client component now (it owns the join
 * sheet's state), and the server pages (`src/app/page.tsx`, `/browse`) CALL those functions
 * during their own renders — a value imported from a "use client" module is a client reference
 * a server component cannot call. Re-exported here so every existing client/test importer keeps
 * its path; SERVER callers import from `@/matchmaking/shelf-order` directly.
 */
export { featuredFillingLeague, featuredLeagueId, HOUSE_SHELF_SENTENCE } from "@/matchmaking/shelf-order";

/**
 * The shelf header's own freshness disclosure (Phase 3.6, Task 5, F20 and the honest half of
 * deferral D4) — VERBATIM: "Seat counts as of {time}. A seat being claimed is counted." Takes
 * the time already formatted (`formatAbsoluteTime`, `@/league`) rather than an instant itself,
 * because the page rendering this is the one place that owns a server clock and this component
 * may not value-import `@/league` at all (the client boundary).
 *
 * The mock's "Live seat counts · updated just now" is REFUSED: there is no anonymous SSE
 * fan-out for signed-out visitors (deferral D4), and "just now" ages badly on a cached page.
 * "A seat being claimed is counted" is what makes the first sentence true: `heldSeats` is
 * folded into every count this page renders.
 */
export function seatCountsAsOfSentence(asOfTime: string): string {
  return `Seat counts as of ${asOfTime}. A seat being claimed is counted.`;
}

export interface OpenLeagueShelfProps {
  /** The factory's open house leagues, rendered FIRST in the one merged grid — §4.1's hybrid
   *  lobby kept as page order, without the second section head it used to cost. */
  readonly house: readonly PublicLeagueSummary[];
  /** The member-run open leagues — the caller caps this list where a cap is ruled
   *  (`UI_CONFIG.frontDoor.shelfCap` on the front door; `/browse` passes it whole). */
  readonly leagues: readonly PublicLeagueSummary[];
  readonly signedIn: boolean;
  /** The already-formatted render instant (`formatAbsoluteTime(nowIso)`), interpolated into
   *  `seatCountsAsOfSentence` — see that function's docblock for why the time arrives formatted. */
  readonly asOfTime: string;
  /** `/browse` passes 1 (this band's title IS that page's title); the front door keeps its hero
   *  `h1` and passes the default 2. */
  readonly headingLevel?: 1 | 2;
  /** `/browse`'s own lede (the commissioner-recruiting paragraph), rendered under the head —
   *  page copy stays the page's, the shelf just keeps it inside the one band. */
  readonly intro?: ReactNode;
  /** `/browse`'s `BrowseFilters` row. The front door renders none: it is the capped teaser (D3)
   *  and `/browse` is the full, filterable lobby. */
  readonly filters?: ReactNode;
  /**
   * A quiet control that belongs on the shelf's own head line — `/browse`'s practice invitation
   * today, and nothing else so far.
   *
   * IT IS A SLOT BECAUSE OF HEADING ORDER, not for flexibility. `/browse` used to render this
   * control as a SIBLING ABOVE the shelf, which put an interactive element ahead of the page's
   * only `<h1>` — a real heading-order defect the page audit gates on, and one no amount of care
   * inside this component could fix while the control lived outside it. Rendered here it is
   * structurally incapable of preceding the heading, whatever a future caller does.
   */
  readonly aside?: ReactNode;
  /**
   * 2026-08-25 founder finding, controller-ruled: true when the hero band's own "Next draft"
   * module (`NextDraftModule`) already renders this shelf's featured league — `page.tsx` derives
   * that league from the SAME `featuredFillingLeague` this component would otherwise call, so
   * passing `true` here (rather than recomputing and comparing) is the one place that decision
   * lives. Rule 5's one-ink-per-view budget means the shelf then marks NOTHING `emphasis="ink"`:
   * the module IS that league's featured rendering, and two inked renderings of the same league
   * would double the budget. Default `false` preserves every existing caller's own
   * one-ink-per-render behavior (`/browse` never renders the hero module, so it always computes
   * its own feature).
   */
  readonly featuredInHero?: boolean;
  /**
   * 2026-08-25, the absolutism sweep's carried finding: defaults to the real `moneyIsLive()` —
   * injectable so a test can exercise the live shelf disclosure without editing shipped state,
   * the identical `FrontDoorHero`/`SeatClaimSteps` idiom. No production caller, and no test
   * beyond the live-branch ones, ever passes anything but the default: `MONEY_STATES.enabled`
   * ships empty, so every real render reads `MATCHMAKING_CONFIG.stakeDisclosure`.
   */
  readonly live?: boolean;
}

/**
 * THE open-league shelf (Phase 3.7, Task 6; re-formed by Task 13): one band, one head, one
 * merged house-then-member list — rendered TWICE for the lg boundary. On lg+ viewports it is a
 * hairline-separated stack of horizontal `LeagueRow`s under one eyebrow column header
 * (FOUNDER-ORDERED, 2026-08-24: "horizontal row elements instead of these cards - my eyes don't
 * know where to focus"); below lg it stays the `OpenLeagueCard` grid, the form that fits 360px.
 * The mock's `m-shelf-head` — title beside the quiet freshness sub — keeps the collapsed house
 * sentence beneath it (`HOUSE_SHELF_SENTENCE`) and the one legend line (D1). House leagues carry
 * no rung badge at all (`stakeBadge` decides by authority, `houseRung === null`, never by
 * inspecting the title) and member leagues carry their stake badge always, so the merged list
 * needs no section boundary to keep the two kinds apart (E3).
 *
 * Exactly one league gets `emphasis="ink"` PER RENDERING (D2, rule 5): `featuredLeagueId` above
 * picks it once across the WHOLE merged list, house and member alike, and both its row and its
 * card carry the ink — only one of the two is ever on screen, so the view still shows exactly
 * one ink action.
 *
 * The title register is the mock's 22/650: `text-2xl` is 22px on the dense (desktop) scale, and
 * `font-semibold` is the repo's weight stop for the mock's 600-650 band — the same mapping the
 * ledger card's 16.5/600 → `text-lg font-semibold` already made (Task 5). Sentence case (rule 3).
 *
 * RULE 4'S AMENDED TEST, AND WHY THE lg+ ROWS STAY ROWS (the fun pass, Task 12). The amendment
 * (`docs/design/2026-08-27-fun-pass-spec.md`) reads "a thing you act on or compare against its
 * neighbours MAY be a card" — a permission, not an instruction, and the founder already spent it
 * the other way on this exact surface: "horizontal row elements instead of these cards - my eyes
 * don't know where to focus" (2026-08-24, live-page feedback, the ruling that created
 * `LeagueRow`). Turning these back into cards would relitigate a founder ruling on the strength
 * of a permission, and it would re-break the thing that ruling fixed. What the amendment DOES
 * buy this shelf is the card response below lg, where the card is the form that fits 360px:
 * `OpenLeagueCard` takes `interactive` now, which is the depth step `Card` has carried since
 * Task 2 and had never been spent on anything.
 */
export function OpenLeagueShelf({
  house,
  leagues,
  signedIn,
  asOfTime,
  headingLevel = 2,
  intro,
  filters,
  aside,
  featuredInHero = false,
  live = moneyIsLive(),
}: OpenLeagueShelfProps) {
  // DEDUPED BY ID (page-audit harness, 2026-08-27): a league that satisfies both reads — the
  // house shelf and the open-league list — was rendered TWICE, which showed up first as two ink
  // pills carrying the identical href (rule 5) and is a duplicate row either way. The house
  // entry wins, because it is the one carrying the rung's own framing.
  const merged: readonly PublicLeagueSummary[] = [...house, ...leagues].filter(
    (league, index, all) => all.findIndex((other) => other.id === league.id) === index,
  );
  // Blueprint law 2 (2026-09-02): ONLY the fullest GENUINELY-FILLING room gets the solid verb
  // and the leader wash — never `featuredLeagueId`'s tightest-seats fallback, which on a shelf
  // where nothing has a claim (or the fullest room has rolled, E4) put a solid on a row while
  // the page-level nav pill, deciding off `featuredFillingLeague`, stayed loud too: two solids,
  // one surface, seen live on the dev render. The shelf and the page now read the SAME selector.
  const featuredId = featuredInHero ? null : (featuredFillingLeague(merged)?.id ?? null);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  // Front door blueprint (2026-09-02): sorted by soonest draft you can still join —
  // `sortBySoonestJoinableDraft` (seats remaining, then a CHOSEN kickoff as the tiebreak; see
  // that module's own account of why proximity-to-full is the honest axis for both triggers).
  // The founder's Filling/Fresh chapters survive; the comparator orders within each, because a
  // claim is still the fact that starts a room's clock.
  const filling = sortBySoonestJoinableDraft(merged.filter((league) => league.filledTeams > 0));
  const fresh = sortBySoonestJoinableDraft(merged.filter((league) => league.filledTeams === 0));
  const houseIds = new Set(house.map((league) => league.id));
  // M3: the roll's consequence, said ONCE on the band that has rolled rooms in it, in the
  // league's voice — never the per-league scheduler sentence on every row. `null` when nothing
  // in the band rolled, and the band keeps its own consequence alone.
  const rolled = rollBandConsequence(filling.map((league) => league.kickoffRolls));
  const fillingConsequence =
    rolled === null ? "Claimed seats · first to fill is first to draft" : `Claimed seats · first to fill is first to draft · ${rolled}`;
  // The JOIN SHEET's one owner: tapping any row or card opens the whole contract for that
  // league. Stored as the ID and re-resolved so a re-render with fresher props never shows a
  // stale summary inside the sheet.
  const [openLeagueId, setOpenLeagueId] = useState<string | null>(null);
  const openLeague = openLeagueId === null ? null : (merged.find((league) => league.id === openLeagueId) ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <Heading className="min-w-0 [overflow-wrap:anywhere] font-display text-2xl font-semibold leading-display text-text-primary">
          Open leagues
        </Heading>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <p className="text-sm text-text-muted">{seatCountsAsOfSentence(asOfTime)}</p>
          {aside}
        </div>
      </div>

      {/* The explainer row is gone (founder ruling, 2026-08-28: "the UX should explain itself -
          we shouldn't need tips"). The legend line advertised the ⓘ affordance, which no longer
          exists on these rows; the house-factory sentence said what the hero's own headline and
          the board itself now demonstrate. `/browse` still carries the operator-transparency
          sentence through its `intro` slot, where scrutiny of the full lobby belongs. */}
      {intro}
      {filters}

      {merged.length > 0 ? (
        <>
          {/* THE BOARD, SIDELINE (2026-09-10): one paper surface on the chalk ground, rows as
              12px plates inside it, and the hairlines between them gone — a plate that lifts on
              hover is already a row boundary, and a rule under every plate read as a table. The
              ordering is still soonest-draft-first; what left with the position numeral (P1) is
              the leaderboard's shout, not its order. Two chapter bands, each carrying its
              consequence in words: rooms with claims are FILLING, untouched rooms wait below. */}
          <div data-testid="league-rows" className="hidden rounded-xl bg-surface-elevated p-2 shadow-card lg:block">
            <LeagueRowsHeader live={live} />
            {filling.length > 0 ? (
              <ChapterBand name="Filling" consequence={fillingConsequence} tone="live" />
            ) : null}
            <ul className="flex flex-col">
              {filling.map((league) => (
                <li key={league.id} data-testid={houseIds.has(league.id) ? undefined : "member-league"}>
                  <LeagueRow
                    league={league}
                    signedIn={signedIn}
                    // The amber wash rides the FEATURED row (blueprint law 2), not bare P1: a
                    // board whose fullest room has rolled, or holds no claims, washes nothing.
                    leader={league.id === featuredId}
                    emphasis={league.id === featuredId ? "ink" : "quiet"}
                    headingLevel={headingLevel === 1 ? 2 : 3}
                    live={live}
                    onOpen={() => setOpenLeagueId(league.id)}
                  />
                </li>
              ))}
            </ul>
            {fresh.length > 0 ? (
              <ChapterBand name="Fresh" consequence="No claims yet · yours would be the first seat" />
            ) : null}
            <ul className="flex flex-col">
              {fresh.map((league) => (
                <li key={league.id} data-testid={houseIds.has(league.id) ? undefined : "member-league"}>
                  {/* No `leader` here (fix round 1, L1): `featuredFillingLeague` requires
                      `filledTeams > 0` and this is the no-claims band, so the amber wash was
                      unreachable and the prop only read as though a fresh room might win it. */}
                  <LeagueRow
                    league={league}
                    signedIn={signedIn}
                    emphasis="quiet"
                    headingLevel={headingLevel === 1 ? 2 : 3}
                    live={live}
                    onOpen={() => setOpenLeagueId(league.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
          {/* Below lg the ledger card IS the form — a six-column row cannot fit 360px. `min-w-0`:
              see `HomeBoard`'s identical grid — a grid item's default `min-width: auto` otherwise
              lets a long league name widen the item past its column at 360px. The old lg:3/xl:4
              tiers (E2) moved out with the founder's rows ruling: this grid never renders at lg+. */}
          <ul data-testid="league-cards" className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {house.map((league) => (
              <li key={league.id} className="min-w-0">
                <OpenLeagueCard league={league} signedIn={signedIn} emphasis={league.id === featuredId ? "ink" : "quiet"} live={live} onOpen={() => setOpenLeagueId(league.id)} />
              </li>
            ))}
            {leagues.map((league) => (
              <li key={league.id} className="min-w-0" data-testid="member-league">
                <OpenLeagueCard league={league} signedIn={signedIn} emphasis={league.id === featuredId ? "ink" : "quiet"} live={live} onOpen={() => setOpenLeagueId(league.id)} />
              </li>
            ))}
          </ul>
          {/* 2026-08-25, the absolutism sweep's carried finding: this ONE sentence describes the
              WHOLE merged list, so it defers to the per-league Entry column rather than
              re-asserting "no money changes hands" once `moneyIsLive()` lets one listed league
              carry a real fee — see `MATCHMAKING_CONFIG.liveShelfStakeDisclosure`'s own
              docblock. */}
          <p className="text-sm text-text-muted">{live ? MATCHMAKING_CONFIG.liveShelfStakeDisclosure : MATCHMAKING_CONFIG.stakeDisclosure}</p>
        </>
      ) : null}

      {openLeague === null ? null : (
        <JoinSheet league={openLeague} signedIn={signedIn} live={live} onClose={() => setOpenLeagueId(null)} />
      )}

      {leagues.length === 0 ? (
        <EmptyState
          title="No open leagues match"
          description="Widen the filters, or start your own league and invite your group."
          icon="search"
          action={
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/browse" className="text-sm font-medium text-accent underline">
                Clear the filters
              </Link>
              {/* /app is auth-gated by middleware.ts, so a signed-out visitor lands at sign-in
                  first rather than an error, exactly like every other /app link on a public page. */}
              <Link href="/app#create-league" className="text-sm font-medium text-accent underline">
                Start your own league
              </Link>
            </div>
          }
        />
      ) : null}
    </div>
  );
}
