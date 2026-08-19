import Link from "next/link";
import { Badge, Card, EmptyState, EYEBROW } from "@/components/ui";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { stakeTierLabel } from "@/matchmaking/filter";
import { JoinPublicLeagueButton } from "./join-public-league-button";

const FORMAT_LABEL: Readonly<Record<string, string>> = { snake: "Snake", auction: "Auction" };
const TIER_LABEL: Readonly<Record<string, string>> = { beginner: "New to fantasy", experienced: "Played before" };

/**
 * The matching open leagues. Not a client component: it renders server-shaped data, and the one
 * interactive part is a child that owns its own state.
 *
 * Fill status is stated plainly ("3 of 12 joined") rather than drawn as a bar, because the
 * number is the decision a visitor is actually making and a bar makes them estimate it. Every
 * fact on a card comes from `PublicLeagueSummary` and nothing else — see that contract for what
 * a stranger is and is not told.
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
              <p className={EYEBROW}>
                {`${FORMAT_LABEL[league.format] ?? league.format} · ${TIER_LABEL[league.experienceTier] ?? league.experienceTier}`}
              </p>
              <p className="text-sm text-text-muted">{`${league.filledTeams} of ${league.teamCount} joined`}</p>
              <div className="mt-auto">
                {signedIn ? (
                  <JoinPublicLeagueButton leagueId={league.id} leagueName={league.name} />
                ) : (
                  <Link
                    href="/sign-in"
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
