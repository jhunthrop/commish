import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { initialDraftState, totalRosterSlots, type DraftConfig, type DraftState } from "./state";
import { AUTOPICK_CONFIG, DRAFT_CLOCK_SCHEDULE, DRAFT_SKIP_POLICY } from "./config";
import { snakeTeamForPick } from "./order";
import { isComplete, remainingBudget } from "./selectors";
import { expireAt, submitCommand } from "./test-support";

const TEAMS = Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);

/**
 * A 250-player pool with a realistic position mix, interleaved so the ranking isn't
 * position-sorted. Deterministic: no randomness, so the draft is reproducible.
 *
 * Each player's rank is its *proportional* depth within its own position bucket
 * (e.g. rb1 of 70 ranks similarly to k1 of 20), not a fixed-size round-robin wave. A
 * fixed 1-per-bucket wave (6 positions per wave) would resonate with this draft's
 * 12-team snake order — 12 is an exact multiple of 6 — so every K/DEF would land at
 * the same one or two team slots every round, starving the other teams of any K/DEF
 * at all before the pool runs out. Proportional ranking spreads each position across
 * the whole draft instead of locking it to a period that divides the team count.
 */
const POOL: readonly DraftPoolEntry[] = (() => {
  const plan: readonly (readonly [Position, number])[] = [["QB", 30], ["RB", 70], ["WR", 80], ["TE", 30], ["K", 20], ["DEF", 20]];
  const buckets = plan.map(([position, count]) =>
    Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${i + 1}`, position })),
  );
  const ranked = buckets.flatMap((bucket, bucketIndex) =>
    bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })),
  );
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
})();

const T = "2026-09-01T00:00:00.000Z";
const START: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, timestamp: T, draftOrder: TEAMS, pool: POOL };

function apply(state: DraftState, action: Parameters<typeof submitCommand>[1]): DraftState {
  const result = submitCommand(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.reason}`);
  return result.state;
}

describe("a full 12-team, 15-round snake draft", () => {
  const config: DraftConfig = {
    draftId: "d_snake", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
    auctionBudget: null, slotConfig: STANDARD_ROSTER_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };

  const final = (() => {
    let state = apply(initialDraftState(config), START);
    while (!isComplete(state)) state = apply(state, expireAt(state));
    return state;
  })();

  it("runs to completion with exactly one pick per roster spot", () => {
    expect(final.picks).toHaveLength(TEAMS.length * totalRosterSlots(STANDARD_ROSTER_SLOTS));
    expect(final.picks).toHaveLength(180);
    expect(final.phase).toBe("complete");
  });

  it("never drafts the same player twice", () => {
    expect(new Set(final.picks.map((p) => p.playerId)).size).toBe(final.picks.length);
  });

  it("follows serpentine order for every one of the 180 picks", () => {
    for (const pick of final.picks) {
      expect(pick.teamId).toBe(snakeTeamForPick(TEAMS, pick.pickNumber));
    }
  });

  it("fills every roster completely and legally", () => {
    for (const teamId of TEAMS) {
      const roster = final.rosters[teamId] ?? [];
      expect(roster).toHaveLength(15);
      // Every configured slot is filled to its exact count — no slot over-filled.
      for (const slotConfig of STANDARD_ROSTER_SLOTS) {
        expect(roster.filter((s) => s.slot === slotConfig.slot)).toHaveLength(slotConfig.count);
      }
    }
  });

  it("rejects a pick for an already-drafted player at any point in the draft", () => {
    const drafted = final.picks[0]!.playerId;
    let state = apply(initialDraftState(config), START);
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: TEAMS[0]!, playerId: drafted });
    expect(submitCommand(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: TEAMS[1]!, playerId: drafted })).toEqual({
      ok: false,
      reason: "That player has already been drafted.",
    });
  });
});

/**
 * THE LATE-ROUND POLICY, END TO END (the 2026-09-05 kicker and team defence round).
 *
 * The block above runs on a `START_DRAFT` with NO autopick snapshot at all, which is the
 * pre-upgrade board-order path and the one every historical log replays down. This block runs the
 * SAME draft with today's `AUTOPICK_CONFIG` on the snapshot, which is what a room started from here
 * on actually gets, and asserts the two things the spec's UX rider demands: every seat finishes with
 * both slots filled, and neither position is reached for early.
 */
