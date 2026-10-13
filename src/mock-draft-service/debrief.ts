import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@research-ts/db/client";
import { drafts, leagues, mockRooms, scoringSettings, teams } from "@/db/schema";
import type { Position, Player } from "@research-ts/domain/player";
import type { RosterShapeName, RosterSlot, RosterSlotConfig } from "@research-ts/domain/roster";
import { SCORING_PRESETS, type ScoringPresetName } from "@research-ts/domain/scoring";
import type { Clock } from "@research-ts/domain/timing";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { draftStateView } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { gradeDraft, type GradeDraftInput, type TeamGrade } from "@/draft-service/grades/engine";
import { gradeEvidenceMaps } from "@/draft-service/grades/evidence-maps";
import { rankedPlayers } from "@/draft-service/pool";
import { evidencePoolFor } from "@/draft-service/sim/evidence";
import type { SimPlayerEvidence } from "@/draft-service/sim/types";
import {
  debriefCounts,
  earlyRoundsBestAvailable,
  firstRoundByPosition,
  notableReviews,
  positionShape,
  type DebriefCounts,
  type JudgedReview,
  type MockHabitFacts,
} from "@/draft-room/state/debrief";
import { verdictFor, verdictPopulation } from "@/draft-room/lib/verdict";
import { reviewPicks } from "@/draft-room/state/pick-review";
import { LEAGUE_CONFIG } from "@/league";
import { ROSTER_SHAPES } from "@research-ts/domain/roster-shape";
import { byeWeeksByTeam } from "@research-ts/reference/nfl-schedule";
import { MOCK_CONFIG, type MockMode } from "@/mock-draft/config";
import type { LeagueShape } from "@research-ts/projections/decide/replacement";

/**
 * THE LEARNING COLUMN'S SERVER READ (the mock-drafts workflow pass, law 3): every completed,
 * unswept mock of the caller's, summarized from the SAME stored facts the debrief page derives
 * in the browser — the draft's own snapshotted pool order and its complete pick log, through
 * the SAME pure functions (`@/draft-room/state/debrief`). One derivation, two surfaces.
 *
 * Bounded twice: the retention sweep already clears a completed room after
 * `MOCK_CONFIG.retention.completedMs`, and `debriefHistoryLimit` caps the walk anyway — no scan
 * in this codebase is unbounded.
 */

const systemClock: Clock = { now: () => new Date().toISOString() };

/** A pick worth a named row on the learning column — the facts, never a re-judgment. */
export interface MockDebriefHighlight {
  readonly pickNumber: number;
  readonly playerName: string;
  readonly position: Position;
  /** Players ranked higher still available at the moment of the pick — 0 IS "best available". */
  readonly bestAvailableDelta: number;
}

export interface MockDebriefSummary {
  readonly draftId: string;
  readonly mode: MockMode;
  readonly teamCount: number;
  /** 1-based seat in the draft order; 0 when the caller's team was somehow not in it. */
  readonly seat: number;
  /** How long ago the room started, ms — coarse display is the client's job. */
  readonly startedAgoMs: number;
  readonly counts: DebriefCounts;
  /** The early-rounds lean: the position taken most through the shape window, or null. */
  readonly shapeLeader: { readonly position: Position; readonly count: number } | null;
  readonly firstTeRound: number | null;
  readonly earlyBestAvailable: boolean;
  readonly best: MockDebriefHighlight | null;
  readonly worstReach: MockDebriefHighlight | null;
  /**
   * Task 11 (plan ruling R-2): this seat's own grade, computed fresh at read time against
   * `gradeBoardGeneration`'s evidence board — a mock stores nothing, so this is never a stored
   * row the way a real draft's `draft_grades` table is. PRIVATE always (ruling 3, spec §15):
   * this is the ONLY grade `MockDebriefSummary` ever carries, for the requesting manager's own
   * team alone — no other seat's grade is computed or exposed here, even internally. Null when
   * there is no evidence board to grade against at all (`evidence` was null).
   */
  readonly yourGrade: TeamGrade | null;
  /** The evidence board's own `asOf` stamp `yourGrade` was computed against — null exactly when
   *  `yourGrade` is null, never independently. */
  readonly gradeBoardGeneration: string | null;
}

/**
 * The evidence board and the real schedule, read once and handed in rather than fetched inside
 * this pure module — the mirror of `draft-grades-job.ts`'s own DB-sourced assembly, but for a
 * mock, which stores no grade at all (ruling 3) and so must recompute one fresh every time its
 * debrief is read. Null when the evidence board itself has nothing (`evidencePoolFor` returned an
 * empty pool): `yourGrade` is null rather than a grade with invented numbers.
 */
