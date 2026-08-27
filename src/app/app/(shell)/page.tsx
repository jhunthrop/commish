import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { readProfile } from "@/identity-service/profile";
import { firstRunPlan } from "@/identity";
import { PageTitle } from "@/components/ui";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { crossLeagueHome } from "@/league-service";
import { listPublicLeagues } from "@/league-service/browse";
import { getScoreCache } from "@/league-service/score-cache-instance";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import type { HomeBody } from "@/league-room/contract";
import { HomeBoard } from "@/league-room/components/home-board";
import { StartOrJoinDisclosure } from "@/league-room/components/start-or-join-disclosure";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>.
export const metadata: Metadata = pageTitle("Your leagues");

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
 *
 * Renders no `TopBar` and no `<main>` of its own (Task 2 Step 5) — `(shell)/layout.tsx` is now
 * the thing that renders `AppShell`, which supplies both, once, for every page in this route
 * group. This page returns its content alone.
 *
 * Takes NO arguments — no `searchParams`, no cookie read, nothing that could carry a visitor's
 * intent (Task 17, Step 3). That is the seat-hold arrival guard, made structural rather than a
 * branch this page would have to remember to take: a visitor who followed a public shelf card
 * into a hold never reaches here at all, because Task 16's `safeReturnTo` seals `/join/
 * [leagueId]/hold` into the sign-in state and the callback's own fallback (`returnPathname:
 * "/app"`, unchanged) never runs once that sealed value exists. If that machinery ever broke,
 * THIS is the page a first-run manager holding a seat would wrongly land on instead of the hold
 * page's race-winner or race-loser screen — so its own test (`page.test.tsx`) pins the zero-
 * argument signature that makes that impossible to reach for by reading a query string here.
 *
 * `profile` (Task 17, Step 2) is read ONLY when `firstRun !== null` — the identity card
 * (`FirstRunPanel`'s first section, `ProfileForm` itself, `variant="first-run"`) is the only
 * consumer, and a manager who already has a league costs this page nothing extra to render.
 */
export default async function AppHome() {
  const user = await requireCurrentUser();
  const db = getDb();
  const [leaguesHome, preferences, openLeagues] = await Promise.all([
    crossLeagueHome(db, user.id, { scoreCache: getScoreCache() }),
    readPreferences(db, user),
    // Task 10, Step 4: the house shelf on the home screen — the SAME `listPublicLeagues` read
    // `/browse` and the front door already make, filtered down to the house's own leagues
    // (`.house`) rather than the whole member list, since "the house always has a game" is the
    // promise this panel exists to keep visible.
    listPublicLeagues(db, normalizeBrowseFilter({})),
  ]);
  const firstRun = firstRunPlan({
    experienceTier: user.experienceTier,
    helpLevel: preferences.helpLevel,
    leagueCount: leaguesHome.leagues.length,
  });
  const home: HomeBody = { ...leaguesHome, firstRun };
  const profile = firstRun === null ? null : await readProfile(db, user.id);

  return (
    <>
      <PageTitle>Your leagues</PageTitle>
      <HomeBoard initial={home} openLeagues={openLeagues.house} helpLevel={preferences.helpLevel} profile={profile} />
      {firstRun === null ? <StartOrJoinDisclosure experienceTier={user.experienceTier} /> : null}
    </>
  );
}
