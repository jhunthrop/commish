import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import type { RosterSlot } from "@/domain/roster";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { initialDraftState, totalRosterSlots, type CompletedPick, type DraftConfig, type DraftState } from "./state";
import { AUTOPICK_CONFIG, DRAFT_CLOCK_SCHEDULE, type DraftAutopickPolicy } from "./config";
import { positionCeiling } from "./roster-need";
import { PIN_POOL, PIN_SURPLUS_CLOCK_PICKS, PIN_TEAMS } from "./replay-pins.fixture";
import { assignSlot } from "./slotting";
import { needMultiplier } from "./scoring";
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
 * The 2026-09-05 snapshot: surplus damp and the late-round deferral, no roster ceilings — what
 * every log written between that fix and the 2026-09-12 ceilings carries, built field by field
 * so it can never quietly inherit a later dial.
 */
const SURPLUS_SNAPSHOT: DraftAutopickPolicy = {
  temperature: AUTOPICK_CONFIG.temperature,
  needPerOpenStartingSlot: AUTOPICK_CONFIG.needPerOpenStartingSlot,
  startersFilledDamp: AUTOPICK_CONFIG.startersFilledDamp,
  rampFullAtRosterFraction: AUTOPICK_CONFIG.rampFullAtRosterFraction,
  surplusDamp: AUTOPICK_CONFIG.surplusDamp,
  lateRoundOnlyRoundsFromEnd: AUTOPICK_CONFIG.lateRoundOnlyRoundsFromEnd,
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

describe("the roster-status gate on the room's own hand (founder report 2026-09-08)", () => {
  /** rb5 is the board's best available in round eight; here the served board has him off an active roster. */
  const withSquadBack: readonly DraftPoolEntry[] = ROUND8_POOL.map((entry) => (entry.playerId === "rb5" ? { ...entry, excludedFromAutopick: true } : entry));

  it("never autopicks a player the board has off an active roster, under the snapshot policy", () => {
    const state = midDraftState(SNAKE_CONFIG, withSquadBack, { t1: ROUND8_ROSTER, t2: [] });
    expect(availablePool(state)[0]?.playerId).toBe("rb5");
    expect(bestAvailableFor(state, "t2")?.playerId).toBe("te1");
  });

  it("never autopicks him under the pre-upgrade board-order policy either", () => {
    const legacy = Object.fromEntries(Object.entries(SNAKE_CONFIG).filter(([key]) => key !== "autopick")) as DraftConfig;
    const state = midDraftState(legacy, withSquadBack, { t1: ROUND8_ROSTER, t2: [] });
    expect(bestAvailableFor(state, "t2")?.playerId).toBe("te1");
  });

  it("skips him on a manager's own queue rather than honouring the queue over the roster", () => {
    const state: DraftState = { ...midDraftState(SNAKE_CONFIG, withSquadBack, { t1: ROUND8_ROSTER, t2: [] }), queues: { t2: ["rb5", "wr3"] } };
    expect(bestAvailableFor(state, "t2")?.playerId).toBe("wr3");
  });

  it("never auto-nominates him", () => {
    const state = midDraftState(SNAKE_CONFIG, withSquadBack, { t1: ROUND8_ROSTER, t2: [] });
    expect(bestNominationFor(state, "t2")?.playerId).toBe("te1");
  });

  it("leaves a pool with no mark exactly as before: the mark is absent, not false", () => {
    const state = midDraftState(SNAKE_CONFIG, ROUND8_POOL, { t1: ROUND8_ROSTER, t2: [] });
    expect(bestAvailableFor(state, "t2")?.playerId).toBe("rb5");
    expect("excludedFromAutopick" in ROUND8_POOL[0]!).toBe(false);
  });
});

describe("need-aware autopick (bestAvailableFor fallback)", () => {
  it("takes the board's own top player on a team's first pick, exactly board order", () => {
    // Empty roster => ramp 0 => every multiplier is exactly 1 and the argmax IS the first
    // legal player in board order (the pre-upgrade behavior, and the tie-break's own rule:
    // equal need resolves to the earlier board index).
    const state = round8State();
    expect(bestAvailableFor(state, "t2")).toEqual(availablePool(state)[0]);
    expect(bestAvailableFor(state, "t2")?.playerId).toBe("rb5");
  });

  it("still takes the board's best early in the draft at an already-filled position, under the surplus-damp snapshot", () => {
    // One pick in, the ramp is barely awake (1/7.5 of full weight): a second QB at the top of
    // the board beats an open-need RB one rank below it. Pinned to the 2026-09-05 snapshot: the
    // 2026-09-12 ceilings make the second quarterback wait for the starters at any ramp (see the
    // roster-need describe below), which is the founder's own rule and not a ramp question.
    const pool: readonly DraftPoolEntry[] = [
      ...players("QB", 2), ...players("RB", 20), ...players("WR", 20),
      ...players("TE", 5), ...players("K", 3), ...players("DEF", 3),
    ];
    const state = midDraftState({ ...SNAKE_CONFIG, autopick: SURPLUS_SNAPSHOT }, pool, { t1: ["qb1"], t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("qb2");
  });

  it("fills the open TE need late over a higher-ranked fifth RB", () => {
    // Round 8, four RBs rostered, no TE: rb5 is the board's best available, but t1's RB
    // starters are all filled (cooled) while the TE slot is wide open (warmed) — te1 wins.
    expect(bestAvailableFor(round8State(), "t1")?.playerId).toBe("te1");
  });

  it("cools a bench body below an open-need starter of comparable rank", () => {
    // Seven picks in (ramp 0.93): the board's best available is a WR, but t1's WR starters and
    // the flex are all filled so he would sit, and the TE slot is open — the TE one rank below wins.
    const pool: readonly DraftPoolEntry[] = [
      ...players("QB", 1), ...players("RB", 3), ...players("WR", 2), ...players("DEF", 1),
      { playerId: "wr9", position: "WR" }, { playerId: "te1", position: "TE" },
      ...players("QB", 3, 2), ...players("RB", 10, 4), ...players("WR", 10, 10), ...players("TE", 5, 2),
      ...players("K", 4), ...players("DEF", 3, 2),
    ];
    const state = midDraftState(SNAKE_CONFIG, pool, { t1: ["qb1", "rb1", "rb2", "wr1", "wr2", "def1", "rb3"], t2: [] });
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

describe("surplus damp cools a stacked QB below a genuinely open skill need (2026-09-05 incident fix, prod mock 25642877-0841-49a5-8511-f3655d8064b1)", () => {
  // t1 hand-drafted six clean rounds: QB (1/1), RB (2/2 dedicated plus one more in FLEX), WR
  // (2/2) — every skill starter it can fill right now is full except TE, still wide open. The
  // board is topped by two more QBs — the incident's own shape: a 1-QB room where the bots left
  // QBs on the board, and every filled skill position wore the identical flat damp.
  const SURPLUS_ROSTER = ["qb1", "rb1", "rb2", "rb3", "wr1", "wr2"];
  const SURPLUS_POOL: readonly DraftPoolEntry[] = [
    { playerId: "qb1", position: "QB" }, ...players("RB", 3), ...players("WR", 2), // t1's own six
    { playerId: "qb2", position: "QB" }, { playerId: "qb3", position: "QB" },
    { playerId: "rb4", position: "RB" }, { playerId: "wr3", position: "WR" }, { playerId: "te1", position: "TE" },
    ...players("K", 3), ...players("DEF", 3),
  ];
  // The identical policy MINUS `surplusDamp` — a hand-built stand-in for a pre-fix persisted
  // snapshot, the same discipline `SPRINT_CONFIG`'s "history replays" block below uses for
  // `skipPolicy`/`autopick` entirely absent.
  const PRE_FIX_AUTOPICK = {
    temperature: AUTOPICK_CONFIG.temperature,
    needPerOpenStartingSlot: AUTOPICK_CONFIG.needPerOpenStartingSlot,
    startersFilledDamp: AUTOPICK_CONFIG.startersFilledDamp,
    rampFullAtRosterFraction: AUTOPICK_CONFIG.rampFullAtRosterFraction,
  };
  const SURPLUS_CONFIG: DraftConfig = { ...SNAKE_CONFIG, autopick: SURPLUS_SNAPSHOT };

  it("with surplusDamp on the snapshot, routes to the still-needed TE instead of stacking a second QB", () => {
    const state = midDraftState(SURPLUS_CONFIG, SURPLUS_POOL, { t1: SURPLUS_ROSTER, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("te1");
  });

  it("with surplusDamp ABSENT from the snapshot, replays the pre-fix behavior: the board-topping QB wins", () => {
    const legacyConfig: DraftConfig = { ...SNAKE_CONFIG, autopick: PRE_FIX_AUTOPICK };
    const state = midDraftState(legacyConfig, SURPLUS_POOL, { t1: SURPLUS_ROSTER, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("qb2");
  });

  // The 2026-09-06 review's own demand: prove the compounding is REAL, not just documented.
  // Both rosters below are built the one way a real draft ever builds one — `midDraftState`
  // drives every pick through the actual `assignSlot` (the same call `MAKE_PICK` and autopick
  // itself use), so a 2nd/3rd QB lands on the real BENCH slot label exactly like it would live.
  // If `rosteredAtPosition` were still derived from `roster.filter((s) => s.slot === "QB")`
  // (the pre-review bug), both scenarios below would see exactly 1 "QB"-labeled slot — the
  // dedicated starter — and score every stacked QB identically, however many bench copies
  // already exist. `selectors.ts`'s `rosteredCountsByPosition` instead counts the true
  // per-position total off `state.pool`, so the two scenarios below score genuinely differently.
  describe("the compounding escalates for real: a 2nd extra QB cools by ^2, a 3rd by ^3", () => {
    // t1 already holds ONE extra QB (qb1 the starter, qb2 riding the bench) plus both RB/WR
    // starters — six picks, ramp 0.8. A further QB candidate would be the roster's 2nd surplus
    // body: rosteredAtPosition(QB) = 2, configured = 1, extraBodies = max(0, 2 − 1 + 1) = 2.
    const TWO_QB_ROSTER = ["qb1", "qb2", "rb1", "rb2", "wr1", "wr2"];
    // t1 already holds TWO extra QBs (qb1, qb2, qb3) plus both RB/WR starters — seven picks,
    // ramp 0.93̄. A further QB candidate would be the 3rd surplus body: rosteredAtPosition(QB)
    // = 3, extraBodies = max(0, 3 − 1 + 1) = 3.
    const THREE_QB_ROSTER = ["qb1", "qb2", "qb3", "rb1", "rb2", "wr1", "wr2"];
    // qb3 is the board-topping stacked-QB candidate against `TWO_QB_ROSTER` (t1 hasn't drafted
    // it yet there); against `THREE_QB_ROSTER`, t1 already holds qb3 too, so qb4 becomes the
    // board-topping stacked-QB candidate instead. Both are simply "QB" to `needMultiplier` —
    // the assertions below check the POSITION's multiplier, not a specific player id.
    const WEAK_ALTERNATIVES_POOL: readonly DraftPoolEntry[] = [
      { playerId: "qb1", position: "QB" }, { playerId: "qb2", position: "QB" }, { playerId: "qb3", position: "QB" },
      ...players("RB", 2), ...players("WR", 2), // t1's own non-QB starters
      { playerId: "qb4", position: "QB" },
      { playerId: "rb3", position: "RB" }, { playerId: "wr3", position: "WR" }, // weak, already-filled alternatives
      { playerId: "te1", position: "TE" }, // the one genuinely open skill need
      ...players("K", 2), ...players("DEF", 2),
    ];

    it("2 QBs already rostered: the next QB candidate (qb3) scores exactly filledDamp × surplusDamp^2, and autopick routes to TE instead", () => {
      const state = midDraftState(SURPLUS_CONFIG, WEAK_ALTERNATIVES_POOL, { t1: TWO_QB_ROSTER, t2: [] });
      const roster = state.rosters["t1"] ?? [];
      const ramp = roster.length / (0.5 * totalRosterSlots(STANDARD_ROSTER_SLOTS)); // 6 / 7.5 = 0.8
      const filledDamp = 1 - ramp * (1 - AUTOPICK_CONFIG.startersFilledDamp);
      const surplusDampRamped = 1 - ramp * (1 - AUTOPICK_CONFIG.surplusDamp!);
      const stackedQbMultiplier = needMultiplier("QB", roster, STANDARD_ROSTER_SLOTS, {
        openSlotBoost: ramp * AUTOPICK_CONFIG.needPerOpenStartingSlot,
        filledDamp,
        surplusDamp: surplusDampRamped,
        rosteredAtPosition: 2, // qb1 (starter) + qb2 (bench) — the true count, not the slot label
      });
      expect(stackedQbMultiplier).toBeCloseTo(filledDamp * surplusDampRamped ** 2, 12);
      expect(bestAvailableFor(state, "t1")?.playerId).toBe("te1");
    });

    it("3 QBs already rostered: the next QB candidate (qb4) scores exactly filledDamp × surplusDamp^3 — genuinely cooler than the 2-rostered case above, and autopick still routes to TE", () => {
      const state = midDraftState(SURPLUS_CONFIG, WEAK_ALTERNATIVES_POOL, { t1: THREE_QB_ROSTER, t2: [] });
      const roster = state.rosters["t1"] ?? [];
      const ramp = roster.length / (0.5 * totalRosterSlots(STANDARD_ROSTER_SLOTS)); // 7 / 7.5 = 0.9333…
      const filledDamp = 1 - ramp * (1 - AUTOPICK_CONFIG.startersFilledDamp);
      const surplusDampRamped = 1 - ramp * (1 - AUTOPICK_CONFIG.surplusDamp!);
      const stackedQbMultiplier = needMultiplier("QB", roster, STANDARD_ROSTER_SLOTS, {
        openSlotBoost: ramp * AUTOPICK_CONFIG.needPerOpenStartingSlot,
        filledDamp,
        surplusDamp: surplusDampRamped,
        rosteredAtPosition: 3, // qb1 (starter) + qb2 + qb3 (both bench)
      });
      expect(stackedQbMultiplier).toBeCloseTo(filledDamp * surplusDampRamped ** 3, 12);
      // The escalation is real, not just each scenario's own internal arithmetic: three
      // rostered QBs cools the candidate harder than two did above, even though this scenario's
      // ramp (and therefore its filledDamp/surplusDamp) is itself further along.
      expect(stackedQbMultiplier).toBeLessThan(0.1088); // < the 2-rostered case's ≈0.1088
      expect(bestAvailableFor(state, "t1")?.playerId).toBe("te1");
    });
  });

  it("replay determinism: a live retune of AUTOPICK_CONFIG.surplusDamp never leaks into either frozen snapshot's replay", () => {
    // This test proves CONFIG-MUTATION INDEPENDENCE (the "keeps a snapshotted draft's replay
    // identical even after the module tunables are retuned" test above proves the identical
    // thing for `temperature`/`needPerOpenStartingSlot`) — NOT byte-identity with the pre-fix
    // algorithm itself. Byte-identity for the ABSENT-`surplusDamp` path is what the test above
    // ("with surplusDamp ABSENT…") and `scoring.test.ts`'s "is byte-identical to the pre-fix
    // flat filledDamp" test each pin directly. No stored `START_DRAFT` row carries `surplusDamp`
    // yet (it ships in this same change), so this is a forward-looking guarantee: once a draft's
    // OWN snapshot is written, no later deploy may rewrite what it already decided.
    //
    // Both configs below are frozen COPIES (`{ ...AUTOPICK_CONFIG }`, never the module's own
    // reference) for that reason.
    const withSnapshot: DraftConfig = { ...SNAKE_CONFIG, autopick: { ...SURPLUS_SNAPSHOT } };
    const withoutSnapshot: DraftConfig = { ...SNAKE_CONFIG, autopick: PRE_FIX_AUTOPICK };
    const mutable = AUTOPICK_CONFIG as { surplusDamp?: number };
    const saved = mutable.surplusDamp;
    try {
      mutable.surplusDamp = 0.9; // a hostile future retune of the live module constant
      const withState = midDraftState(withSnapshot, SURPLUS_POOL, { t1: SURPLUS_ROSTER, t2: [] });
      const withoutState = midDraftState(withoutSnapshot, SURPLUS_POOL, { t1: SURPLUS_ROSTER, t2: [] });
      expect(bestAvailableFor(withState, "t1")?.playerId).toBe("te1");
      expect(bestAvailableFor(withoutState, "t1")?.playerId).toBe("qb2");
    } finally {
      mutable.surplusDamp = saved;
    }
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

  it("holds every roster under its position ceilings: two quarterbacks, one kicker, one defence at most", () => {
    const positionOf = new Map(POOL.map((entry) => [entry.playerId, entry.position] as const));
    for (const teamId of TEAMS) {
      const counts = new Map<Position, number>();
      for (const spot of final.rosters[teamId] ?? []) {
        const position = positionOf.get(spot.playerId!)!;
        counts.set(position, (counts.get(position) ?? 0) + 1);
      }
      expect(counts.get("QB") ?? 0).toBeLessThanOrEqual(2);
      expect(counts.get("TE") ?? 0).toBeLessThanOrEqual(2);
      expect(counts.get("K") ?? 0).toBe(1);
      expect(counts.get("DEF") ?? 0).toBe(1);
      for (const [position, count] of counts) expect(count).toBeLessThanOrEqual(positionCeiling(position, STANDARD_ROSTER_SLOTS, AUTOPICK_CONFIG.rosterCeilings!));
    }
  });
});

describe("the 2026-09-05 snapshot replays its recorded picks byte for byte (the literal pin, review fix round)", () => {
  it("sixty clock picks on the real board under the surplus-damp snapshot come out exactly as recorded", () => {
    // `replay-pins.fixture.ts`: recorded through the 2026-09-13 code and never regenerated. Every
    // TIMER_EXPIRE a room logged between 2026-09-05 and the ceilings folds through this branch.
    const start: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: PIN_TEAMS, pool: PIN_POOL, autopick: SURPLUS_SNAPSHOT };
    const started = submitCommand(initialDraftState(SNAKE_CONFIG), start);
    if (!started.ok) throw new Error(started.reason);
    let state = started.state;
    const replayed: string[] = [];
    for (let i = 0; i < PIN_SURPLUS_CLOCK_PICKS.length; i += 1) {
      const next = submitCommand(state, expireAt(state));
      if (!next.ok) throw new Error(next.reason);
      state = next.state;
      replayed.push(state.picks[state.picks.length - 1]!.playerId);
    }
    expect(replayed).toEqual(PIN_SURPLUS_CLOCK_PICKS);
  });
});

describe("roster-need ceilings (the 2026-09-12 round: the founder's mock rooms took three quarterbacks)", () => {
  // t1 has built its whole lineup: every dedicated starter plus a third back in the flex.
  const LINEUP = ["qb1", "rb1", "rb2", "rb3", "wr1", "wr2", "te1"];
  // And then a backup quarterback, a bench receiver and a bench tight end: the ten-man roster
  // the founder's incident reached, where every alternative left was a second bench body.
  const STACKED = [...LINEUP, "qb2", "wr3", "te2"];
  // The kicker and defence tail sits behind a block of receivers, where a real board keeps it:
  // with the lineup complete their deferral lifts, and a kicker at the top of the board would
  // simply be the late-round policy's own (correct) answer rather than anything about ceilings.
  const CEILING_POOL: readonly DraftPoolEntry[] = [
    ...players("QB", 3), ...players("RB", 3), ...players("WR", 2), { playerId: "te1", position: "TE" }, // t1's own
    { playerId: "qb4", position: "QB" }, { playerId: "rb4", position: "RB" }, { playerId: "wr3", position: "WR" },
    { playerId: "te2", position: "TE" }, { playerId: "rb5", position: "RB" }, ...players("WR", 12, 10),
    { playerId: "def2", position: "DEF" }, ...players("K", 2), { playerId: "def1", position: "DEF" },
  ];

  it("never takes a third quarterback: with two rostered, the board-topping QB is passed for the bench back", () => {
    const state = midDraftState(SNAKE_CONFIG, CEILING_POOL, { t1: STACKED, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("rb4");
  });

  it("but replays the surplus-damp snapshot as it was: the same state stacked the third quarterback", () => {
    const state = midDraftState({ ...SNAKE_CONFIG, autopick: SURPLUS_SNAPSHOT }, CEILING_POOL, { t1: STACKED, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("qb3");
  });

  it("makes every bench body wait while a starter is open: the deep tight end who fills the lineup goes before the second quarterback and the bench receiver", () => {
    // TE open (te1 not yet drafted), flex held by rb3: qb2 tops the board and wr3 sits behind
    // him, but both would sit, so both wait, and te1 goes though he is eleven ranks down.
    const pool: readonly DraftPoolEntry[] = [
      ...players("QB", 2), ...players("RB", 3), ...players("WR", 2),
      { playerId: "wr3", position: "WR" }, ...players("RB", 8, 4), { playerId: "te1", position: "TE" },
      ...players("K", 2), ...players("DEF", 2),
    ];
    const state = midDraftState(SNAKE_CONFIG, pool, { t1: ["qb1", "rb1", "rb2", "rb3", "wr1", "wr2"], t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("te1");
  });

  it("takes the second quarterback once the lineup is built and the board ranks him above the bench back", () => {
    const state = midDraftState(SNAKE_CONFIG, CEILING_POOL, { t1: LINEUP, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("qb2");
  });

  it("and the bench back when he outranks the quarterback: bench bodies compete on the board alone", () => {
    const pool: readonly DraftPoolEntry[] = [
      ...players("RB", 4), ...players("QB", 2), ...players("WR", 2), { playerId: "te1", position: "TE" },
      ...players("WR", 12, 10), ...players("K", 2), ...players("DEF", 2),
    ];
    const state = midDraftState(SNAKE_CONFIG, pool, { t1: LINEUP, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("rb4");
  });

  it("never takes a third tight end, and makes the second one wait for the starters like the second quarterback", () => {
    // Lineup built: te2 tops the board, would sit, and is the one backup allowed, so he goes.
    // With the flex held by rb3 and a starter (WR2) still open, te2 would sit: he waits, and the
    // late receiver who fills the open slot goes first (the surplus-damp scoring took te2 here:
    // 0.6 against the receiver's 1.4 x e^-1). With two rostered, a third tight end is capped.
    const pool: readonly DraftPoolEntry[] = [
      ...players("QB", 1), ...players("RB", 3), { playerId: "wr1", position: "WR" }, ...players("TE", 3),
      { playerId: "rb4", position: "RB" }, ...players("WR", 12, 10), { playerId: "wr2", position: "WR" }, ...players("K", 2), ...players("DEF", 2),
    ];
    expect(bestAvailableFor(midDraftState(SNAKE_CONFIG, pool, { t1: LINEUP, t2: [] }), "t1")?.playerId).toBe("te2");
    expect(bestAvailableFor(midDraftState(SNAKE_CONFIG, pool, { t1: ["qb1", "rb1", "rb2", "rb3", "wr1", "te1"], t2: [] }), "t1")?.playerId).toBe("wr10");
    expect(bestAvailableFor(midDraftState(SNAKE_CONFIG, pool, { t1: [...LINEUP, "te2"], t2: [] }), "t1")?.playerId).toBe("rb4");
  });

  it("never takes a second defence, even when the board is topped by one", () => {
    const pool: readonly DraftPoolEntry[] = [
      ...players("QB", 1), ...players("RB", 3), ...players("WR", 2), { playerId: "te1", position: "TE" }, { playerId: "def1", position: "DEF" }, // t1's own
      { playerId: "def2", position: "DEF" }, { playerId: "rb4", position: "RB" }, ...players("WR", 12, 10), ...players("K", 2),
    ];
    const state = midDraftState(SNAKE_CONFIG, pool, { t1: [...LINEUP, "def1"], t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("rb4");
  });

  it("still returns a pick when every legal candidate is over a ceiling, rather than stalling the clock", () => {
    const pool: readonly DraftPoolEntry[] = [...players("QB", 4), ...players("RB", 3), ...players("WR", 2), { playerId: "te1", position: "TE" }];
    const state = midDraftState(SNAKE_CONFIG, pool, { t1: [...LINEUP, "qb2"], t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("qb3");
  });

  it("reads a third back who would start in the flex as a starter: he beats a second quarterback of higher rank", () => {
    const pool: readonly DraftPoolEntry[] = [...players("QB", 2), ...players("RB", 3), ...players("WR", 2), { playerId: "te1", position: "TE" }, ...players("K", 2), ...players("DEF", 2)];
    const state = midDraftState(SNAKE_CONFIG, pool, { t1: ["qb1", "rb1", "rb2", "wr1", "wr2", "te1"], t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("rb3");
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

/**
 * THE LATE-ROUND DEFERRAL, AT THE SELECTOR (the 2026-09-05 kicker and team defence round). The
 * predicate's own cases live in `scoring.test.ts`; these are the three things only `bestAvailableFor`
 * can answer — that an absent field replays the pre-policy pick byte for byte, that the deferral
 * actually changes which player is chosen, and that a board of nothing but deferred candidates still
 * returns one rather than stalling the clock.
 */
describe("the late-round deferral (2026-09-05 kicker and team defence round)", () => {
  /** t1 has every skill starter filled EXCEPT the tight end, and the board's best remaining
   *  candidates are a kicker and a defence ahead of the tight end. Without the deferral the kicker
   *  wins on board order; with it, the tight end does. */
  const KDEF_FIRST_POOL: readonly DraftPoolEntry[] = [
    ...players("QB", 1), ...players("RB", 3), ...players("WR", 2), // t1's own six
    { playerId: "k1", position: "K" }, { playerId: "def1", position: "DEF" },
    { playerId: "te1", position: "TE" },
    ...players("RB", 8, 4), ...players("WR", 8, 3),
  ];
  const SIX_PICK_ROSTER = ["qb1", "rb1", "rb2", "rb3", "wr1", "wr2"];

  /** The identical policy MINUS `lateRoundOnlyRoundsFromEnd` — a hand-built stand-in for a
   *  persisted snapshot written before this round, the same discipline the `surplusDamp` block
   *  above uses. */
  const PRE_POLICY_AUTOPICK = {
    temperature: AUTOPICK_CONFIG.temperature,
    needPerOpenStartingSlot: AUTOPICK_CONFIG.needPerOpenStartingSlot,
    startersFilledDamp: AUTOPICK_CONFIG.startersFilledDamp,
    rampFullAtRosterFraction: AUTOPICK_CONFIG.rampFullAtRosterFraction,
    surplusDamp: AUTOPICK_CONFIG.surplusDamp,
  };

  it("with the policy ABSENT from the snapshot, replays the pre-policy pick: the board-topping kicker wins", () => {
    const legacyConfig: DraftConfig = { ...SNAKE_CONFIG, autopick: PRE_POLICY_AUTOPICK };
    const state = midDraftState(legacyConfig, KDEF_FIRST_POOL, { t1: SIX_PICK_ROSTER, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("k1");
  });

  it("with the policy on the snapshot, passes both over for the tight end the roster still needs", () => {
    const state = midDraftState(SNAKE_CONFIG, KDEF_FIRST_POOL, { t1: SIX_PICK_ROSTER, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("te1");
  });

  it("still returns a pick when every legal candidate is deferred, rather than stalling the clock", () => {
    // The board holds nothing but a kicker and a defence, and t1's tight end slot is still open, so
    // every candidate on it is deferred. The fallback returns the best of them instead of null,
    // which would stall a real room's clock on a turn the engine is obliged to resolve.
    const KDEF_ONLY_POOL: readonly DraftPoolEntry[] = [
      ...players("QB", 1), ...players("RB", 3), ...players("WR", 2),
      { playerId: "k1", position: "K" }, { playerId: "def1", position: "DEF" },
    ];
    const everySkillPlayerTaken = ["qb1", "rb1", "rb2", "rb3", "wr1", "wr2"];
    const state = midDraftState(SNAKE_CONFIG, KDEF_ONLY_POOL, { t1: everySkillPlayerTaken, t2: [] });
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("k1");
  });

  it("takes the kicker once the team is inside the final rounds", () => {
    // Twelve of fifteen slots filled leaves three picks, so the deferral still holds and the open
    // tight end wins. Add a defence and thirteen are filled, two picks left, inside the final two:
    // the deferral lifts and the board-topping kicker wins even though the tight end is still open.
    const DEEP_POOL: readonly DraftPoolEntry[] = [
      ...players("QB", 1), ...players("RB", 6), ...players("WR", 5),
      { playerId: "k1", position: "K" }, { playerId: "def1", position: "DEF" },
      { playerId: "te1", position: "TE" },
    ];
    const twelve = ["qb1", "rb1", "rb2", "rb3", "wr1", "wr2", "rb4", "rb5", "rb6", "wr3", "wr4", "wr5"];
    const thirteen = [...twelve, "def1"];
    expect(bestAvailableFor(midDraftState(SNAKE_CONFIG, DEEP_POOL, { t1: twelve, t2: [] }), "t1")?.playerId).toBe("te1");
    expect(bestAvailableFor(midDraftState(SNAKE_CONFIG, DEEP_POOL, { t1: thirteen, t2: [] }), "t1")?.playerId).toBe("k1");
  });
});
