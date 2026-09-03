import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { drafts, leagues, mockRooms, scoringSettings, teams } from "@/db/schema";
import type { Position, Player } from "@/domain/player";
import type { RosterShapeName } from "@/domain/roster";
import { SCORING_PRESETS, type ScoringPresetName } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { draftStateView } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { rankedPlayers } from "@/draft-service/pool";
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
import { ROSTER_SHAPES } from "@/league/roster-shape";
import { MOCK_CONFIG, type MockMode } from "@/mock-draft/config";

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
  };
}

/** `MockHabitFacts` (`@/draft-room/state/debrief`) off a summary — the habits card's own input. */
export function habitFactsOf(summary: MockDebriefSummary): MockHabitFacts {
  return { firstTeRound: summary.firstTeRound, earlyBestAvailable: summary.earlyBestAvailable };
}

/** The two loads a summary needs, injectable so tests never stand up the process-wide store. */
export interface MockDebriefDeps {
  readonly loadView: (draftId: string) => Promise<DraftStateView | null>;
  readonly loadPlayers: (leagueId: string) => Promise<readonly Player[]>;
}

export function mockDebriefDeps(db: Db): MockDebriefDeps {
  return {
    loadView: async (draftId) => {
      const state = await getDraftStore().getDraftState(draftId);
      return state === null ? null : draftStateView(state);
    },
    loadPlayers: (leagueId) => rankedPlayers(db, leagueId),
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
  const rooms = await completedMockRoomsQuery(db, userId);
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
