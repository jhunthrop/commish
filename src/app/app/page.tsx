import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { AppHeader } from "@/components/app-shell/app-header";
import { crossLeagueHome } from "@/league-service";
import { getScoreCache } from "@/league-service/score-cache-instance";
import { HomeBoard } from "@/league-room/components/home-board";
import { CreateLeaguePanel } from "@/league-room/components/create-league-panel";
import { JoinLeagueEntry } from "@/league-room/components/join-league-entry";

export const dynamic = "force-dynamic";

/**
 * The signed-in home answers what needs this manager right now, in every league they're in: a
 * record, this week's matchup, and one next action per card (`HomeBoard`) — not just a list of
 * names. A Server Component reading through the service layer directly (idiomatic Next.js,
 * explicitly outside the client-boundary lint rule, which covers `src/league-room/**`), and
 * `HomeBoard` renders this exact same `HomeBody` shape when it refreshes from `/api/home`.
 */
export default async function AppHome() {
  const user = await requireCurrentUser();
  const home = await crossLeagueHome(getDb(), user.id, { scoreCache: getScoreCache() });

  return (
    <>
      <AppHeader displayName={user.displayName} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <PageTitle>Your leagues</PageTitle>
        <HomeBoard initial={home} />
        <section aria-label="Join a league" className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-text-primary">Invited by a friend?</h2>
          <JoinLeagueEntry />
        </section>
        <section aria-label="Find a league" className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-text-primary">No group to play with yet?</h2>
          <p className="text-sm text-text-muted">Browse leagues that are still looking for managers.</p>
          <Link href="/browse" className="text-accent underline">
            Browse open leagues
          </Link>
        </section>
        <section id="create-league" className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-text-primary">Start a league</h2>
          <CreateLeaguePanel />
        </section>
      </main>
    </>
  );
}
