import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { drafts, leagues, mockRooms, teams as teamsTable } from "@/db/schema";
import type { Player } from "@/domain/player";
import { originFor } from "@/lib/api/origin";
import { fail, ok } from "@/lib/api/respond";
import { draftStateView, queueFor, type DraftStateView } from "@/draft-engine";
import { advanceDraftNow, getDraftStore } from "@/draft-service";
import { rankedPlayers } from "@/draft-service/pool";
import { leagueNameFor, listTeamCards } from "@/draft-service/teams";
import { describeStartTiming } from "@/matchmaking/roll";
import { expectedBotThinkDelaySeconds } from "@/mock-draft/bots";
import { MOCK_COPY } from "@/mock-draft/config";
import type { DraftSnapshotBody, MockResultsCopy, MockResultsInfo, MockResultsYourGrade, MockRoomInfo, MockShareInfo, WaitingInfo } from "@/draft-room/contract";
import { mockHabits } from "@/draft-room/state/debrief";
import { completedMockDebriefs, gradeForMockSeat, habitFactsOf, loadMockGradeEvidence, tableForMockRoom } from "@/mock-draft-service/debrief";
import { withLeagueMember, type RouteContext } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `ShareLinkPanel`'s own data (Task 8, Step 3) — present only for an unstarted `link`-mode
 * room. `null` for a real league, a started draft, or a solo/lobby mock, so a real league's
 * request never pays for the extra query below (this is only ever called once `isMock` and
 * `phase === "scheduled"` are already known true).
 */
