import Link from "next/link";
import { Badge, Card, EmptyState, EYEBROW, InfoTip } from "@/components/ui";
import { Icon, type IconName } from "@/components/ui/icon";
import type { DraftFormat } from "@/domain/league";
import type { TermKey } from "@/help/glossary";
import { EXPERIENCE_TIER_LABEL } from "@/identity/config";
import type { HelpLevel } from "@/identity/preferences";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { stakeTierLabel } from "@/matchmaking/filter";
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
 * "6 of 8 joined" answers "how full is it"; a visitor's actual decision is "is there room for
 * me", so the seat count gets its own clause. Singular "1 spot left" reads right for the one
 * case it applies to; a league with zero seats left never reaches this list at all (`browse`
 * only ever returns leagues `hasOpenSeat` accepts), so there is no "0 spots left" to word.
 */
function spotsLeftLabel(league: Pick<PublicLeagueSummary, "teamCount" | "filledTeams">): string {
  const spotsLeft = league.teamCount - league.filledTeams;
  return `${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left`;
}

/**
 * The matching open leagues. Not a client component: it renders server-shaped data, and the one
 * interactive part is a child that owns its own state.
 *
 * Fill status is stated plainly ("3 of 12 joined") rather than drawn as a bar, because the
 * number is the decision a visitor is actually making and a bar makes them estimate it — and
 * the seat count that follows it (`spotsLeftLabel`) answers that decision directly rather than
 * asking a visitor to do the subtraction themselves. Every fact on a card comes from
 * `PublicLeagueSummary` and nothing else — see that contract for what a stranger is and is not
 * told.
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
    <div className="flex flex-col gap-3">
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
                <p className="text-sm text-text-muted">
                  {`${league.filledTeams} of ${league.teamCount} joined`}
                  {" · "}
                  <span className="font-medium">{spotsLeftLabel(league)}</span>
                </p>
                <p className="inline-flex items-center gap-1 text-sm text-text-muted">
                  <Icon name="clock" size={16} />
                  {`Drafts ${league.draftAt}`}
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
                    <Link
                      href="/sign-in"
                      aria-label={`Sign in to join ${league.name}`}
                      className="inline-flex h-10 min-w-0 items-center justify-center [overflow-wrap:anywhere] rounded-md bg-accent px-4 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                    >
                      Sign in to join
                    </Link>
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
