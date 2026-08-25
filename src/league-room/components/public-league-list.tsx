import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, InfoTip } from "@/components/ui";
import type { HelpLevel } from "@/identity/preferences";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { OpenLeagueCard } from "./open-league-card";

/**
 * The factory's user-visible contract (Phase 3.5 addendum, Task 14), said once in the shelf
 * head's explainer row rather than repeated on every card — allowed to be printed only because
 * Task 13's reconciler makes it true by construction (`ensureHouseCatalog`,
 * `@/league-service/house-factory.ts`).
 */
export const HOUSE_SHELF_PROMISE = "A new league opens as soon as one fills, so there is always a seat.";

/**
 * E3/F2 (Phase 3.7, Task 6): the house explainer, a plain FULL-ROW muted sentence under the one
 * merged shelf head — the old "Commish house leagues" floating caption (a second `h2` fighting
 * the band's own) is dead. Written WITHOUT pointing at a badge on purpose: a factory-named house
 * league carries its rung in its TITLE by construction (`houseLeagueName`), so the card renders
 * no rung badge at all (`OpenLeagueCard`'s own E3 ruling) and a sentence like "leagues marked
 * with a rung" would describe a marker that is not there.
 */
export const HOUSE_SHELF_EXPLAINER = "Commish runs some of these leagues itself. Everyone joins the same way and plays the same rules.";

/**
 * D1's other half (Phase 3.7, Task 6): the one legend line above the grid, spelled with the real
 * `InfoTip` affordance language — the trigger IS a pressable ⓘ (`info-tip.tsx`'s `Icon
 * name="info"` button), and "press" is the verb that is true on every input this product
 * supports (360px touch included), where "hover" would not be.
 */
export const OPEN_LEAGUE_LEGEND = "New to these terms? Press any ⓘ for a plain answer.";

/**
 * The shelf header's own freshness disclosure (Phase 3.6, Task 5, F20 and the honest half of
 * deferral D4) — VERBATIM: "Seat counts as of {time}. A seat being claimed is counted." Takes
 * the time already formatted (`formatAbsoluteTime`, `@/league`) rather than an instant itself,
 * because the page rendering this (`src/app/page.tsx`, `src/app/browse/page.tsx`) is the one
 * place that owns a server clock and this component may not value-import `@/league` at all (the
 * client boundary, `eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`).
 *
 * The mock's "Live seat counts · updated just now" is REFUSED: there is no anonymous SSE fan-out
 * for signed-out visitors (deferral D4), "live" would be a claim about a mechanism this product
 * does not have, and "just now" is a claim that ages badly on a cached page. The second sentence
 * here — "A seat being claimed is counted" — is what makes the first one true: `heldSeats`
 * (Task 6) is folded into every count this page renders, so a seat mid-claim never reads as open.
 */
export function seatCountsAsOfSentence(asOfTime: string): string {
  return `Seat counts as of ${asOfTime}. A seat being claimed is counted.`;
}

/**
 * D2 (rule 5, one ink action per view): which card, if any, is the shelf's single featured one —
 * the nearest scheduled draft, else the fewest seats remaining. Pure and clock-free: an open
 * league's draft is still to come by `listPublicLeagues`'s own definition, so "nearest" is simply
 * the smallest instant, no `now` needed. A `when_full` league's `draftAtIso` is the same
 * placeholder its `draftAt` is (`PublicLeagueSummary.draftAtIso`'s own docblock), so only a
 * `scheduled` league with the instant actually on the wire enters the first pass — the identical
 * gate every other reader of `draftAt`/`draftAtIso` holds. Ties keep list order, so the answer is
 * deterministic for one rendered shelf.
 */
export function featuredLeagueId(leagues: readonly PublicLeagueSummary[]): string | null {
  if (leagues.length === 0) return null;
  const scheduled = leagues.filter((league) => league.startTrigger === "scheduled" && league.draftAtIso !== undefined);
  if (scheduled.length > 0) {
    // ISO-8601 UTC instants of one shape compare correctly as strings.
    return scheduled.reduce((nearest, league) => (league.draftAtIso! < nearest.draftAtIso! ? league : nearest)).id;
  }
  const seatsRemaining = (league: PublicLeagueSummary): number => league.teamCount - league.filledTeams;
  return leagues.reduce((tightest, league) => (seatsRemaining(league) < seatsRemaining(tightest) ? league : tightest)).id;
}

