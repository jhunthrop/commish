import { describe, expect, it } from "vitest";
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, teamOnClock, type DraftConfig, type DraftState } from "@/draft-engine";
import { BOT_ARCHETYPES } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { makeItBackOdds, MAKE_IT_BACK_RUNS } from "./make-it-back";
import { SIM_INSTANT, submit } from "./run";

const NEUTRAL = BOT_ARCHETYPES.find((a) => a.name === "best_available")!;

/** Advances a state by exactly `count` real picks under a neutral archetype — fixture setup
 *  only, the same submission path `continueDraft` itself uses (mirrors `continue.test.ts`). */
function advance(state: DraftState, seed: number, count: number): DraftState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const teamId = teamOnClock(s);
    if (teamId === null) return s;
    const rng = rngFor(seed, `${teamId}:fixture:${s.pickNumber}`);
    const playerId = chooseBotPick(s, teamId, NEUTRAL, rng);
    if (playerId === null) return s;
    const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
    s = submit(s, action);
  }
  return s;
}

// --- Fixture A: a live gap between the asking seat's current and next turn -------------------
//
// 4-team snake, draftOrder [t1,t2,t3,t4]: round 1 is picks 1-4 in that order, round 2 reverses to
// [t4,t3,t2,t1] (picks 5-8). t1 holds pick 1 AND pick 8 — a real 6-pick gap (picks 2-7, played by
// t2/t3/t4) between its current turn and its next one, unlike `continue.test.ts`'s deliberate
// zero-gap boundary fixture. That gap is exactly what a "make it back" question is about.
const TEAM_IDS = ["t1", "t2", "t3", "t4"];

const ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
  { slot: BENCH_SLOT, count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
]; // 3 slots/team x 4 teams = 12 total picks over 3 rounds.

// 24-player board, rank-interleaved across positions (same construction as continue.test.ts's
// BOARD). At most 7 real picks are ever played inside the fixture-A continuation window (the
// asking seat's own pick 1, plus picks 2-7) before it stops at pick 8, so a player ranked at
// board index 15 or deeper can NEVER enter the bot sampler's top-8 reach window
// (`MOCK_CONFIG.strategy.reachDepth`) no matter which 7 players are removed first — deterministic
// survival, not merely likely.
const BOARD: readonly DraftPoolEntry[] = (() => {
  const plan: readonly (readonly [Position, number])[] = [["RB", 8], ["WR", 8], ["QB", 4], ["TE", 4]];
  const buckets = plan.map(([position, count]) => Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${i + 1}`, position })));
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
})();

const CONFIG: DraftConfig = {
  draftId: "make-it-back-fixture",
  leagueId: "sim",
  format: "snake",
  kickoffAt: SIM_INSTANT,
  auctionBudget: null,
  slotConfig: ROSTER_SLOTS,
  clockSchedule: [],
};

const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: TEAM_IDS, pool: BOARD, minBid: 1 };

function freshState(): DraftState {
  return submit(initialDraftState(CONFIG), START);
}

// --- Fixture B: the asking seat's current pick is the draft's very last pick ------------------
//
// 4 teams, 1 slot each (BENCH only) => a single round, 4 total picks. t4 holds pick 4, the
// draft's final pick — no next turn can ever exist for it, so EVERY continuation must run out the
// draft (`draftEnded: true`) regardless of seed.
const TAIL_ROSTER_SLOTS: readonly RosterSlotConfig[] = [{ slot: BENCH_SLOT, count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] }];

const TAIL_BOARD: readonly DraftPoolEntry[] = (() => {
  const plan: readonly (readonly [Position, number])[] = [["RB", 4], ["WR", 4], ["QB", 2], ["TE", 2]];
  return plan.flatMap(([position, count]) => Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${i + 1}`, position })));
})();

const TAIL_CONFIG: DraftConfig = { ...CONFIG, draftId: "make-it-back-tail-fixture", slotConfig: TAIL_ROSTER_SLOTS };
const TAIL_START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: TEAM_IDS, pool: TAIL_BOARD, minBid: 1 };

function freshTailState(): DraftState {
  return submit(initialDraftState(TAIL_CONFIG), TAIL_START);
}

describe("makeItBackOdds", () => {
  it("gives a board-top shortlist player low survival and a deep-board one high survival", () => {
    const state = freshState();
    expect(teamOnClock(state)).toBe("t1");
    const topPlayerId = BOARD[0]!.playerId;
    const deepPlayerId = BOARD[BOARD.length - 1]!.playerId;

    const rows = makeItBackOdds({ state, askingTeamId: "t1", shortlistIds: [topPlayerId, deepPlayerId], seed: 11 });

    expect(rows.map((r) => r.playerId)).toEqual([topPlayerId, deepPlayerId]); // shortlistIds order preserved
    const [top, deep] = rows;
    expect(top!.survival).not.toBeNull();
    expect(deep!.survival).not.toBeNull();
    expect(top!.survival!).toBeGreaterThanOrEqual(0);
    expect(top!.survival!).toBeLessThanOrEqual(1);
    expect(deep!.survival!).toBeGreaterThanOrEqual(0);
    expect(deep!.survival!).toBeLessThanOrEqual(1);
    expect(top!.runs).toBe(MAKE_IT_BACK_RUNS); // no continuation in this fixture can ever end the draft early
    expect(deep!.runs).toBe(MAKE_IT_BACK_RUNS);

    // The deep player is structurally unreachable within the fixture's 7-pick continuation window
    // (see BOARD's comment) — deterministic, not merely likely.
    expect(deep!.survival).toBe(1);
    // The board-top player is the bot sampler's heaviest-weighted candidate at every one of the
    // six other seats' turns in between — it should come off the board far more often than not.
    expect(top!.survival!).toBeLessThan(0.5);
    expect(top!.survival!).toBeLessThan(deep!.survival!);
  });

  it("is reproducible: two identical calls are deep-equal", () => {
    const state = freshState();
    const input = { state, askingTeamId: "t1", shortlistIds: [BOARD[0]!.playerId, BOARD[BOARD.length - 1]!.playerId], seed: 11 } as const;
    const a = makeItBackOdds(input);
    const b = makeItBackOdds(input);
    expect(a).toEqual(b);
  });

  it("uses a custom runs count when provided", () => {
    const state = freshState();
    const rows = makeItBackOdds({ state, askingTeamId: "t1", shortlistIds: [BOARD[0]!.playerId], seed: 5, runs: 20 });
    expect(rows[0]!.runs).toBe(20);
  });

  it("reports survival null and runs 0 when every run ends the draft (no next turn exists)", () => {
    const state = advance(freshTailState(), 1, 3); // picks 1-3 played; pick 4 (t4's only pick) is up
    expect(teamOnClock(state)).toBe("t4");
    const shortlistIds = [TAIL_BOARD[TAIL_BOARD.length - 1]!.playerId, TAIL_BOARD[TAIL_BOARD.length - 2]!.playerId];

    const rows = makeItBackOdds({ state, askingTeamId: "t4", shortlistIds, seed: 3 });

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.survival).toBeNull();
      expect(row.runs).toBe(0);
    }
  });
});
