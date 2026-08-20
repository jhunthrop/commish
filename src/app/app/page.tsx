import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { firstRunPlan } from "@/identity";
import { PageTitle } from "@/components/ui";
import { AppHeader } from "@/components/app-shell/app-header";
import { crossLeagueHome } from "@/league-service";
import { getScoreCache } from "@/league-service/score-cache-instance";
import type { HomeBody } from "@/league-room/contract";
import { HomeBoard } from "@/league-room/components/home-board";
import { StartOrJoinDisclosure } from "@/league-room/components/start-or-join-disclosure";

export const dynamic = "force-dynamic";

/**
 * The signed-in home answers what needs this manager right now, in every league they're in: a
 * record, this week's matchup, and one next action per card (`HomeBoard`) — not just a list of
 * names. A Server Component reading through the service layer directly (idiomatic Next.js,
 * explicitly outside the client-boundary lint rule, which covers `src/league-room/**`), and
 * `HomeBoard` renders this exact same `HomeBody` shape when it refreshes from `/api/home`.
 *
 * `firstRun` (Task 5's fork, `firstRunPlan` in `@/identity`) is computed HERE, not inside
 * `crossLeagueHome`: it needs this manager's preferences, and the service's own signature is
 * deliberately just a db and a user id. `/api/home/route.ts` computes the exact same thing the
 * exact same way, so `HomeBoard`'s background refresh never disagrees with what this page
 * server-rendered.
 *
 * The old always-on wall of join/browse/create underneath the board — the same three sections
 * whether this manager had zero leagues or ten — is gone. `firstRun !== null` means `HomeBoard`
 * already rendered those three paths, ordered and explained, as `FirstRunPanel`; adding them
 * again here would just be the wall back under a different name. `firstRun === null` means this
 * manager already has a board full of leagues, so the same three paths collapse behind one
 * disclosure (`StartOrJoinDisclosure`) instead of standing at full weight on every visit.
 */
export default async function AppHome() {
  const user = await requireCurrentUser();
  const db = getDb();
  const [leaguesHome, preferences] = await Promise.all([
    crossLeagueHome(db, user.id, { scoreCache: getScoreCache() }),
    readPreferences(db, user),
  ]);
  const firstRun = firstRunPlan({
    experienceTier: user.experienceTier,
    helpLevel: preferences.helpLevel,
    leagueCount: leaguesHome.leagues.length,
  });
  const home: HomeBody = { ...leaguesHome, firstRun };

  return (
    <>
      <AppHeader displayName={user.displayName} avatar={user.avatarUrl} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <PageTitle>Your leagues</PageTitle>
        <HomeBoard initial={home} />
        {firstRun === null ? <StartOrJoinDisclosure experienceTier={user.experienceTier} /> : null}
      </main>
    </>
  );
}
