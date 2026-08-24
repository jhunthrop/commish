import Link from "next/link";
import { Badge, Card, EmptyState, EYEBROW, InfoTip, SeatMeter } from "@/components/ui";
import { Icon, type IconName } from "@/components/ui/icon";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import type { DraftFormat } from "@/domain/league";
import type { TermKey } from "@/help/glossary";
import { EXPERIENCE_TIER_LABEL } from "@/identity/config";
import type { HelpLevel } from "@/identity/preferences";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { stakeTierLabel } from "@/matchmaking/filter";
import { HOUSE_RUNG_LABEL } from "@/matchmaking/house-catalog";
import { TIER_COMPOSITION_LABEL, type CompositionCategory } from "@/participation/composition";
import { JoinPublicLeagueButton } from "./join-public-league-button";

const FORMAT_LABEL: Readonly<Record<string, string>> = { snake: "Snake", auction: "Auction" };
const FORMAT_TERM: Readonly<Record<DraftFormat, TermKey>> = { snake: "snake-draft", auction: "auction-draft" };

/**
 * `/browse` is the app's one unauthenticated surface (`getCurrentUser()` returning null is the
 * expected case, not an error — see `app/browse/page.tsx`'s own docblock). There is no signed-in
 * caller's `helpLevel` to read on the common path, and a stranger deciding whether to join is
 * exactly who benefits most from more explanation, not less — so every `InfoTip` here opens
 * `guided`, unconditionally, rather than defaulting quiet the way an authenticated room does.
 */
const BROWSE_HELP_LEVEL: HelpLevel = "guided";

/**
 * `scoringLabel` is a derived string (`describeScoring`, `@/scoring`), not a `TermKey`. Every
 * label it can produce gets an `InfoTip` except "Standard" — that one is already plain English,
 * and a trigger on it would explain nothing. "Custom" reads as bare and slightly alarming
 * without one (does the league not have real scoring rules at all?), so it maps to
 * `custom-scoring`, same as the three shipped-preset labels map to their own term.
 */
const SCORING_LABEL_TERM: Readonly<Record<string, TermKey>> = {
  PPR: "ppr",
  "Half PPR": "half-ppr",
  "PPR, TE premium": "te-premium",
  Custom: "custom-scoring",
};

/**
 * `clover` for newcomer, `crown` for veteran — the same two glyphs `browse-filters.tsx`'s
 * participation control names in its own copy, matching what the tier means rather than
 * inventing a third glyph. `all_newcomers`/`mostly_newcomers` both read `clover` (the league
 * leans newcomer either way); `open` reads `crown` — the bucket that holds a tie, a veteran
 * majority AND an empty roster alike, per `compositionCategoryFor`'s own docblock
 * (`@/participation/composition`).
 */
const COMPOSITION_ICON: Readonly<Record<CompositionCategory, IconName>> = {
  all_newcomers: "clover",
  mostly_newcomers: "clover",
  open: "crown",
};

/**
 * The one new sentence Task 14 (Phase 3.5 addendum) prints, said once beneath the whole shelf
 * rather than repeated on every card — the factory's user-visible contract, allowed to be printed
 * only because Task 13's reconciler makes it true by construction (`ensureHouseCatalog`,
 * `@/league-service/house-factory.ts`).
 */
export const HOUSE_SHELF_PROMISE = "A new league opens as soon as one fills, so there is always a seat.";

/**
 * The house shelf (Phase 3.5 addendum, Task 14, Step 3): §4.1's hybrid lobby, the factory made
 * VISIBLE. Every card here shares `HOUSE_CATALOG`'s own canon (`house-catalog.ts`'s own
 * docblock) — same format, same scoring, same roster shape — so the one fact worth stating per
 * card is WHICH rung and WHEN it drafts, never a second copy of the format/scoring line
 * `PublicLeagueList`'s own member card already carries (every house card's answer to those would
 * be identical, which is not a fact worth printing twelve times).
 *
 * Renders `null` when the shelf is empty (the reconciler has not run yet, or every rung is
 * mid-restock) — never an apology: `listPublicLeagues`'s own "never a dead end" property
 * (`browse.test.ts`) is what keeps the member list rendering underneath regardless, and an empty
 * shelf saying so would be a second, redundant dead end this page does not need.
 *
 * NO PROGRESS BAR, on the identical reasoning `PublicLeagueList`'s own docblock states and the
 * parent plan's ruling 16 upheld: the fill count is the decision a visitor is actually making,
 * stated in words, not a bar that makes them estimate it.
 */