export interface MockGradeEvidence {
  readonly pool: readonly SimPlayerEvidence[];
  readonly boardGeneration: string;
  readonly byeWeeks: ReadonlyMap<string, number>;
}

export interface MockYourGrade {
  readonly grade: TeamGrade;
  readonly boardGeneration: string;
}

/** Everything `gradeForMockSeat` needs beyond `evidence` — a `DraftStateView`'s own rosters,
 *  slot config, draft order and picks (whichever caller already has them in hand, real fetch or
 *  test fixture alike) plus the player list `nflTeamByPlayerId`/positions derive from. */
export interface GradeForMockSeatInput {
  readonly view: Pick<DraftStateView, "rosters" | "slotConfig" | "draftOrder" | "picks">;
  readonly players: readonly Player[];
  readonly myTeamId: string;
  readonly evidence: MockGradeEvidence | null;
}

/** `view.rosters` (a `Record<teamId, RosterSlot[]>`, filled and empty slots alike) narrowed to
 *  filled slots and joined to each player's position — the shape `GradeDraftInput.rosters` needs,
 *  built from data already in hand rather than a fresh DB read (Task 9's `rostersByTeam` reads
 *  the equivalent from `roster_slots`/`players` rows; a mock has no such rows to read). */
function gradeRostersFrom(
  rosters: Readonly<Record<string, readonly RosterSlot[]>>,
  positionOf: ReadonlyMap<string, Position>,
): ReadonlyMap<string, readonly { readonly playerId: string; readonly position: Position }[]> {
  const byTeam = new Map<string, { readonly playerId: string; readonly position: Position }[]>();
  for (const [teamId, slots] of Object.entries(rosters)) {
    const filled: { readonly playerId: string; readonly position: Position }[] = [];
    for (const slot of slots) {
      if (slot.playerId === null) continue;
      const position = positionOf.get(slot.playerId);
      if (position !== undefined) filled.push({ playerId: slot.playerId, position });
    }
    byTeam.set(teamId, filled);
  }
  return byTeam;
}

/**
 * `gradeDraft` for ONE seat of a mock, at read time (Task 11, plan ruling R-2) — the mock-specific
 * twin of `draft-grades-job.ts`'s DB-sourced assembly: same `GradeDraftInput` shape, same
 * `gradeEvidenceMaps` derivation for the two evidence maps, but every non-evidence field comes
 * from `input.view`/`input.players` (already in hand) rather than a fresh query, because a mock
 * never lands a `roster_slots`/`draft_grades` row to query in the first place.
 *
 * Null when `evidence` is null (no board to grade against) or `myTeamId` never rostered anything
 * this room recognizes (should not happen for a real seat, but never a fabricated grade either
 * way).
 */
export function gradeForMockSeat(input: GradeForMockSeatInput): MockYourGrade | null {
  if (input.evidence === null) return null;
  const positionOf = new Map(input.players.map((player) => [player.id, player.position]));
  const nflTeamByPlayerId = new Map(input.players.map((player) => [player.id, player.nflTeam]));
  const rosters = gradeRostersFrom(input.view.rosters, positionOf);
  const shape: LeagueShape = { teamCount: input.view.draftOrder.length, rosterSlots: input.view.slotConfig };
  const { pointsByPlayerId, valueByPlayerId } = gradeEvidenceMaps(input.evidence.pool, shape);
  const gradeInput: GradeDraftInput = {
    picks: input.view.picks,
    rosters,
    slotConfig: input.view.slotConfig,
    pointsByPlayerId,
    valueByPlayerId,
    byeWeeks: input.evidence.byeWeeks,
    nflTeamByPlayerId,
  };
  const grade = gradeDraft(gradeInput).find((entry) => entry.teamId === input.myTeamId);
  return grade === undefined ? null : { grade, boardGeneration: input.evidence.boardGeneration };
}

export interface SummarizeMockInput {
  readonly draftId: string;
  readonly mode: MockMode;
  readonly teamCount: number;
  readonly startedAgoMs: number;
  readonly myTeamId: string;
  readonly players: readonly Player[];
  readonly picks: readonly CompletedPick[];
  readonly draftOrder: readonly string[];
  /** The room's own committed rosters and slot shape — the caller (`completedMockDebriefs`)
   *  already has both off the same `DraftStateView` it reads `picks`/`draftOrder` from. */
  readonly rosters: Readonly<Record<string, readonly RosterSlot[]>>;
  readonly slotConfig: readonly RosterSlotConfig[];
  /** The evidence board and schedule, current at summarization time — see `MockGradeEvidence`. */
  readonly evidence: MockGradeEvidence | null;
}