async function mockShareInfoFor(db: Db, leagueId: string, origin: string): Promise<MockShareInfo | null> {
  const [room] = await db
    .select({ shareCode: mockRooms.shareCode, mode: mockRooms.mode, startsAt: mockRooms.startsAt, teamCount: leagues.teamCount })
    .from(mockRooms)
    .innerJoin(leagues, eq(leagues.id, mockRooms.leagueId))
    .where(eq(mockRooms.leagueId, leagueId));
  if (room === undefined || room.mode !== "link") return null;

  const seated = await db.select({ id: teamsTable.id }).from(teamsTable).where(eq(teamsTable.leagueId, leagueId));
  const path = `/app/mock-drafts/${room.shareCode}`;
  return {
    shareCode: room.shareCode,
    path,
    // The invite idiom in FULL now (link audit, 2026-09-04 — flow analysis C-01): the panel
    // shows `url`, because the value a person pastes into a text message has to open by itself;
    // `path` stays for callers that only ever navigate within the app.
    url: `${origin}${path}`,
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

/** The debrief's words (the workflow pass, law 4) — present only once the draft has finished. */
function mockResultsCopy(): MockResultsCopy {
  return {
    heading: MOCK_COPY.resultsHeading,
    retentionSentence: MOCK_COPY.resultsRetentionSentence,
    picksHeading: MOCK_COPY.resultsPicksHeading,
    noPicksMessage: MOCK_COPY.resultsNoPicksMessage,
    pickFact: {
      bestAvailable: MOCK_COPY.resultsPickBestAvailable,
      positionBestAvailable: MOCK_COPY.resultsPickPositionBestAvailable,
      rankedHigherAvailable: MOCK_COPY.resultsPickRankedHigherAvailable,
    },
    runBackVerb: MOCK_COPY.resultsRunBackVerb,
    openLobbyLabel: MOCK_COPY.resultsOpenLobbyLabel,
    statBestAvailableCaption: MOCK_COPY.resultsStatBestAvailableCaption,
    statReachCaption: MOCK_COPY.resultsStatReachCaption,
    statFirstTeCaption: MOCK_COPY.resultsStatFirstTeCaption,
    statNoTeCaption: MOCK_COPY.resultsStatNoTeCaption,
    roomAverageClause: MOCK_COPY.resultsRoomAverageClause,
    teamHeading: MOCK_COPY.resultsTeamHeading,
    shapeSentence: MOCK_COPY.resultsShapeSentence,
    byeStackSentence: MOCK_COPY.resultsByeStackSentence,
    takeItHeading: MOCK_COPY.resultsTakeItHeading,
    seedDetail: MOCK_COPY.resultsSeedDetail,
    seedVerb: MOCK_COPY.resultsSeedVerb,
    seededConfirmation: MOCK_COPY.resultsSeededConfirmation,
    trySeatVerb: MOCK_COPY.resultsTrySeatVerb,
    habitsHeading: MOCK_COPY.resultsHabitsHeading,
    habitsTeSentence: MOCK_COPY.resultsHabitsTeSentence,
    habitsEarlySentence: MOCK_COPY.resultsHabitsEarlySentence,
  };
}

/**
 * Task 11 (plan ruling R-2): this room's own grade for the requesting manager alone — computed
 * fresh against today's evidence board and schedule, since a mock stores nothing (ruling 3).
 * Null for a commissioner with no seat (`myTeamId` null) without paying for the evidence read at
 * all, and null again if the board itself has nothing to grade against.
 */
async function mockResultsYourGrade(db: Db, view: DraftStateView, players: readonly Player[], myTeamId: string | null): Promise<MockResultsYourGrade | null> {
  if (myTeamId === null) return null;
  const evidence = await loadMockGradeEvidence(db);
  return gradeForMockSeat({ view, players, myTeamId, evidence });
}

/**
 * The finished debrief's own extras (the workflow pass, law 4): the room's table for RUN IT
 * BACK, the caller's across-mocks habits, and (Task 11) the caller's own grade for THIS room —
 * server-computed from stored completed mocks through the SAME derivations the page renders
 * (`completedMockDebriefs`), gated to 2+ by `mockHabits` itself. A commissioner with no seat gets
 * no habits card and no grade: both are about the caller's own picks.
 */
async function mockResultsInfo(
  db: Db,
  leagueId: string,
  userId: string,
  hasSeat: boolean,
  view: DraftStateView,
  players: readonly Player[],
  myTeamId: string | null,
): Promise<MockResultsInfo> {
  const [table, summaries, yourGrade] = await Promise.all([
    tableForMockRoom(db, leagueId),
    hasSeat ? completedMockDebriefs(db, userId) : Promise.resolve([]),
    mockResultsYourGrade(db, view, players, myTeamId),
  ]);
  return {
    copy: mockResultsCopy(),
    table,
    habits: mockHabits(summaries.map(habitFactsOf)),
    yourGrade,
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
    // ADVANCE-ON-READ (driver 1, draft-driver design 2026-09-03): apply all due work — a
    // deferred start, due expiries, due bot picks — BEFORE loading state, so a reopened room
    // fast-forwards to the true present even when no long-lived ticker exists (Vercel).
    await advanceDraftNow(actor.draftId);
    const state = await getDraftStore().getDraftState(actor.draftId);
    if (state === null) return fail("That draft does not exist.", 404);

    const [teams, leagueName] = await Promise.all([listTeamCards(getDb(), actor.leagueId), leagueNameFor(getDb(), actor.leagueId)]);
    const view = draftStateView(state);
    // Task 11: the just-finished mock's own grade needs the same ranked player list the client
    // fetches separately from `/players` — loaded here too, but only for a completed mock room
    // the caller actually has a seat in, so a real league's completed draft (`results` stays
    // null for it) and a commissioner with no team never pay for this read.
    const resultsPlayers: readonly Player[] =
      state.config.isMock === true && view.phase === "complete" && actor.teamId !== null ? await rankedPlayers(getDb(), actor.leagueId) : [];
    const mock: MockRoomInfo | null =
      state.config.isMock !== true
        ? null
        : {
            practiceBanner: MOCK_COPY.practiceBanner,
            botMarkerLabel: MOCK_COPY.botMarkerLabel,
            botBadge: MOCK_COPY.botBadge,
            // Task 10, finding 1: the dock's honest practice ETA. A mock's clock schedule is
            // one room-paced tier (Task 4's `loadDraftConfig`), so the schedule's floor IS the
            // room's own pick clock, and every room paces the same way (founder report
            // 2026-09-08 retired the one-human zero-delay lane).
            expectedBotPickSeconds: expectedBotThinkDelaySeconds(state.config.clockSchedule[state.config.clockSchedule.length - 1]!.pickSeconds),
            share: view.phase === "scheduled" ? await mockShareInfoFor(getDb(), actor.leagueId, originFor(request)) : null,
            results:
              view.phase === "complete"
                ? await mockResultsInfo(getDb(), actor.leagueId, actor.userId, actor.teamId !== null, view, resultsPlayers, actor.teamId)
                : null,
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
