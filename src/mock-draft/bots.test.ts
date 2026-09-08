import { describe, expect, it } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import {
  DRAFT_CLOCK_SCHEDULE,
  assignSlot,
  availablePool,
  initialDraftState,
  isComplete,
  rosterFor,
  teamOnClock,
  totalRosterSlots,
  type DraftConfig,
  type DraftState,
} from "@/draft-engine";
import { submitCommand } from "@/draft-engine/test-support";
import { MS_PER_SECOND } from "@/domain/duration";
import { BOT_ARCHETYPES, assignArchetypes, type BotArchetype } from "./archetypes";
import { botCandidateWeights, botThinkDelayMs, chooseBotPick, expectedBotThinkDelaySeconds } from "./bots";
import { MOCK_CONFIG } from "./config";
import { rngFor } from "./rng";

const TEAMS = Array.from({ length: 12 }, (_, i) => `bot${String(i + 1).padStart(2, "0")}`);

/**
 * A 250-player pool with a realistic position mix, ranked by proportional depth within each
 * position bucket — the same fixture shape `src/draft-engine/full-draft.test.ts` builds, and
 * for the same reason: a fixed round-robin wave would resonate with a 12-team snake order and
 * starve some teams of K/DEF entirely before the pool runs out.
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

const POSITION_OF = new Map(POOL.map((entry) => [entry.playerId, entry.position]));

const T = "2026-09-01T00:00:00.000Z";
const START: StartDraftAction = { v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: TEAMS, pool: POOL };
const CONFIG: DraftConfig = {
  draftId: "d_mock", leagueId: "l_mock", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: STANDARD_ROSTER_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

function archetypeNamed(name: string): BotArchetype {
  const found = BOT_ARCHETYPES.find((a) => a.name === name);
  if (found === undefined) throw new Error(`no archetype named ${name}`);
  return found;
}

function apply(state: DraftState, action: Parameters<typeof submitCommand>[1]): DraftState {
  const result = submitCommand(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.reason}`);
  return result.state;
}

/**
 * Drives a whole 12-team snake draft with every seat a bot: archetypes dealt from the draft
 * seed, one pick stream per bot, every pick submitted through the REAL admit+reduce path —
 * the same legality oracle production uses. `onPick` sees each choice before it is applied,
 * so property suites can assert against the exact state the bot chose from.
 */
function runFullMockDraft(seed: number, onPick?: (state: DraftState, teamId: string, playerId: string) => void): { readonly pickLog: readonly string[]; readonly state: DraftState } {
  const archetypes = assignArchetypes(seed, TEAMS);
  const streams = new Map(TEAMS.map((teamId) => [teamId, rngFor(seed, teamId)]));
  let state = apply(initialDraftState(CONFIG), START);
  const pickLog: string[] = [];
  while (!isComplete(state)) {
    const teamId = teamOnClock(state);
    if (teamId === null) throw new Error("no team on the clock mid-draft");
    const archetype = archetypes[teamId];
    const stream = streams.get(teamId);
    if (archetype === undefined || stream === undefined) throw new Error(`no brain or stream for ${teamId}`);
    const playerId = chooseBotPick(state, teamId, archetype, stream);
    if (playerId === null) throw new Error(`bot ${teamId} found no pick at pick ${state.pickNumber}`);
    onPick?.(state, teamId, playerId);
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId, playerId });
    pickLog.push(playerId);
  }
  return { pickLog, state };
}

/** A minimal in-progress state for direct `chooseBotPick` unit tests — hand-built, engine-shaped. */
function stateWith(pool: readonly DraftPoolEntry[], overrides: Partial<DraftState> = {}): DraftState {
  return { ...initialDraftState(CONFIG), phase: "in_progress", draftOrder: ["bot01"], pool, ...overrides };
}

function positionRate(state: DraftState, archetype: BotArchetype, position: Position, draws: number): number {
  let hits = 0;
  for (let seed = 1; seed <= draws; seed++) {
    const playerId = chooseBotPick(state, "bot01", archetype, rngFor(seed, "bot01"));
    if (playerId !== null && POSITION_OF.get(playerId) === position) hits += 1;
  }
  return hits / draws;
}

