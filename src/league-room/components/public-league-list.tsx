import Link from "next/link";
import { Badge, Card, EmptyState, EYEBROW, InfoTip } from "@/components/ui";
import type { DraftFormat } from "@/domain/league";
import type { TermKey } from "@/help/glossary";
import { EXPERIENCE_TIER_LABEL } from "@/identity/config";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { stakeTierLabel } from "@/matchmaking/filter";
import { JoinPublicLeagueButton } from "./join-public-league-button";

const FORMAT_LABEL: Readonly<Record<string, string>> = { snake: "Snake", auction: "Auction" };
const FORMAT_TERM: Readonly<Record<DraftFormat, TermKey>> = { snake: "snake-draft", auction: "auction-draft" };

/**
 * `scoringLabel` is a derived string (`describeScoring`, `@/scoring`), not a `TermKey` — it can
 * read "Standard" or "Custom", neither of which is jargon the glossary defines. Only the three
 * labels that ARE jargon (PPR, Half PPR, PPR with a TE premium) get an `InfoTip`; the other two
 * are already plain English and adding a trigger to them would explain nothing.
 */
const SCORING_LABEL_TERM: Readonly<Record<string, TermKey>> = {
  PPR: "ppr",
  "Half PPR": "half-ppr",
  "PPR, TE premium": "te-premium",
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
      <ul className="grid gap-3 sm:grid-cols-2">
        {leagues.map((league) => (
          <li key={league.id}>
            <Card as="article" className="flex h-full flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-2xl font-bold uppercase leading-display text-text-primary">
                  {league.name}
                </h3>
                <Badge tone="neutral">{stakeTierLabel(league.stakeTier)}</Badge>
              </div>
              <p className={`${EYEBROW} flex flex-wrap items-center gap-x-1 gap-y-1`}>
                <span className="inline-flex items-center gap-1">
                  {FORMAT_LABEL[league.format] ?? league.format}
                  <InfoTip term={FORMAT_TERM[league.format]} />
                </span>
                <span>·</span>
                <span>{EXPERIENCE_TIER_LABEL[league.experienceTier] ?? league.experienceTier}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  {league.scoringLabel}
                  {SCORING_LABEL_TERM[league.scoringLabel] === undefined ? null : (
                    <InfoTip term={SCORING_LABEL_TERM[league.scoringLabel]!} />
                  )}
                </span>
              </p>
              <p className="text-sm text-text-muted">
                {`${league.filledTeams} of ${league.teamCount} joined`}
                {" · "}
                <span className="font-medium">{spotsLeftLabel(league)}</span>
              </p>
              <div className="mt-auto">
                {signedIn ? (
                  <JoinPublicLeagueButton leagueId={league.id} leagueName={league.name} />
                ) : (
                  <Link
                    href="/sign-in"
                    aria-label={`Sign in to join ${league.name}`}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    Sign in to join
                  </Link>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-sm text-text-muted">{MATCHMAKING_CONFIG.stakeDisclosure}</p>
    </div>
  );
}
