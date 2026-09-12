import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { crossLeagueHome } from "@/league-service";
import { listPublicLeagues } from "@/league-service/browse";
import { getScoreCache } from "@/league-service/score-cache-instance";
import { normalizeBrowseFilter } from "@/matchmaking/filter";
import { CreateLeagueDoor } from "@/league-room/components/create-league-door";
import { HomeBoard } from "@/league-room/components/home-board";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>.
export const metadata: Metadata = pageTitle("Your leagues");

/**
 * The signed-in home answers what needs this manager right now, in every league they are in, as
 * one card per league ordered by what is owed (`HomeBoard`) with the lobby beneath it. A Server
 * Component reading through the service layer directly (idiomatic Next.js, explicitly outside the
 * client-boundary lint rule, which covers `src/league-room/**`), and `HomeBoard` renders this
 * exact same `HomeBody` shape when it refreshes from `/api/home`.
 *
 * THE FIRST-RUN FORK IS GONE (Sideline, 2026-09-11). A manager with zero leagues used to get a
 * three-path panel (`FirstRunPanel`) explaining create, join and browse, and a manager WITH
 * leagues got the same three paths again behind a disclosure (`StartOrJoinDisclosure`). Both are
 * deleted, and so is the `firstRunPlan` fork that chose between them: the lobby answers the
 * zero-league case better than an explainer ever did, because it is full of real rooms with real
 * seat counts and a real verb, and the create door now sits beside that lobby's heading where a
 * manager who wants to start one will look for it.
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
 * Renders no `TopBar` and no `<main>` of its own (Task 2 Step 5) — `(shell)/layout.tsx` is now
 * the thing that renders `AppShell`, which supplies both, once, for every page in this route
 * group. This page returns its content alone.
 */
export default async function AppHome() {
  const user = await requireCurrentUser();
  const db = getDb();
  const [home, openLeagues] = await Promise.all([
    crossLeagueHome(db, user.id, { scoreCache: getScoreCache() }),
    // The SAME `listPublicLeagues` read `/browse` and the front door already make, filtered down
    // to the house's own rooms (`.house`) rather than the whole member list, since "the house
    // always has a game" is the promise this lobby exists to keep visible.
    listPublicLeagues(db, normalizeBrowseFilter({})),
  ]);

  return (
    <>
      {/* THE CREATE DOOR IS ALWAYS REACHABLE (fix round 1, HIGH 2): beside the page's own
       *  heading, at every state, including the one where there are no leagues AND no open house
       *  rooms and `OpenRooms` renders nothing at all. It is the quiet door here and quiet again
       *  beside the lobby's heading, so it never competes with the page's one solid verb. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageTitle>Your leagues</PageTitle>
        <CreateLeagueDoor />
      </div>
      <HomeBoard initial={home} openLeagues={openLeagues.house} />
    </>
  );
}