describe("chooseBotPick over whole drafts (the property harness)", () => {
  it("always returns a pick the engine accepts, filling every roster completely and legally", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { state } = runFullMockDraft(seed);
      expect(state.phase).toBe("complete");
      expect(state.picks).toHaveLength(TEAMS.length * totalRosterSlots(STANDARD_ROSTER_SLOTS));
      expect(new Set(state.picks.map((p) => p.playerId)).size).toBe(state.picks.length);
      for (const teamId of TEAMS) {
        expect(rosterFor(state, teamId)).toHaveLength(totalRosterSlots(STANDARD_ROSTER_SLOTS));
      }
    }
  });

  it("is deterministic under a fixed seed and varied across seeds", () => {
    const a = runFullMockDraft(7);
    const b = runFullMockDraft(7);
    const c = runFullMockDraft(8);
    expect(a.pickLog).toEqual(b.pickLog);
    expect(a.pickLog).not.toEqual(c.pickLog);
  });

  it("varies measurably across many seeds without any pick being asserted", () => {
    const seeds = Array.from({ length: 20 }, (_, i) => 100 + i);
    const logs = seeds.map((seed) => runFullMockDraft(seed).pickLog);
    // Every one of the twenty seeded drafts unfolds differently...
    expect(new Set(logs.map((log) => JSON.stringify(log))).size).toBe(seeds.length);
    // ...and the variety starts at the very first pick, not deep in the tail.
    expect(new Set(logs.map((log) => log[0])).size).toBeGreaterThan(1);
  });

  it("never reaches past the configured depth, at any pick of any seeded draft", () => {
    for (const seed of [11, 12]) {
      runFullMockDraft(seed, (state, teamId, playerId) => {
        const roster = rosterFor(state, teamId);
        const eligible = availablePool(state).filter(
          (entry) => assignSlot({ position: entry.position, roster, slotConfig: state.config.slotConfig }).ok,
        );
        const index = eligible.findIndex((entry) => entry.playerId === playerId);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(MOCK_CONFIG.strategy.reachDepth);
      });
    }
  });
});

describe("the reach cap boundary", () => {
  const wrs = (count: number): readonly DraftPoolEntry[] =>
    Array.from({ length: count }, (_, i) => ({ playerId: `wr${i + 1}`, position: "WR" }));

  it("never takes even the archetype's favorite position from one spot past the depth", () => {
    const state = stateWith([...wrs(MOCK_CONFIG.strategy.reachDepth), { playerId: "qb1", position: "QB" }]);
    const rng = rngFor(1, "bot01");
    for (let i = 0; i < 300; i++) {
      expect(chooseBotPick(state, "bot01", archetypeNamed("qb_early"), rng)).not.toBe("qb1");
    }
  });

  it("does take that same player from the depth's inside edge", () => {
    const state = stateWith([...wrs(MOCK_CONFIG.strategy.reachDepth - 1), { playerId: "qb1", position: "QB" }]);
    const rng = rngFor(1, "bot01");
    const picks = new Set(Array.from({ length: 300 }, () => chooseBotPick(state, "bot01", archetypeNamed("qb_early"), rng)));
    expect(picks).toContain("qb1");
  });
});

describe("positional need", () => {
  const qbWrPool: readonly DraftPoolEntry[] = [
    { playerId: "qb1", position: "QB" }, { playerId: "wr1", position: "WR" },
    { playerId: "qb2", position: "QB" }, { playerId: "wr2", position: "WR" },
    { playerId: "qb3", position: "QB" }, { playerId: "wr3", position: "WR" },
    { playerId: "qb4", position: "QB" }, { playerId: "wr4", position: "WR" },
  ];

  it("warms toward a starting slot still open and cools once it fills — derived from the roster, never stored", () => {
    const empty = stateWith(qbWrPool);
    const qbFilled = stateWith(qbWrPool, { rosters: { bot01: [{ slot: "QB", slotIndex: 0, playerId: "x_qb" }] } });
    const needFiller = archetypeNamed("need_filler");
    expect(positionRate(empty, needFiller, "QB", 400)).toBeGreaterThan(positionRate(qbFilled, needFiller, "QB", 400));
  });

  it("cools on a position whose starters are already rostered, even though FLEX and bench still accept it", () => {
    const rbWrPool: readonly DraftPoolEntry[] = [
      { playerId: "rb1", position: "RB" }, { playerId: "wr1", position: "WR" },
      { playerId: "rb2", position: "RB" }, { playerId: "wr2", position: "WR" },
      { playerId: "rb3", position: "RB" }, { playerId: "wr3", position: "WR" },
    ];
    const empty = stateWith(rbWrPool);
    const rbHeavyRoster = stateWith(rbWrPool, {
      rosters: { bot01: [{ slot: "RB", slotIndex: 0, playerId: "x_rb1" }, { slot: "RB", slotIndex: 1, playerId: "x_rb2" }] },
    });
    const bestAvailable = archetypeNamed("best_available");
    expect(positionRate(rbHeavyRoster, bestAvailable, "RB", 400)).toBeLessThan(positionRate(empty, bestAvailable, "RB", 400));
  });
});

