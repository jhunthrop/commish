import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { AppHeader } from "@/components/app-shell/app-header";
import { listLeaguesForUser } from "@/league-service";
import { LeagueList } from "@/league-room/components/league-list";
import { CreateLeaguePanel } from "@/league-room/components/create-league-panel";
import { JoinLeagueEntry } from "@/league-room/components/join-league-entry";

export const dynamic = "force-dynamic";

/**
 * The signed-in home IS the league list — there is no separate "welcome" page to click
 * through. A Server Component reading through the service layer directly (idiomatic Next.js,
 * explicitly outside the client-boundary lint rule, which covers `src/league-room/**`).
 */
export default async function AppHome() {
  const user = await requireCurrentUser();
  const leagues = await listLeaguesForUser(getDb(), user.id);

  return (
    <>
      <AppHeader displayName={user.displayName} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <PageTitle>Your leagues</PageTitle>
        <LeagueList leagues={leagues} />
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