export interface OpenLeagueShelfProps {
  /** The factory's open house leagues, rendered FIRST in the one merged grid — §4.1's hybrid
   *  lobby kept as page order, without the second section head it used to cost. */
  readonly house: readonly PublicLeagueSummary[];
  /** The member-run open leagues — the caller caps this list where a cap is ruled
   *  (`UI_CONFIG.frontDoor.shelfCap` on the front door; `/browse` passes it whole). */
  readonly leagues: readonly PublicLeagueSummary[];
  readonly signedIn: boolean;
  /** D1/E7: the caller's decision, never a constant here — public pages pass `"standard"` (the
   *  definitions stay one click away, beneath the legend line) and a signed-in page passes the
   *  member's own stored preference (`readPreferences`). */
  readonly helpLevel: HelpLevel;
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
}

/**
 * THE open-league shelf (Phase 3.7, Task 6, from the founder-approved "Sunday Standard" mock):
 * one band, one head, one grid. The mock's `m-shelf-head` — title beside the quiet freshness
 * sub — with the house explainer as a full-row muted sentence beneath it (F2), the one legend
 * line above the grid (D1), and house cards and member cards flowing into ONE grid (E3: the
 * audit's "merge the two section headers into one"). House cards differentiate by TITLE — the
 * factory names them "Open 12-team League 3" — and member cards by their stake badge, so the
 * merged grid needs no section boundary to keep the two kinds apart.
 *
 * Exactly one card gets `emphasis="ink"` (D2, rule 5): `featuredLeagueId` above picks it across
 * the WHOLE merged grid, house and member alike, and every other card's action stays a quiet
 * pill.
 *
 * The title register is the mock's 22/650: `text-2xl` is 22px on the dense (desktop) scale, and
 * `font-semibold` is the repo's weight stop for the mock's 600-650 band — the same mapping the
 * ledger card's 16.5/600 → `text-lg font-semibold` already made (Task 5). Sentence case (rule 3).
 */
export function OpenLeagueShelf({
  house,
  leagues,
  signedIn,
  helpLevel,
  asOfTime,
  headingLevel = 2,
  intro,
  filters,
}: OpenLeagueShelfProps) {
  const merged: readonly PublicLeagueSummary[] = [...house, ...leagues];
  const featuredId = featuredLeagueId(merged);
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading className="min-w-0 [overflow-wrap:anywhere] font-display text-2xl font-semibold leading-display text-text-primary">
          Open leagues
        </Heading>
        <p className="text-sm text-text-muted">{seatCountsAsOfSentence(asOfTime)}</p>
      </div>

      {/* F2: a full-row muted paragraph, never a flex-wrapped caption fragment beside a heading.
          Rendered only while the factory actually has leagues on the shelf — an unreconciled
          database never prints a promise about cards that are not there. The `InfoTip` keeps the
          glossary definition one press away, exactly as the legend line below advertises. */}
      {house.length > 0 ? (
        <p className="max-w-prose text-sm text-text-muted">
          {HOUSE_SHELF_EXPLAINER} {HOUSE_SHELF_PROMISE} <InfoTip term="house-league" helpLevel={helpLevel} />
        </p>
      ) : null}

      {intro}
      {filters}

      {merged.length > 0 ? (
        <>
          <p className="text-sm text-text-muted">{OPEN_LEAGUE_LEGEND}</p>
          {/* `min-w-0`: see `HomeBoard`'s identical grid — a grid item's default
              `min-width: auto` otherwise lets a long league name widen the item past its column
              at 360px. E2: the wide tiers, so the full-width band actually uses its width. */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {house.map((league) => (
              <li key={league.id} className="min-w-0">
                <OpenLeagueCard league={league} signedIn={signedIn} helpLevel={helpLevel} emphasis={league.id === featuredId ? "ink" : "quiet"} />
              </li>
            ))}
            {/* `data-testid="member-league"`, per member card: what an e2e spec scopes its own
                "click the first Join button" to (`season.spec.ts`) — the house cards above share
                this ONE grid and render the identical "Join {name}" accessible-name shape, and a
                house league's tier can refuse the very manager the spec is driving. */}
            {leagues.map((league) => (
              <li key={league.id} className="min-w-0" data-testid="member-league">
                <OpenLeagueCard league={league} signedIn={signedIn} helpLevel={helpLevel} emphasis={league.id === featuredId ? "ink" : "quiet"} />
              </li>
            ))}
          </ul>
          <p className="text-sm text-text-muted">{MATCHMAKING_CONFIG.stakeDisclosure}</p>
        </>
      ) : null}

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
