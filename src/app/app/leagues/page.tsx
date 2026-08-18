import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { listLeaguesForUser } from "@/league-service";
import { LeagueList } from "@/league-room/components/league-list";
import { CreateLeaguePanel } from "@/league-room/components/create-league-panel";

export const dynamic = "force-dynamic";

/**
 * A Server Component: it reads through the service layer directly, which is idiomatic Next.js
 * and explicitly outside the client-boundary lint rule (that rule covers `src/league-room/**`,
 * which is browser code by construction). The only client piece is the create form.
 */
export default async function LeaguesPage() {
  const user = await requireCurrentUser();
  const leagues = await listLeaguesForUser(getDb(), user.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <PageTitle>Your leagues</PageTitle>
      <LeagueList leagues={leagues} />
      <section id="create-league" className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-text-primary">Start a league</h2>
        <CreateLeaguePanel />
      </section>
    </main>
  );
}
