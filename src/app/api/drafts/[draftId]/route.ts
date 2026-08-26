import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { leagues, mockRooms, teams as teamsTable } from "@/db/schema";
import { fail, ok } from "@/lib/api/respond";
import { draftStateView, queueFor } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { leagueNameFor, listTeamCards } from "@/draft-service/teams";
import { MOCK_COPY } from "@/mock-draft/config";
import type { DraftSnapshotBody, MockResultsCopy, MockRoomInfo, MockShareInfo } from "@/draft-room/contract";
import { withLeagueMember, type RouteContext } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `ShareLinkPanel`'s own data (Task 8, Step 3) — present only for an unstarted `link`-mode
 * room. `null` for a real league, a started draft, or a solo/lobby mock, so a real league's
 * request never pays for the extra query below (this is only ever called once `isMock` and
 * `phase === "scheduled"` are already known true).
 */
async function mockShareInfoFor(db: Db, leagueId: string): Promise<MockShareInfo | null> {
  const [room] = await db
    .select({ shareCode: mockRooms.shareCode, mode: mockRooms.mode, startsAt: mockRooms.startsAt, teamCount: leagues.teamCount })
    .from(mockRooms)
    .innerJoin(leagues, eq(leagues.id, mockRooms.leagueId))
    .where(eq(mockRooms.leagueId, leagueId));
  if (room === undefined || room.mode !== "link") return null;

  const seated = await db.select({ id: teamsTable.id }).from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  return {
    shareCode: room.shareCode,
    // The invite-code idiom (`InviteBody.path`, `@/league-room/contract`): an absolute PATH,
    // not a full URL — the browser already knows its own origin.
    path: `/app/mock-drafts/${room.shareCode}`,
    teamCount: room.teamCount,
    seatsFilled: seated.length,
    startsAt: room.startsAt.toISOString(),
  };
}

/** `MockResults`' own copy (Task 8, Step 2) — present only once the draft has finished. */
function mockResultsCopy(): MockResultsCopy {
  return {
    heading: MOCK_COPY.resultsHeading,
    retentionSentence: MOCK_COPY.resultsRetentionSentence,
    runAgainLabel: MOCK_COPY.resultsRunAgainLabel,
    openLobbyLabel: MOCK_COPY.resultsOpenLobbyLabel,
    browseLeaguesLabel: MOCK_COPY.resultsBrowseLeaguesLabel,
  };
}

/**
 * The current materialized draft state plus the derived clock the UI renders.
 *
 * Ruling R-B5: restricted to league members (a team in this draft's league) and the
 * commissioner — a signed-in stranger from another league gets 403, not another league's
 * board.
 *
 * Task 8: `mock` carries every word `@/mock-draft`'s `MOCK_COPY` has to say about THIS room,
 * pre-rendered here — the one place server code is allowed to value-import it — so the room's
 * own client components never do. See `MockRoomInfo`'s own docblock (`@/draft-room/contract`)
 * for the full argument.
 */
export async function GET(request: Request, context: RouteContext) {
  return withLeagueMember(request, context, async (actor) => {
    const state = await getDraftStore().getDraftState(actor.draftId);
    if (state === null) return fail("That draft does not exist.", 404);

    const [teams, leagueName] = await Promise.all([listTeamCards(getDb(), actor.leagueId), leagueNameFor(getDb(), actor.leagueId)]);
    const view = draftStateView(state);
    const mock: MockRoomInfo | null =
      state.config.isMock !== true
        ? null
        : {
            practiceBanner: MOCK_COPY.practiceBanner,
            botMarkerLabel: MOCK_COPY.botMarkerLabel,
            botBadge: MOCK_COPY.botBadge,
            share: view.phase === "scheduled" ? await mockShareInfoFor(getDb(), actor.leagueId) : null,
            results: view.phase === "complete" ? mockResultsCopy() : null,
          };

    const body: DraftSnapshotBody = {
      draft: view,
      leagueName,
      teamId: actor.teamId,
      isCommissioner: actor.isCommissioner,
      teams,
      // Own queue only. `queueFor` returns [] for a commissioner with no team.
      queue: actor.teamId === null ? [] : queueFor(state, actor.teamId),
      mock,
    };
    return ok(body);
  });
}