describe("run reaction", () => {
  function afterScriptedPicks(playerIds: readonly string[]): DraftState {
    let state = apply(initialDraftState(CONFIG), START);
    playerIds.forEach((playerId, i) => {
      state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: TEAMS[i] as string, playerId });
    });
    return state;
  }

  function rbRateOnClock(state: DraftState, archetype: BotArchetype): number {
    let hits = 0;
    const draws = 200;
    for (let seed = 1; seed <= draws; seed++) {
      const playerId = chooseBotPick(state, TEAMS[4] as string, archetype, rngFor(seed, TEAMS[4] as string));
      if (playerId !== null && POSITION_OF.get(playerId) === "RB") hits += 1;
    }
    return hits / draws;
  }

  // Three of the last four picks are RB — `strategy.runReaction.threshold` exactly met — versus
  // a calm room where the same four turns spent themselves across four positions. Both scripts
  // draft DEEP players on purpose: the two boards then share an identical top, so the measured
  // difference is the recent-picks window alone, not board composition.
  const runState = afterScriptedPicks(["rb68", "rb69", "rb70", "wr78"]);
  const calmState = afterScriptedPicks(["qb28", "wr78", "te28", "k18"]);

  it("spikes the run follower toward the position being run on — a statistical margin over 200 seeds, never an exact count", () => {
    const follower = archetypeNamed("run_follower");
    expect(rbRateOnClock(runState, follower)).toBeGreaterThan(rbRateOnClock(calmState, follower) + 0.1);
  });

  it("tilts every archetype mildly, the founder's real-world scenario", () => {
    const bestAvailable = archetypeNamed("best_available");
    expect(rbRateOnClock(runState, bestAvailable)).toBeGreaterThan(rbRateOnClock(calmState, bestAvailable));
  });

  it("panics the follower harder than the room's baseline brain", () => {
    expect(rbRateOnClock(runState, archetypeNamed("run_follower"))).toBeGreaterThan(rbRateOnClock(runState, archetypeNamed("best_available")));
  });
});

describe("queue preference (the same order autopick honors)", () => {
  const pool: readonly DraftPoolEntry[] = Array.from({ length: 10 }, (_, i) => ({ playerId: `wr${i + 1}`, position: "WR" }));

  it("takes a legal queued player outright, however deep on the board he sits", () => {
    const state = stateWith(pool, { queues: { bot01: ["wr9"] } });
    expect(chooseBotPick(state, "bot01", archetypeNamed("best_available"), rngFor(1, "bot01"))).toBe("wr9");
  });

  it("skips a queued player somebody already drafted and samples the board instead", () => {
    const state = stateWith(pool, {
      queues: { bot01: ["wr1"] },
      picks: [{ pickNumber: 1, round: 1, teamId: "bot02", playerId: "wr1", slot: "WR", slotIndex: 0, price: null, timestamp: T, auto: false }],
    });
    const playerId = chooseBotPick(state, "bot01", archetypeNamed("best_available"), rngFor(1, "bot01"));
    expect(playerId).not.toBe("wr1");
    expect(playerId).not.toBeNull();
  });

  it("skips a queued player this league cannot roster and samples what it can", () => {
    const oneSlotConfig: DraftConfig = { ...CONFIG, slotConfig: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }] };
    const state: DraftState = {
      ...initialDraftState(oneSlotConfig),
      phase: "in_progress",
      draftOrder: ["bot01"],
      pool: [{ playerId: "def1", position: "DEF" }, { playerId: "qb1", position: "QB" }],
      queues: { bot01: ["def1"] },
    };
    expect(chooseBotPick(state, "bot01", archetypeNamed("best_available"), rngFor(1, "bot01"))).toBe("qb1");
  });
});

describe("the empty board", () => {
  it("returns null when nothing is left to draft", () => {
    expect(chooseBotPick(stateWith([]), "bot01", archetypeNamed("best_available"), rngFor(1, "bot01"))).toBeNull();
  });
});

