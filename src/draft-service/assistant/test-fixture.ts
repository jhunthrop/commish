/**
 * A HEADLESS ROOM FOR THE ADVISOR'S OWN TESTS — a 10-team snake over `STANDARD_ROSTER_SLOTS`
 * with a synthetic, proportionally interleaved board, valued once through the real
 * `valueBoardIndexed`. The same construction the Draft HQ demo fixture uses, sized for a test:
 * every number a test asserts against is the real decision layer's output over this board.
 * Not a test file itself (no `.test.`), so several suites can share it.
 */
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS, type RosterSlot } from "@/domain/roster";
import { assignSlot, initialDraftState, teamOnClock, type CompletedPick, type DraftConfig, type DraftState } from "@/draft-engine";
import { valueBoardIndexed, type LeagueShape } from "@/projections/decide/replacement";
import { NEUTRAL_ARCHETYPE } from "../sim/seat-model";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { SIM_INSTANT, submit } from "../sim/run";
import type { ValuedEntry } from "./recommend";

export const FIXTURE_TEAM_IDS: readonly string[] = Array.from({ length: 10 }, (_, i) => `team_${i + 1}`);
export const FIXTURE_SHAPE: LeagueShape = { teamCount: FIXTURE_TEAM_IDS.length, rosterSlots: STANDARD_ROSTER_SLOTS };

const PEAK_POINTS: Readonly<Record<Position, number>> = { QB: 380, RB: 340, WR: 320, TE: 250, K: 150, DEF: 155 };
const DECAY_SCALE: Readonly<Record<Position, number>> = { QB: 10, RB: 16, WR: 18, TE: 8, K: 6, DEF: 6 };
const POSITION_PLAN: readonly (readonly [Position, number])[] = [["QB", 24], ["RB", 50], ["WR", 60], ["TE", 24], ["K", 12], ["DEF", 12]];

interface FixtureEntry extends DraftPoolEntry {
  readonly projectedPoints: number;
}

function buildPool(): readonly FixtureEntry[] {
  const buckets = POSITION_PLAN.map(([position, count]) =>
    Array.from({ length: count }, (_, i): FixtureEntry => ({
      playerId: `${position.toLowerCase()}${i + 1}`,
      position,
      projectedPoints: Math.round(PEAK_POINTS[position] * Math.exp(-i / DECAY_SCALE[position]) * 10) / 10,
    })),
  );
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
}

export const FIXTURE_POOL: readonly FixtureEntry[] = buildPool();

export function fixtureValued(): ReadonlyMap<string, ValuedEntry> {
  const { byPlayerId } = valueBoardIndexed(FIXTURE_POOL, FIXTURE_SHAPE);
  const byPoints = [...FIXTURE_POOL].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));
  const marketRank = new Map(byPoints.map((entry, index) => [entry.playerId, index + 1] as const));
  return new Map([...byPlayerId].map(([playerId, entry]) => [playerId, { ...entry, averageDraftPosition: marketRank.get(playerId)! }] as const));
}

export function fixtureStart(): DraftState {
  const config: DraftConfig = {
    draftId: "advisor_fixture",
    leagueId: "advisor_fixture_league",
    format: "snake",
    kickoffAt: SIM_INSTANT,
    auctionBudget: null,
    slotConfig: STANDARD_ROSTER_SLOTS,
    clockSchedule: [],
  };
  const start: StartDraftAction = {
    v: 1,
    type: "START_DRAFT",
    timestamp: SIM_INSTANT,
    draftOrder: FIXTURE_TEAM_IDS,
    pool: FIXTURE_POOL.map(({ playerId, position }) => ({ playerId, position })),
    minBid: 1,
  };
  return submit(initialDraftState(config), start);
}

/** Advances by `count` neutral bot picks, seeded, the same submission path every sim uses. */
export function fixtureAdvance(state: DraftState, count: number, seed = 11): DraftState {
  let s = state;
  for (let i = 0; i < count; i += 1) {
    const teamId = teamOnClock(s);
    if (teamId === null) return s;
    const playerId = chooseBotPick(s, teamId, NEUTRAL_ARCHETYPE, rngFor(seed, `${teamId}:fixture:${s.pickNumber}`));
    if (playerId === null) return s;
    const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
    s = submit(s, action);
  }
  return s;
}

/**
 * The fixture with `teamId` holding `playerIds`, placed through the engine's own slotting as if
 * they were its picks so far, every other seat untouched and the room's pick counter just past
 * them. For rosters no legal turn order reaches quickly (a bench already full).
 */
export function fixtureHolding(state: DraftState, teamId: string, playerIds: readonly string[]): DraftState {
  const positionOf = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  let roster: readonly RosterSlot[] = [];
  const picks: CompletedPick[] = [];
  for (const playerId of playerIds) {
    const position = positionOf.get(playerId);
    if (position === undefined) throw new Error(`fixture player ${playerId} is not in the pool`);
    const assigned = assignSlot({ position, roster, slotConfig: state.config.slotConfig });
    if (!assigned.ok) throw new Error(`fixture cannot roster ${playerId}: ${assigned.reason}`);
    roster = [...roster, { slot: assigned.slot, slotIndex: assigned.slotIndex, playerId }];
    picks.push({ pickNumber: picks.length + 1, round: 1, teamId, playerId, slot: assigned.slot, slotIndex: assigned.slotIndex, price: null, timestamp: SIM_INSTANT, auto: false });
  }
  return { ...state, picks, rosters: { ...state.rosters, [teamId]: roster }, pickNumber: picks.length + 1, sequence: picks.length + 1 };
}

export function fixtureNames(): Readonly<Record<string, string>> {
  return Object.fromEntries(FIXTURE_POOL.map((entry) => [entry.playerId, `${entry.position} ${entry.playerId.replace(/\D+/, "")}`]));
}