function highlightOf(entry: JudgedReview | null, playersById: ReadonlyMap<string, Player>): MockDebriefHighlight | null {
  if (entry === null) return null;
  const player = playersById.get(entry.review.playerId);
  if (player === undefined) return null;
  return {
    pickNumber: entry.review.pickNumber,
    playerName: player.name,
    position: player.position,
    bestAvailableDelta: entry.review.bestAvailableDelta,
  };
}

/** Pure — the whole summary from a finished draft's own log and snapshot. */
export function summarizeCompletedMock(input: SummarizeMockInput): MockDebriefSummary {
  const playersById = new Map(input.players.map((player) => [player.id, player]));
  const positionOf = new Map(input.players.map((player) => [player.id, player.position]));
  const reviews = reviewPicks(input.players, input.picks, input.myTeamId);
  const population = verdictPopulation(input.players, input.picks);
  const judged: JudgedReview[] = [];
  for (const review of reviews) {
    const rank = population.boardRanks.get(review.playerId);
    if (rank !== undefined) judged.push({ review, verdict: verdictFor(population, rank, review.pickNumber) });
  }
  const notable = notableReviews(judged);
  const yourGrade = gradeForMockSeat({
    view: { rosters: input.rosters, slotConfig: input.slotConfig, draftOrder: input.draftOrder, picks: input.picks },
    players: input.players,
    myTeamId: input.myTeamId,
    evidence: input.evidence,
  });
  return {
    draftId: input.draftId,
    mode: input.mode,
    teamCount: input.teamCount,
    seat: input.draftOrder.indexOf(input.myTeamId) + 1,
    startedAgoMs: input.startedAgoMs,
    counts: debriefCounts(reviews),
    shapeLeader: positionShape(input.picks, positionOf, input.myTeamId).leader,
    firstTeRound: firstRoundByPosition(input.picks, positionOf, input.myTeamId).get("TE") ?? null,
    earlyBestAvailable: earlyRoundsBestAvailable(reviews, input.teamCount),
    best: highlightOf(notable.best, playersById),
    worstReach: highlightOf(notable.worstReach, playersById),
    yourGrade: yourGrade?.grade ?? null,
    gradeBoardGeneration: yourGrade?.boardGeneration ?? null,
  };
}

/** `MockHabitFacts` (`@/draft-room/state/debrief`) off a summary — the habits card's own input. */
export function habitFactsOf(summary: MockDebriefSummary): MockHabitFacts {
  return { firstTeRound: summary.firstTeRound, earlyBestAvailable: summary.earlyBestAvailable };
}

/** The three loads a summary needs, injectable so tests never stand up the process-wide store. */
export interface MockDebriefDeps {
  readonly loadView: (draftId: string) => Promise<DraftStateView | null>;
  readonly loadPlayers: (leagueId: string) => Promise<readonly Player[]>;
  /** The evidence board and real schedule read once — the SAME board grades every summarized
   *  room's `yourGrade` against, since none of them stored one of their own (ruling 3). */
  readonly loadGradeEvidence: () => Promise<MockGradeEvidence | null>;
}

/** `evidencePoolFor` + `byeWeeksByTeam`, bundled into `MockGradeEvidence` — null when the evidence
 *  board has nothing at all (`evidencePoolFor` returns an empty pool for a league nobody has
 *  projected yet), the "no board data" case every `yourGrade` degrades to null for. */
export async function loadMockGradeEvidence(db: Db): Promise<MockGradeEvidence | null> {
  const [{ pool, boardGeneration }, byeWeeks] = await Promise.all([evidencePoolFor(db), byeWeeksByTeam(db)]);
  return pool.length === 0 ? null : { pool, boardGeneration, byeWeeks };
}

export function mockDebriefDeps(db: Db): MockDebriefDeps {
  return {
    loadView: async (draftId) => {
      const state = await getDraftStore().getDraftState(draftId);
      return state === null ? null : draftStateView(state);
    },
    loadPlayers: (leagueId) => rankedPlayers(db, leagueId),
    loadGradeEvidence: () => loadMockGradeEvidence(db),
  };
}

const myTeams = alias(teams, "my_teams");

/**
 * The caller's completed, unswept mock rooms, newest first — the same two-alias membership
 * shape `myMockRoomsQuery` (`./lobby`) keeps, narrowed to `complete` and carrying the caller's
 * OWN team id (the debrief is about their picks, so the summary needs their seat).
 */
