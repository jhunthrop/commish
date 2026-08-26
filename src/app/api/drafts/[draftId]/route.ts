import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { drafts, leagues, mockRooms, teams as teamsTable } from "@/db/schema";
import { fail, ok } from "@/lib/api/respond";
import { draftStateView, queueFor } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { leagueNameFor, listTeamCards } from "@/draft-service/teams";
import { describeStartTiming } from "@/matchmaking/roll";
import { expectedBotThinkDelaySeconds } from "@/mock-draft/bots";
import { MOCK_COPY } from "@/mock-draft/config";
import type { DraftSnapshotBody, MockResultsCopy, MockRoomInfo, MockShareInfo, WaitingInfo } from "@/draft-room/contract";
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

/**
 * R2 (the draft-room design review, carried by Task 10): the scheduled room's waiting story —
 * only ever called while `phase === "scheduled"`. For a practice room the countdown target is
 * the fill window's own `mock_rooms.starts_at` and the sentence is `MOCK_COPY.waitingDetail`;
 * for a real league the sentence is quoted verbatim from `describeStartTiming` (the one
 * start-timing authority — never restated here) and the target is the draft's own `kickoff_at`,
 * but only for a `scheduled` trigger: a `when_full` room has no chosen time to count to, so its
 * only honest answer is the sentence. The `undefined` guards are the same "the row vanished
 * mid-request" defensiveness `mockShareInfoFor` already keeps: answer less, never invent.
 */
async function waitingInfoFor(db: Db, leagueId: string, draftId: string, isMock: boolean): Promise<WaitingInfo | null> {
  if (isMock) {
    const [room] = await db.select({ startsAt: mockRooms.startsAt }).from(mockRooms).where(eq(mockRooms.leagueId, leagueId));
    return { kickoffAt: room?.startsAt.toISOString() ?? null, detail: MOCK_COPY.waitingDetail };
  }
  const [row] = await db
    .select({ kickoffAt: drafts.kickoffAt, startTrigger: drafts.startTrigger, houseRung: leagues.houseRung })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(eq(drafts.id, draftId));
  if (row === undefined) return null;
  return {
    kickoffAt: row.startTrigger === "scheduled" ? row.kickoffAt.toISOString() : null,
    detail: describeStartTiming({ startTrigger: row.startTrigger, authority: row.houseRung === null ? "member" : "house" }),
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
            // Task 10, finding 1: the dock's honest practice ETA. A mock's clock schedule is
            // one room-paced tier (Task 4's `loadDraftConfig`), so the schedule's floor IS the
            // room's own pick clock. A room with exactly one human seat sims (sim-to-next-pick,
            // the founder's directive — the driver's `simToNextPick`, same seat arithmetic), so
            // its honest per-bot price is ZERO: `formatYourTurn` then answers "any moment",
            // which is what a simmed stretch actually feels like.
            expectedBotPickSeconds:
              teams.filter((team) => team.isBot !== true).length === 1
                ? 0
                : expectedBotThinkDelaySeconds(state.config.clockSchedule[state.config.clockSchedule.length - 1]!.pickSeconds),
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
      // R2: the waiting story is a scheduled-room fact only — null the moment the draft starts.
      waiting: view.phase === "scheduled" ? await waitingInfoFor(getDb(), actor.leagueId, actor.draftId, state.config.isMock === true) : null,
    };
    return ok(body);
  });
}
