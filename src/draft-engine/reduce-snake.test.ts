import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { availablePool, bestAvailableFor, isComplete, openSlotCount, teamOnClock } from "./selectors";

/** Three slots per team keeps reducer tests fast and every assertion hand-checkable. */
const SPRINT_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "BENCH", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
  { playerId: "wr1", position: "WR" },
  { playerId: "qb3", position: "QB" },
  { playerId: "rb3", position: "RB" },
  { playerId: "wr2", position: "WR" },
];

const CONFIG: DraftConfig = {
  draftId: "draft_1",
  leagueId: "league_1",
  format: "snake",
  kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null,
  slotConfig: SPRINT_SLOTS,
  clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

const START: StartDraftAction = {
  v: 1,
  type: "START_DRAFT", minBid: 1,
  timestamp: "2026-09-01T00:00:00.000Z",
  draftOrder: ["t1", "t2"],
  pool: POOL,
};

function started(): DraftState {
  const result = reduceDraft(initialDraftState(CONFIG), START);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function pick(state: DraftState, teamId: string, playerId: string, timestamp = "2026-09-01T00:10:00.000Z"): DraftState {
  const result = reduceDraft(state, { v: 1, type: "MAKE_PICK", timestamp, teamId, playerId });
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe("START_DRAFT", () => {
  it("opens the draft, seeds empty rosters, starts the clock and puts team one on the clock", () => {
    const state = started();
    expect(state.phase).toBe("in_progress");
    expect(state.sequence).toBe(1);
    expect(state.pickNumber).toBe(1);
    expect(state.draftOrder).toEqual(["t1", "t2"]);
    expect(state.pool).toEqual(POOL);
    expect(state.turnStartedAt).toBe(START.timestamp);
    expect(state.rosters).toEqual({ t1: [], t2: [] });
    expect(teamOnClock(state)).toBe("t1");
  });

  it("rejects a second start", () => {
    expect(reduceDraft(started(), START)).toEqual({ ok: false, reason: "This draft has already started." });
  });

  it("rejects a draft order with fewer than two teams", () => {
    const result = reduceDraft(initialDraftState(CONFIG), { ...START, draftOrder: ["t1"] });
    expect(result).toEqual({ ok: false, reason: "A draft needs at least two teams." });
  });

  it("rejects a draft order with a duplicate team", () => {
    const result = reduceDraft(initialDraftState(CONFIG), { ...START, draftOrder: ["t1", "t1"] });
    expect(result).toEqual({ ok: false, reason: "Every team may appear in the draft order only once." });
  });

  it("rejects a pool with a duplicate player", () => {
    const result = reduceDraft(initialDraftState(CONFIG), { ...START, pool: [POOL[0]!, POOL[0]!] });
    expect(result).toEqual({ ok: false, reason: "Every player may appear in the draft pool only once." });
  });

  it("rejects an auction draft with no budget", () => {
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: null };
    const result = reduceDraft(initialDraftState(auctionConfig), START);
    expect(result).toEqual({ ok: false, reason: "An auction draft needs a budget before it can start." });
  });

  it("rejects a pool one player short of filling every roster", () => {
    // SPRINT_SLOTS has 3 slots/team, draftOrder has 2 teams — 6 players are needed; give 5.
    const result = reduceDraft(initialDraftState(CONFIG), { ...START, pool: POOL.slice(0, 5) });
    expect(result).toEqual({ ok: false, reason: "There aren't enough players to fill every roster." });
  });

  it("accepts a pool with exactly enough players to fill every roster", () => {
    const result = reduceDraft(initialDraftState(CONFIG), { ...START, pool: POOL.slice(0, 6) });
    expect(result.ok).toBe(true);
  });
});

describe("MAKE_PICK (snake)", () => {
  it("records the pick, fills a roster slot, advances the clock and hands over the turn", () => {
    const state = pick(started(), "t1", "qb1");
    expect(state.sequence).toBe(2);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:10:00.000Z", auto: false },
    ]);
    expect(state.rosters.t1).toEqual([{ slot: "QB", slotIndex: 0, playerId: "qb1" }]);
    expect(state.pickNumber).toBe(2);
    expect(state.turnStartedAt).toBe("2026-09-01T00:10:00.000Z");
    expect(teamOnClock(state)).toBe("t2");
  });

  it("rejects a pick before the draft has started", () => {
    const result = reduceDraft(initialDraftState(CONFIG), { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t1", playerId: "qb1" });
    expect(result).toEqual({ ok: false, reason: "This draft hasn't started yet." });
  });

  it("rejects a pick from a team that isn't on the clock", () => {
    const result = reduceDraft(started(), { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t2", playerId: "qb1" });
    expect(result).toEqual({ ok: false, reason: "It's not your turn to pick." });
  });

  it("rejects an already-drafted player", () => {
    const state = pick(started(), "t1", "qb1");
    const result = reduceDraft(state, { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t2", playerId: "qb1" });
    expect(result).toEqual({ ok: false, reason: "That player has already been drafted." });
  });

  it("rejects a player who isn't in this draft's pool", () => {
    const result = reduceDraft(started(), { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t1", playerId: "ghost" });
    expect(result).toEqual({ ok: false, reason: "That player isn't in this draft's player pool." });
  });

  it("rejects a pick that would exceed the roster slots, via validateRosterAdd", () => {
    // Turn order for 2 teams over 3 rounds is t1, t2, t2, t1, t1, t2. By pick 6, t2 has
    // filled BENCH (with a WR, which has no dedicated slot) and QB, leaving only RB open —
    // so a second QB has nowhere to go.
    let state = pick(started(), "t1", "qb1");
    state = pick(state, "t2", "wr1");
    state = pick(state, "t2", "qb2");
    state = pick(state, "t1", "rb2");
    state = pick(state, "t1", "rb3");
    const result = reduceDraft(state, { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t2", playerId: "qb3" });
    expect(result).toEqual({ ok: false, reason: "Your roster has no open slot for a QB." });
  });

  it("rejects a nomination in a snake draft", () => {
    const result = reduceDraft(started(), { v: 1, type: "NOMINATE", timestamp: START.timestamp, teamId: "t1", playerId: "qb1", openingBid: 1 });
    expect(result).toEqual({ ok: false, reason: "This is a snake draft — make a pick instead of nominating." });
  });

  it("completes the draft after the last pick and stops the clock", () => {
    let state = started();
    const script: readonly (readonly [string, string])[] = [
      ["t1", "qb1"], ["t2", "rb1"], ["t2", "qb2"], ["t1", "rb2"], ["t1", "wr1"], ["t2", "wr2"],
    ];
    for (const [teamId, playerId] of script) state = pick(state, teamId, playerId);
    expect(isComplete(state)).toBe(true);
    expect(state.phase).toBe("complete");
    expect(state.turnStartedAt).toBeNull();
    expect(teamOnClock(state)).toBeNull();
    expect(state.picks).toHaveLength(6);
    const result = reduceDraft(state, { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t1", playerId: "qb3" });
    expect(result).toEqual({ ok: false, reason: "This draft has already finished." });
  });

  it("never mutates the state it was given", () => {
    const before = started();
    const snapshot = structuredClone(before);
    pick(before, "t1", "qb1");
    expect(before).toEqual(snapshot);
  });
});

describe("selectors", () => {
  it("reports the undrafted pool, remaining slots and best available for a team", () => {
    const state = pick(started(), "t1", "qb1");
    expect(availablePool(state).map((p) => p.playerId)).toEqual(["rb1", "qb2", "rb2", "wr1", "qb3", "rb3", "wr2"]);
    expect(openSlotCount(state, "t1")).toBe(2);
    expect(openSlotCount(state, "t2")).toBe(3);
    // t1 already has a QB, so the best player they can still roster is rb1.
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("rb1");
    expect(bestAvailableFor(state, "t2")?.playerId).toBe("rb1");
  });

  it("returns null best-available for a team with no room left", () => {
    let state = pick(started(), "t1", "qb1");
    state = pick(state, "t2", "rb1");
    state = pick(state, "t2", "qb2");
    state = pick(state, "t1", "rb2");
    state = pick(state, "t1", "wr1");
    expect(bestAvailableFor(state, "t1")).toBeNull();
  });
});