describe("botThinkDelayMs", () => {
  const { baseMs, jitterMs, maxFractionOfClock } = MOCK_CONFIG.botDelay;
  const capMs = (clockSeconds: number): number => Math.min(baseMs + jitterMs, clockSeconds * MS_PER_SECOND * maxFractionOfClock);

  it("stays inside base plus or minus jitter for every offered clock", () => {
    for (const clockSeconds of MOCK_CONFIG.pickClockSecondsOptions) {
      const rng = rngFor(9, "delay");
      for (let i = 0; i < 200; i++) {
        const delay = botThinkDelayMs(clockSeconds, rng);
        expect(delay).toBeGreaterThanOrEqual(baseMs - jitterMs);
        expect(delay).toBeLessThanOrEqual(capMs(clockSeconds));
      }
    }
  });

  it("derives the identical delay from the identical stream, and a different one from another pick's stream", () => {
    expect(botThinkDelayMs(60, rngFor(3, "pick_1"))).toBe(botThinkDelayMs(60, rngFor(3, "pick_1")));
    expect(botThinkDelayMs(60, rngFor(3, "pick_1"))).not.toBe(botThinkDelayMs(60, rngFor(3, "pick_2")));
  });

  // Task 10's persona checkpoint, finding 1: the room's own wait estimate needs the delay
  // draw's honest center — the same bounds as the draw itself, never a second literal.
  it("expectedBotThinkDelaySeconds is the midpoint of the draw's own interval, in seconds", () => {
    for (const clockSeconds of MOCK_CONFIG.pickClockSecondsOptions) {
      expect(expectedBotThinkDelaySeconds(clockSeconds)).toBe((baseMs - jitterMs + capMs(clockSeconds)) / 2 / MS_PER_SECOND);
    }
    // a clock short enough to bind the fraction cap shrinks the expectation with it
    expect(expectedBotThinkDelaySeconds(1)).toBe((baseMs - jitterMs + 1 * MS_PER_SECOND * maxFractionOfClock) / 2 / MS_PER_SECOND);
  });

  it("actually varies across a stream, so a room's cadence never metronomes", () => {
    const rng = rngFor(4, "cadence");
    const delays = new Set(Array.from({ length: 20 }, () => botThinkDelayMs(60, rng)));
    expect(delays.size).toBeGreaterThan(1);
  });
});

// The advisor's opponent model (draft advisor round, spec 3.1a) infers a seat's archetype from
// the likelihood the sampler would have made that seat's observed picks — which is exactly these
// weights. Exported so the inference reads the ONE sampler rather than a second scoring rule.
describe("botCandidateWeights", () => {
  it("returns the top eligible candidates in board order with a positive weight each, summing to what chooseBotPick samples from", () => {
    const state = apply(initialDraftState(CONFIG), START);
    const teamId = teamOnClock(state)!;
    const rows = botCandidateWeights(state, teamId, archetypeNamed("best_available"));
    expect(rows.length).toBe(MOCK_CONFIG.strategy.reachDepth);
    expect(rows.map((row) => row.playerId)).toEqual(POOL.slice(0, MOCK_CONFIG.strategy.reachDepth).map((entry) => entry.playerId));
    for (const row of rows) expect(row.weight).toBeGreaterThan(0);
    // Board order decays: the first candidate always outweighs the last under a neutral brain.
    expect(rows[0]!.weight).toBeGreaterThan(rows[rows.length - 1]!.weight);
  });

  it("a position-biased brain weighs that position's candidates heavier than the neutral brain does", () => {
    const state = apply(initialDraftState(CONFIG), START);
    const teamId = teamOnClock(state)!;
    const neutral = new Map(botCandidateWeights(state, teamId, archetypeNamed("best_available")).map((row) => [row.playerId, row.weight]));
    const qbEarly = botCandidateWeights(state, teamId, archetypeNamed("qb_early"));
    const qbRow = qbEarly.find((row) => POSITION_OF.get(row.playerId) === "QB");
    expect(qbRow).toBeDefined();
    expect(qbRow!.weight).toBeGreaterThan(neutral.get(qbRow!.playerId)!);
  });

  it("chooseBotPick only ever returns a player these weights name", () => {
    const state = apply(initialDraftState(CONFIG), START);
    const teamId = teamOnClock(state)!;
    const named = new Set(botCandidateWeights(state, teamId, archetypeNamed("rb_heavy")).map((row) => row.playerId));
    for (let seed = 1; seed <= 25; seed++) {
      expect(named.has(chooseBotPick(state, teamId, archetypeNamed("rb_heavy"), rngFor(seed, teamId))!)).toBe(true);
    }
  });
});
