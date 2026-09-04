import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import type { RosterSlot } from "@/domain/roster";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { initialDraftState, totalRosterSlots, type CompletedPick, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { assignSlot } from "./slotting";
import { reduceDraft } from "./reduce";
import { availablePool, bestAvailableFor, bestNominationFor, isComplete } from "./selectors";
import { expireAt, submitCommand } from "./test-support";

const T = "2026-09-01T00:00:00.000Z";

const SNAKE_CONFIG: DraftConfig = {
  draftId: "d_auto", leagueId: "l_auto", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: STANDARD_ROSTER_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

/**
 * A hand-built mid-draft state: `rostersByTeam` names each team's already-drafted players in
 * draft order, and picks/rosters are derived through the engine's own `assignSlot` so the
 * fixture can never disagree with slotting reality.
 */
function midDraftState(config: DraftConfig, pool: readonly DraftPoolEntry[], rostersByTeam: Readonly<Record<string, readonly string[]>>): DraftState {
  const byId = new Map(pool.map((entry) => [entry.playerId, entry]));
  const picks: CompletedPick[] = [];
  const rosters: Record<string, readonly RosterSlot[]> = {};
  for (const [teamId, playerIds] of Object.entries(rostersByTeam)) {
    let roster: readonly RosterSlot[] = [];
    for (const playerId of playerIds) {
      const entry = byId.get(playerId);
      if (entry === undefined) throw new Error(`fixture player ${playerId} is not in the pool`);
      const assigned = assignSlot({ position: entry.position, roster, slotConfig: config.slotConfig });
      if (!assigned.ok) throw new Error(`fixture cannot roster ${playerId}: ${assigned.reason}`);
      roster = [...roster, { slot: assigned.slot, slotIndex: assigned.slotIndex, playerId }];
      picks.push({
        pickNumber: picks.length + 1, round: 1, teamId, playerId,
        slot: assigned.slot, slotIndex: assigned.slotIndex, price: null, timestamp: T, auto: false,
      });
    }
    rosters[teamId] = roster;
  }
  return {
    config, phase: "in_progress", sequence: picks.length, draftOrder: Object.keys(rostersByTeam),
    pool, picks, rosters, budgets: {}, queues: {}, owedPicks: {},
    auction: null, pickNumber: picks.length + 1, turnStartedAt: T,
  };
}

function players(position: Position, count: number, from = 1): readonly DraftPoolEntry[] {
  return Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${from + i}`, position }));
}

/**
 * The round-8 board: t1 already holds QB, four RBs (both RB starters, FLEX, one bench spot)
 * and both WR starters. The best players still available are a fifth RB, then the board's
 * first TE, then depth at every position.
 */
const ROUND8_POOL: readonly DraftPoolEntry[] = [
  ...players("QB", 1), ...players("RB", 4), ...players("WR", 2), // t1's seven rostered players
  { playerId: "rb5", position: "RB" }, { playerId: "te1", position: "TE" },
  ...players("QB", 3, 2), ...players("RB", 10, 6), ...players("WR", 10, 3), ...players("TE", 5, 2),
  ...players("K", 4), ...players("DEF", 4),
];
const ROUND8_ROSTER = ["qb1", "rb1", "rb2", "rb3", "rb4", "wr1", "wr2"];

function round8State(): DraftState {
  return midDraftState(SNAKE_CONFIG, ROUND8_POOL, { t1: ROUND8_ROSTER, t2: [] });
}

describe("need-aware autopick (bestAvailableFor fallback)", () => {
  it("takes the board's own top player on a team's first pick, exactly board order", () => {
    // Empty roster => ramp 0 => every multiplier is exactly 1 and the argmax IS the first
    // legal player in board order (the pre-upgrade behavior, and the tie-break's own rule:
    // equal need resolves to the earlier board index).
    const state = round8State();
    expect(bestAvailableFor(state, "t2")).toEqual(availablePool(state)[0]);
    expect(bestAvailableFor(state, "t2")?.playerId).toBe("rb5");
  });

  it("still takes the board's best early in the draft even at an already-filled position", () => {
    // One pick in, the ramp is barely awake (1/7.5 of full weight): a second QB at the top of
    // the board beats an open-need RB one rank below it.
    const pool: readonly DraftPoolEntry[] = [
      ...players("QB", 2), ...players("RB", 20), ...players("WR", 20),
      ...players("TE", 5), ...players("K", 3), ...players("DEF", 3),
    ];
    const state = midDraftState(SNAKE_CONFIG, pool, { t1: ["qb1"], t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("qb2");
  });

  it("fills the open TE need late over a higher-ranked fifth RB", () => {
    // Round 8, four RBs rostered, no TE: rb5 is the board's best available, but t1's RB
    // starters are all filled (cooled) while the TE slot is wide open (warmed) — te1 wins.
    expect(bestAvailableFor(round8State(), "t1")?.playerId).toBe("te1");
  });

  it("cools a filled-starters position below an open-need position of comparable rank", () => {
    // Six picks in (ramp 0.8): the board's best available is a WR, but t1's WR starters are
    // both filled and the TE slot is open — the TE one rank below wins.
    const pool: readonly DraftPoolEntry[] = [
      ...players("QB", 1), ...players("RB", 2), ...players("WR", 2), ...players("DEF", 1),
      { playerId: "wr9", position: "WR" }, { playerId: "te1", position: "TE" },
      ...players("QB", 3, 2), ...players("RB", 10, 3), ...players("WR", 10, 10), ...players("TE", 5, 2),
      ...players("K", 4), ...players("DEF", 3, 2),
    ];
    const state = midDraftState(SNAKE_CONFIG, pool, { t1: ["qb1", "rb1", "rb2", "wr1", "wr2", "def1"], t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("te1");
  });

  it("lets the queue beat every heuristic outright", () => {
    // t1's queue names a kicker buried deep in the board; the manager's recorded intent wins
    // over anything the need scoring would prefer.
    const base = round8State();
    const state: DraftState = { ...base, queues: { t1: ["k1"] } };
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("k1");
  });

  it("is deterministic: the same state produces the same pick, twice, and from a clone", () => {
    const state = round8State();
    const first = bestAvailableFor(state, "t1");
    const second = bestAvailableFor(state, "t1");
    const fromClone = bestAvailableFor(JSON.parse(JSON.stringify(state)) as DraftState, "t1");
    expect(second).toEqual(first);
    expect(fromClone).toEqual(first);
  });
});

describe("endgame regression: a full 15-round all-autopick draft", () => {
  const TEAMS = Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);
  // A proportionally interleaved 250-player pool, so the ranking isn't position-sorted
  // (same construction as full-draft.test.ts, restated over this suite's own fixture).
  const POOL: readonly DraftPoolEntry[] = (() => {
    const plan: readonly (readonly [Position, number])[] = [["QB", 30], ["RB", 70], ["WR", 80], ["TE", 30], ["K", 20], ["DEF", 20]];
    const ranked = plan.flatMap(([position, count], bucketIndex) =>
      Array.from({ length: count }, (_, i) => ({
        entry: { playerId: `${position.toLowerCase()}${i + 1}`, position }, rank: (i + 0.5) / count, bucketIndex,
      })),
    );
    return [...ranked].sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex).map((r) => r.entry);
  })();
  // No skipPolicy on START: every expiry autopicks (no queues, no skips) — the pure
  // clock-makes-every-pick draft the endgame forcing must survive.
  const START: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: TEAMS, pool: POOL };

  const final = (() => {
    let state = initialDraftState(SNAKE_CONFIG);
    const started = submitCommand(state, START);
    if (!started.ok) throw new Error(started.reason);
    state = started.state;
    while (!isComplete(state)) {
      const next = submitCommand(state, expireAt(state));
      if (!next.ok) throw new Error(next.reason);
      state = next.state;
    }
    return state;
  })();

  it("completes with every pick made by the clock", () => {
    expect(final.picks).toHaveLength(TEAMS.length * totalRosterSlots(STANDARD_ROSTER_SLOTS));
    expect(final.picks.every((p) => p.auto)).toBe(true);
  });

  it("ends with every starting slot filled on every roster", () => {
    for (const teamId of TEAMS) {
      const roster = final.rosters[teamId] ?? [];
      expect(roster).toHaveLength(15);
      for (const slotConfig of STANDARD_ROSTER_SLOTS) {
        expect(roster.filter((s) => s.slot === slotConfig.slot)).toHaveLength(slotConfig.count);
      }
    }
  });
});

describe("auction nomination stays on board order (economics pinned)", () => {
  const AUCTION_CONFIG_FIXTURE: DraftConfig = { ...SNAKE_CONFIG, draftId: "d_auto_a", format: "auction", auctionBudget: 200 };

  function auctionRound8State(): DraftState {
    const base = midDraftState(AUCTION_CONFIG_FIXTURE, ROUND8_POOL, { t1: ROUND8_ROSTER, t2: [] });
    return {
      ...base,
      budgets: { t1: 150, t2: 200 },
      auction: { nominatingTeamId: "t1", lot: null, minBid: 1 },
    };
  }

  it("bestNominationFor ignores need entirely: the board's best available, not the roster's", () => {
    // Identical state to the snake TE-need scenario — the autopick takes te1, the nomination
    // still puts up rb5, because "who do I put up for everyone to bid on" is not "who do I
    // add to my roster".
    expect(bestNominationFor(auctionRound8State(), "t1")?.playerId).toBe("rb5");
  });

  it("auto-nominates the stalled team's board-order best available at the minimum bid", () => {
    const result = reduceDraft(auctionRound8State(), { v: 1, type: "TIMER_EXPIRE", timestamp: T });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.auction?.lot).toEqual({
      playerId: "rb5", highBid: 1, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: true,
    });
  });

  it("still lets the stalled team's own queue pick the auto-nomination first", () => {
    const state: DraftState = { ...auctionRound8State(), queues: { t1: ["te2"] } };
    const result = reduceDraft(state, { v: 1, type: "TIMER_EXPIRE", timestamp: T });
    if (!result.ok) throw new Error(result.reason);
    expect(result.state.auction?.lot?.playerId).toBe("te2");
    expect(result.state.auction?.lot?.autoNominated).toBe(true);
  });
});