export function completedMockRoomsQuery(db: Db, userId: string) {
  return db
    .select({
      leagueId: mockRooms.leagueId,
      draftId: drafts.id,
      mode: mockRooms.mode,
      startsAt: mockRooms.startsAt,
      teamCount: leagues.teamCount,
      teamId: myTeams.id,
    })
    .from(mockRooms)
    .innerJoin(leagues, and(eq(leagues.id, mockRooms.leagueId), eq(leagues.isMock, true)))
    .innerJoin(drafts, eq(drafts.leagueId, mockRooms.leagueId))
    .innerJoin(myTeams, and(eq(myTeams.leagueId, mockRooms.leagueId), eq(myTeams.userId, userId)))
    .where(eq(drafts.status, "complete"))
    .orderBy(desc(mockRooms.startsAt))
    .limit(MOCK_CONFIG.debriefHistoryLimit);
}

/**
 * Newest first. A room whose stored state or pool cannot be loaded contributes NO summary
 * rather than a partial one — the same "degrade to nothing rather than a lie" posture every
 * verdict derivation upstream of this already takes.
 */
export async function completedMockDebriefs(
  db: Db,
  userId: string,
  deps: MockDebriefDeps = mockDebriefDeps(db),
  clock: Clock = systemClock,
): Promise<readonly MockDebriefSummary[]> {
  const nowMs = Date.parse(clock.now());
  const [rooms, evidence] = await Promise.all([completedMockRoomsQuery(db, userId), deps.loadGradeEvidence()]);
  const summaries: MockDebriefSummary[] = [];
  for (const room of rooms) {
    const [view, players] = await Promise.all([deps.loadView(room.draftId), deps.loadPlayers(room.leagueId)]);
    if (view === null || players.length === 0) continue;
    summaries.push(
      summarizeCompletedMock({
        draftId: room.draftId,
        mode: room.mode,
        teamCount: room.teamCount,
        startedAgoMs: Math.max(0, nowMs - room.startsAt.getTime()),
        myTeamId: room.teamId,
        players,
        picks: view.picks,
        draftOrder: view.draftOrder,
        rosters: view.rosters,
        slotConfig: view.slotConfig,
        evidence,
      }),
    );
  }
  return summaries;
}

/** The table a mock room was set with, spoken in `createMockRoomSchema`'s own vocabulary — what
 *  RUN IT BACK, SAME TABLE posts. */
export interface MockRoomTable {
  readonly teamCount: number;
  readonly pickSeconds: number;
  readonly scoringPreset: ScoringPresetName;
  readonly rosterShape: RosterShapeName;
}

function presetNameFor(row: Record<string, unknown>): ScoringPresetName {
  for (const [name, preset] of Object.entries(SCORING_PRESETS) as readonly [ScoringPresetName, Record<string, number>][]) {
    if (Object.entries(preset).every(([key, value]) => row[key] === value)) return name;
  }
  return LEAGUE_CONFIG.defaults.scoringPreset;
}

function shapeNameFor(slots: unknown): RosterShapeName {
  const spelled = JSON.stringify(slots);
  for (const [name, shape] of Object.entries(ROSTER_SHAPES) as readonly [RosterShapeName, unknown][]) {
    if (JSON.stringify(shape) === spelled) return name;
  }
  return LEAGUE_CONFIG.defaults.rosterShape;
}

/**
 * Re-derives a mock room's table from what is actually stored (no preset-name or shape-name
 * column exists — `writeLeagueInTx` stores only the resolved rows, `describeRosterShape`'s own
 * documented reality). A mock is always CREATED from these closed vocabularies, so the reverse
 * match is exact in practice; a row that somehow matches nothing falls back to the defaults
 * rather than refusing the rematch.
 */
export async function tableForMockRoom(db: Db, leagueId: string): Promise<MockRoomTable | null> {
  const [row] = await db
    .select({
      pickSeconds: mockRooms.pickSeconds,
      teamCount: leagues.teamCount,
      rosterSlots: leagues.rosterSlots,
    })
    .from(mockRooms)
    .innerJoin(leagues, and(eq(leagues.id, mockRooms.leagueId), eq(leagues.isMock, true)))
    .where(eq(mockRooms.leagueId, leagueId));
  if (row === undefined) return null;
  const [scoring] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  return {
    teamCount: row.teamCount,
    pickSeconds: row.pickSeconds,
    scoringPreset: scoring === undefined ? LEAGUE_CONFIG.defaults.scoringPreset : presetNameFor(scoring),
    rosterShape: shapeNameFor(row.rosterSlots),
  };
}
