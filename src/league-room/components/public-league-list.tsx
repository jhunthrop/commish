import Link from "next/link";
import { EmptyState, InfoTip } from "@/components/ui";
import type { HelpLevel } from "@/identity/preferences";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { OpenLeagueCard } from "./open-league-card";

/**
 * The one new sentence Task 14 (Phase 3.5 addendum) prints, said once beneath the whole shelf
 * rather than repeated on every card — the factory's user-visible contract, allowed to be printed
 * only because Task 13's reconciler makes it true by construction (`ensureHouseCatalog`,
 * `@/league-service/house-factory.ts`).
 */
export const HOUSE_SHELF_PROMISE = "A new league opens as soon as one fills, so there is always a seat.";

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
 * The house shelf (Phase 3.5 addendum, Task 14, Step 3): §4.1's hybrid lobby, the factory made
 * VISIBLE. Every card here shares `HOUSE_CATALOG`'s own canon (`house-catalog.ts`'s own
 * docblock) — same format, same scoring, same roster shape — so `OpenLeagueCard` renders WHICH
 * rung and WHEN it drafts identically to every other card on the shelf; there is no second,
 * house-only card shape to keep in step with the member list's own (Phase 3.6, Task 5).
 *
 * Renders `null` when the shelf is empty (the reconciler has not run yet, or every rung is
 * mid-restock) — never an apology: `listPublicLeagues`'s own "never a dead end" property
 * (`browse.test.ts`) is what keeps the member list rendering underneath regardless, and an empty
 * shelf saying so would be a second, redundant dead end this page does not need.
 */
export function HouseLeagueShelf({
  leagues,
  signedIn,
  helpLevel,
}: {
  readonly leagues: readonly PublicLeagueSummary[];
  readonly signedIn: boolean;
  /** D1/E7: the caller's decision, never a constant here — public pages pass `"standard"` (the
   *  definitions stay one click away, beneath Task 6's one legend line) and a signed-in page
   *  passes the member's own stored preference (`readPreferences`), so a guided-preference
   *  member keeps inline captions. */
  readonly helpLevel: HelpLevel;
}) {
  if (leagues.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* NEW-3 (gauntlet fix wave, "reported, not fixed"): the same guided-`InfoTip` layout break
          `open-league-card.tsx`'s eyebrow row had — a `guided` caller's caption (`info-tip.tsx`'s
          own `inline-flex flex-col`, up to 280px wide) renders inline whenever `helpLevel` says
          so. `items-center` on a plain `inline-flex` row centers
          the single-line heading text against that much taller column, and with no `flex-wrap`
          the row cannot drop the caption to its own line at a narrow width — it just overflows
          sideways instead. `flex` (not `inline-flex`, so the row claims the block's own width
          rather than shrink-wrapping to content) plus `flex-wrap` (so the caption can fall to its
          own line when it does not fit beside the heading) plus `items-start` (so the heading
          text sits flush at the top of the row instead of floating mid-height against a tall
          sibling) is the same "give the guided element room instead of forcing it to share an
          ill-fitting line" fix `OpenLeagueCard` applied, adapted to a single heading rather than
          a list of terms. */}
      <h2 className="flex flex-wrap items-start gap-x-1 gap-y-1 font-display text-lg font-semibold leading-display text-text-primary">
        Commish house leagues
        <InfoTip term="house-league" helpLevel={helpLevel} />
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {leagues.map((league) => (
          <li key={league.id} className="min-w-0">
            <OpenLeagueCard league={league} signedIn={signedIn} helpLevel={helpLevel} />
          </li>
        ))}
      </ul>
      <p className="text-sm text-text-muted">{HOUSE_SHELF_PROMISE}</p>
    </div>
  );
}

/**
 * The matching open leagues. Not a client component: it renders server-shaped data, and the one
 * interactive part is a child (`OpenLeagueCard`'s `JoinPublicLeagueButton`) that owns its own
 * state.
 *
 * Every card is `OpenLeagueCard` (Phase 3.6, Task 5) — this list no longer hand-rolls its own
 * copy of the card `HouseLeagueShelf` (above) also renders; the two shared a near-identical JSX
 * block before this task, which is exactly the duplication `OpenLeagueCard`'s own extraction
 * exists to end.
 */
export function PublicLeagueList({
  leagues,
  signedIn,
  helpLevel,
}: {
  readonly leagues: readonly PublicLeagueSummary[];
  readonly signedIn: boolean;
  /** See `HouseLeagueShelf`'s identical prop — the caller's decision, never a constant (D1/E7). */
  readonly helpLevel: HelpLevel;
}) {
  if (leagues.length === 0) {
    return (
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
    );
  }

  return (
    // Phase 3.5 addendum, Task 15: `data-testid`, not a role/name query, is what an e2e spec
    // scopes its OWN "click the first Join button" to — the house shelf (`HouseLeagueShelf`,
    // above) renders its own "Join {name}" buttons with the identical accessible-name shape,
    // ABOVE this list on `/browse`.
    <div className="flex flex-col gap-3" data-testid="public-league-list">
      {/* `min-w-0`: see `HomeBoard`'s identical grid — a grid item's default `min-width: auto`
          otherwise lets a long league name widen the item past its column at 360px. */}
      <ul className="grid gap-3 sm:grid-cols-2">
        {leagues.map((league) => (
          <li key={league.id} className="min-w-0">
            <OpenLeagueCard league={league} signedIn={signedIn} helpLevel={helpLevel} />
          </li>
        ))}
      </ul>
      <p className="text-sm text-text-muted">{MATCHMAKING_CONFIG.stakeDisclosure}</p>
    </div>
  );
}