describe("a full 12-team snake draft under today's autopick policy", () => {
  const config: DraftConfig = {
    draftId: "d_policy", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
    auctionBudget: null, slotConfig: STANDARD_ROSTER_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
  const START_WITH_POLICY: StartDraftAction = { ...START, autopick: AUTOPICK_CONFIG };
  const ROUNDS = totalRosterSlots(STANDARD_ROSTER_SLOTS);
  const POSITION_OF = new Map(POOL.map((entry) => [entry.playerId, entry.position] as const));

  /** One autopick, with the acting team's roster as it stood BEFORE the pick landed. The final
   *  state cannot say what a roster looked like mid-draft, and the deferral's whole claim is about
   *  what was open at the moment of the pick, so it is recorded as the draft runs. */
  interface Made {
    readonly round: number;
    readonly position: Position | undefined;
    readonly rosterBefore: readonly { readonly slot: string }[];
  }

  const { final, made } = (() => {
    let state = apply(initialDraftState(config), START_WITH_POLICY);
    const record: Made[] = [];
    while (!isComplete(state)) {
      const round = Math.ceil(state.pickNumber / TEAMS.length);
      const teamId = snakeTeamForPick(TEAMS, state.pickNumber);
      const rosterBefore = (state.rosters[teamId] ?? []).map((filled) => ({ slot: String(filled.slot) }));
      const before = state.picks.length;
      state = apply(state, expireAt(state));
      const landed = state.picks[before];
      if (landed !== undefined) record.push({ round, position: POSITION_OF.get(landed.playerId), rosterBefore });
    }
    return { final: state, made: record };
  })();

  it("finishes every seat with a kicker and a team defence", () => {
    for (const teamId of TEAMS) {
      const positions = (final.rosters[teamId] ?? []).map((filled) =>
        filled.playerId === null ? null : POSITION_OF.get(filled.playerId),
      );
      expect(positions).toContain("K");
      expect(positions).toContain("DEF");
    }
  });

  /**
   * The deferral's own claim, checked against every pick the draft actually made rather than
   * against the predicate in isolation: a kicker or a team defence lands before the final rounds
   * ONLY on a roster that already had every other dedicated starting slot filled, which is the
   * exception the policy names.
   */
  it("takes neither position early unless every other starting slot was already filled", () => {
    const early = made.filter(
      (entry) =>
        (entry.position === "K" || entry.position === "DEF") &&
        entry.round <= ROUNDS - AUTOPICK_CONFIG.lateRoundOnlyRoundsFromEnd!,
    );
    const violations = early.filter((entry) =>
      STANDARD_ROSTER_SLOTS.some(
        (slotConfig) =>
          slotConfig.slot !== "BENCH" && slotConfig.slot !== "K" && slotConfig.slot !== "DEF" &&
          entry.rosterBefore.filter((filled) => filled.slot === slotConfig.slot).length < slotConfig.count,
      ),
    );
    expect(violations.map((entry) => ({ round: entry.round, position: entry.position }))).toEqual([]);
  });

  /**
   * THE NUMBER THE POLICY EXISTS TO MOVE, pinned so a retune cannot quietly undo it. Under the
   * pre-policy board-order path the same pool put kickers and defences wherever their board rank
   * fell; here the earliest either goes is round 9, and it only goes then to a seat that has
   * genuinely nothing else to start. Nine and not five is the whole point.
   */
  it("reaches for neither position before round 9", () => {
    const earliest = Math.min(
      ...made.filter((entry) => entry.position === "K" || entry.position === "DEF").map((entry) => entry.round),
    );
    expect(earliest).toBeGreaterThanOrEqual(9);
  });

  it("still runs to completion with one pick per roster spot and no player twice", () => {
    expect(final.picks).toHaveLength(TEAMS.length * ROUNDS);
    expect(new Set(final.picks.map((p) => p.playerId)).size).toBe(final.picks.length);
    expect(final.phase).toBe("complete");
  });
});

describe("a full 12-team auction draft", () => {
  const config: DraftConfig = {
    draftId: "d_auction", leagueId: "l1", format: "auction", kickoffAt: "2026-09-10T17:00:00.000Z",
    auctionBudget: 200, slotConfig: STANDARD_ROSTER_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };

  it("runs to completion on the clock alone, filling every roster and charging every budget", () => {
    let state = apply(initialDraftState(config), START);
    let guard = 0;
    while (!isComplete(state)) {
      state = apply(state, expireAt(state));
      guard += 1;
      expect(guard).toBeLessThan(1000); // fails loudly instead of hanging if the auction can't finish
      // No team's spending ever outruns its budget, at any point in the run.
      for (const teamId of TEAMS) expect(remainingBudget(state, teamId)).toBeGreaterThanOrEqual(0);
    }
    expect(state.picks).toHaveLength(180);
    expect(new Set(state.picks.map((p) => p.playerId)).size).toBe(state.picks.length);
    for (const teamId of TEAMS) {
      expect(state.rosters[teamId]).toHaveLength(15);
      // Every unchallenged auto-nomination goes for the $1 minimum.
      expect(remainingBudget(state, teamId)).toBe(200 - 15);
    }
  });

  it("enforces budgets through a real bidding war", () => {
    let state = apply(initialDraftState(config), START);
    state = apply(state, { v: 1, type: "NOMINATE", timestamp: T, teamId: TEAMS[0]!, playerId: "qb1", openingBid: 50 });
    state = apply(state, { v: 1, type: "BID", timestamp: T, teamId: TEAMS[1]!, amount: 120 });
    state = apply(state, { v: 1, type: "BID", timestamp: T, teamId: TEAMS[0]!, amount: 186 });
    // $200 less $14 held back for 14 unfilled spots.
    expect(submitCommand(state, { v: 1, type: "BID", timestamp: T, teamId: TEAMS[1]!, amount: 187 })).toEqual({
      ok: false,
      reason: "You can only bid up to $186. You need $1 for each of your remaining roster spots.",
    });
    state = apply(state, expireAt(state));
    expect(remainingBudget(state, TEAMS[0]!)).toBe(14);
    expect(state.picks[0]).toMatchObject({ teamId: TEAMS[0], playerId: "qb1", price: 186 });
  });
});