export function HouseLeagueShelf({
  leagues,
  signedIn,
}: {
  readonly leagues: readonly PublicLeagueSummary[];
  readonly signedIn: boolean;
}) {
  if (leagues.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="inline-flex items-center gap-1 font-display text-lg font-bold uppercase leading-display text-text-primary">
        Commish house leagues
        <InfoTip term="house-league" helpLevel={BROWSE_HELP_LEVEL} />
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {leagues.map((league) => (
          <li key={league.id} className="min-w-0">
            <Card as="article" className="flex h-full flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 break-words font-display text-2xl font-bold uppercase leading-display text-text-primary">
                  {league.name}
                </h3>
                {/* `league.houseRung` is never `null` here — `HouseLeagueShelf` only ever
                    receives `BrowseBody.house`, and `browse.test.ts`'s own first assertion is
                    what keeps every entry in it non-null. */}
                <Badge tone="accent">{league.houseRung === null ? "House" : HOUSE_RUNG_LABEL[league.houseRung]}</Badge>
              </div>
              <p className="flex items-center gap-1 text-sm text-text-muted">
                <Icon name="shield" size={16} />
                Run by Commish
              </p>
              {/* F17: the seat sentence is `SeatMeter`'s, everywhere, held seats included — the
                  shelf, the member list, the waiting room and the open-seats panel converge on
                  ONE phrasing rather than four. */}
              <SeatMeter filled={league.filledTeams} total={league.teamCount} heldSeats={league.heldSeats} />
              <p className="inline-flex items-center gap-1 text-sm text-text-muted">
                <Icon name="clock" size={16} />
                {/* The identical when-full/scheduled branch `PublicLeagueList`'s own draft-time
                    line uses — the sit-and-go rung's placeholder kickoff never renders as though
                    somebody chose it. */}
                {league.startTrigger === "when_full" ? "Starts as soon as it fills" : `Drafts ${league.draftAt}`}
              </p>
              <div className="mt-auto">
                {signedIn ? (
                  <JoinPublicLeagueButton leagueId={league.id} leagueName={league.name} />
                ) : (
                  // The highest-traffic entry into the funnel gets the intent that matters most
                  // (Task 16, F6): the HOLD interstitial for THIS league, not a generic `/app` —
                  // the parent's Task 6 seats a visitor who comes back still holding a live token.
                  <SignInLink
                    intent={`/join/${league.id}/hold`}
                    aria-label={`Sign in to join ${league.name}`}
                    className="inline-flex h-10 min-w-0 items-center justify-center [overflow-wrap:anywhere] rounded-md bg-accent px-4 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    Sign in to join
                  </SignInLink>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-sm text-text-muted">{HOUSE_SHELF_PROMISE}</p>
    </div>
  );
}

/**
 * The matching open leagues. Not a client component: it renders server-shaped data, and the one
 * interactive part is a child that owns its own state.
 *
 * Fill status is stated plainly (`SeatMeter`'s own "9 of 12 seated") rather than drawn as a bar,
 * because the number is the decision a visitor is actually making and a bar makes them estimate
 * it. Every fact on a card comes from `PublicLeagueSummary` and nothing else — see that contract
 * for what a stranger is and is not told, `heldSeats` (Phase 3.6, Task 6) included.
 */
export function PublicLeagueList({
  leagues,
  signedIn,
}: {
  readonly leagues: readonly PublicLeagueSummary[];
  readonly signedIn: boolean;
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
    // ABOVE this list on `/browse`, and now that the shelf is genuinely populated (Task 13's
    // reconciler, run for real by `npm run seed`'s own house arc), a bare `.first()` over the
    // WHOLE page can land on a house card instead of this list's own member league — found
    // running `e2e/season.spec.ts`'s "browse open leagues and join one" against a real shelf.
    <div className="flex flex-col gap-3" data-testid="public-league-list">
      {/* `min-w-0`: see `HomeBoard`'s identical grid — a grid item's default `min-width: auto`
          otherwise lets a long league name widen the item past its column at 360px. */}
      <ul className="grid gap-3 sm:grid-cols-2">
        {leagues.map((league) => {
          // Read, never derived (final review F6): `listPublicLeagues` reduces the two counts to
          // this bucket server-side, and the counts themselves never cross the public wire.
          const compositionCategory = league.compositionCategory;
          return (
            <li key={league.id} className="min-w-0">
              <Card as="article" className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  {/* `min-w-0 break-words`: see `HomeLeagueCard`'s identical heading. */}
                  <h3 className="min-w-0 break-words font-display text-2xl font-bold uppercase leading-display text-text-primary">
                    {league.name}
                  </h3>
                  <Badge tone="neutral">{stakeTierLabel(league.stakeTier)}</Badge>
                </div>
                <p className={`${EYEBROW} flex flex-wrap items-center gap-x-1 gap-y-1`}>
                  <span className="inline-flex items-center gap-1">
                    {FORMAT_LABEL[league.format] ?? league.format}
                    <InfoTip term={FORMAT_TERM[league.format]} helpLevel={BROWSE_HELP_LEVEL} />
                  </span>
                  <span>·</span>
                  <span>{EXPERIENCE_TIER_LABEL[league.experienceTier] ?? league.experienceTier}</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    {league.scoringLabel}
                    {SCORING_LABEL_TERM[league.scoringLabel] === undefined ? null : (
                      <InfoTip term={SCORING_LABEL_TERM[league.scoringLabel]!} helpLevel={BROWSE_HELP_LEVEL} />
                    )}
                  </span>
                  {/* Deciding a week is a fact about the league, not about anyone in it — the
                      same reasoning `PublicLeagueSummary.medianGame`'s own docblock carries.
                      A short noun, matching `FORMAT_LABEL`/`scoringLabel`'s own words, inline
                      with them rather than a separate line: high density, not a bolted-on box. */}
                  {league.medianGame ? (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        Median
                        <InfoTip term="median-game" helpLevel={BROWSE_HELP_LEVEL} />
                      </span>
                    </>
                  ) : null}
                </p>
                {/* F17: the seat sentence is `SeatMeter`'s, everywhere, held seats included. */}
                <SeatMeter filled={league.filledTeams} total={league.teamCount} heldSeats={league.heldSeats} />
                <p className="inline-flex items-center gap-1 text-sm text-text-muted">
                  <Icon name="clock" size={16} />
                  {/* Task 8 (Phase 3.5): a `when_full` league's stored kickoff is a placeholder
                      until the moment it is not (`PublicLeagueSummary.startTrigger`'s own
                      docblock) — this renders either the draft time or this sentence, never
                      both, and never that placeholder as though somebody chose it. */}
                  {league.startTrigger === "when_full" ? "Starts as soon as it fills" : `Drafts ${league.draftAt}`}
                </p>
                <p className="inline-flex items-center gap-1 text-sm text-text-muted">
                  <Icon name={COMPOSITION_ICON[compositionCategory]} size={16} />
                  {TIER_COMPOSITION_LABEL[compositionCategory]}
                </p>
                {league.experienceTier === "beginner" ? (
                  <p className="text-sm text-text-muted">
                    Reserved for players newer to Commish so everyone starts even. Played here
                    before?{" "}
                    <Link href="/browse?experienceTier=experienced" className="font-medium text-accent underline">
                      Browse leagues open to everyone
                    </Link>
                    .
                  </p>
                ) : null}
                <div className="mt-auto">
                  {signedIn ? (
                    <JoinPublicLeagueButton leagueId={league.id} leagueName={league.name} />
                  ) : (
                    // See `HouseLeagueShelf`'s identical card above for why this carries the
                    // HOLD interstitial as its intent, not the generic `/app` a bare
                    // `<Link href="/sign-in">` used to drop a visitor at (Task 16, F6).
                    <SignInLink
                      intent={`/join/${league.id}/hold`}
                      aria-label={`Sign in to join ${league.name}`}
                      className="inline-flex h-10 min-w-0 items-center justify-center [overflow-wrap:anywhere] rounded-md bg-accent px-4 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      Sign in to join
                    </SignInLink>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-text-muted">{MATCHMAKING_CONFIG.stakeDisclosure}</p>
    </div>
  );
}
