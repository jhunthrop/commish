import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import type { RosterSlot } from "@/domain/roster";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { initialDraftState, totalRosterSlots, type CompletedPick, type DraftConfig, type DraftState } from "./state";
import { AUTOPICK_CONFIG, DRAFT_CLOCK_SCHEDULE } from "./config";
import { assignSlot } from "./slotting";
import { reduceDraft } from "./reduce";
import { availablePool, bestAvailableFor, bestNominationFor, isComplete } from "./selectors";
import { expireAt, submitCommand } from "./test-support";

const T = "2026-09-01T00:00:00.000Z";

// Carries the autopick snapshot the way every post-upgrade draft's config does (`reduceStart`
// copies it from the START_DRAFT action): the need-aware scoring only ever reads this snapshot,
// so a hand-built config without it is, by definition, a pre-upgrade draft (see the history
// describe block at the bottom).
const SNAKE_CONFIG: DraftConfig = {
  draftId: "d_auto", leagueId: "l_auto", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: STANDARD_ROSTER_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
  autopick: AUTOPICK_CONFIG,
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

  it("answers null, never NaN arithmetic, for a degenerate zero-slot config", () => {
    // No slot config means nothing is ever legal AND `totalRosterSlots` is 0 — the ramp's
    // divisor. The guard pins the ramp to 0 (instead of 0/0 = NaN flowing into every score),
    // and the answer is the same null every no-legal-player state produces.
    const state = midDraftState({ ...SNAKE_CONFIG, slotConfig: [] }, ROUND8_POOL, { t1: [], t2: [] });
    expect(bestAvailableFor(state, "t1")).toBeNull();
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
  // clock-makes-every-pick draft the endgame forcing must survive. The autopick snapshot IS
  // present, the way every post-upgrade START_DRAFT carries it, so this drives the need-aware
  // path end to end.
  const START: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: TEAMS, pool: POOL, autopick: AUTOPICK_CONFIG };

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

describe("history replays under the policy it was made with (the skipPolicy/F3 discipline)", () => {
  // A tiny 2-team, 3-slot league whose autopicks DIVERGE between the old and new policies by
  // round 2, so equivalence assertions below cannot pass by accident.
  const SPRINT_SLOTS = [
    { slot: "QB", count: 1, eligiblePositions: ["QB"] },
    { slot: "RB", count: 1, eligiblePositions: ["RB"] },
    { slot: "BENCH", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
  ] as const;
  const SPRINT_POOL: readonly DraftPoolEntry[] = [
    { playerId: "qb1", position: "QB" }, { playerId: "qb2", position: "QB" }, { playerId: "qb3", position: "QB" },
    { playerId: "rb1", position: "RB" }, { playerId: "rb2", position: "RB" }, { playerId: "rb3", position: "RB" },
  ];
  const SPRINT_CONFIG: DraftConfig = {
    draftId: "d_hist", leagueId: "l_hist", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
    auctionBudget: null, slotConfig: SPRINT_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };

  /** Folds a START (as given) plus expiries to completion, returning "team:player" per pick. */
  function replayAllExpiries(start: StartDraftAction): readonly string[] {
    let state = initialDraftState(SPRINT_CONFIG);
    const started = submitCommand(state, start);
    if (!started.ok) throw new Error(started.reason);
    state = started.state;
    while (!isComplete(state)) {
      const next = submitCommand(state, expireAt(state));
      if (!next.ok) throw new Error(next.reason);
      state = next.state;
    }
    return state.picks.map((p) => `${p.teamId}:${p.playerId}`);
  }

  it("replays a pre-upgrade log (no autopick snapshot) to exactly the OLD algorithm's picks", () => {
    // A log persisted before the upgrade: START_DRAFT carries no autopick snapshot (and no
    // skipPolicy — the oldest shape), and its live TIMER_EXPIREs derived every autopick under
    // the OLD policy: queue first, then plain board order. The expectation below is that
    // algorithm's output, derived BY HAND from board order alone — round 2 is where the new
    // scoring would diverge (t2 holding qb2 would take rb1 over the board-first qb3), so this
    // sequence can only be produced by the legacy path.
    const preUpgradeStart: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: ["t1", "t2"], pool: SPRINT_POOL };
    expect(replayAllExpiries(preUpgradeStart)).toEqual([
      "t1:qb1", // pick 1: board head
      "t2:qb2", // pick 2: board head
      "t2:qb3", // pick 3 (round 2 reversed): board head again — a THIRD QB, onto the bench
      "t1:rb1", // pick 4: board head among what remains
      "t1:rb2", // pick 5 (round 3): bench
      "t2:rb3", // pick 6: the last RB slot
    ]);
  });

  it("keeps a snapshotted draft's replay identical even after the module tunables are retuned", () => {
    // The persisted-row round trip: a stored action holds the VALUES, not a reference to the
    // module constant — spread here models exactly that.
    const snapshottedStart: StartDraftAction = {
      v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: ["t1", "t2"], pool: SPRINT_POOL,
      autopick: { ...AUTOPICK_CONFIG },
    };
    const before = replayAllExpiries(snapshottedStart);
    // Round 2 takes the open-need RB over the board-first third QB: proof the need-aware path
    // (not the legacy one) is what this test is holding still.
    expect(before[2]).toBe("t2:rb1");

    const mutable = AUTOPICK_CONFIG as { temperature: number; needPerOpenStartingSlot: number };
    const saved = { temperature: mutable.temperature, needPerOpenStartingSlot: mutable.needPerOpenStartingSlot };
    try {
      // A hostile future retune. If bestAvailableFor read the module constant anywhere, the
      // replay below would flip picks; reading only the log's own snapshot, it cannot.
      mutable.temperature = 0.5;
      mutable.needPerOpenStartingSlot = 5;
      expect(replayAllExpiries(snapshottedStart)).toEqual(before);
    } finally {
      mutable.temperature = saved.temperature;
      mutable.needPerOpenStartingSlot = saved.needPerOpenStartingSlot;
    }
  });

  it("takes the plain board-order fallback for a pre-upgrade state even where need would differ", () => {
    // The round-8 TE-need scenario from above, minus the snapshot: the old policy takes the
    // board's best (rb5), never the roster's need (te1) — byte-equivalent to the pre-upgrade
    // fallback, which is what an absent snapshot MUST mean.
    const legacyConfig: DraftConfig = { ...SNAKE_CONFIG, autopick: null };
    const state = midDraftState(legacyConfig, ROUND8_POOL, { t1: ROUND8_ROSTER, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("rb5");
  });
});
