import { describe, expect, it } from "vitest";
import type { FixtureLabel } from "@research/reference/nfl-schedule";
import { STANDARD_ROSTER_SLOTS } from "@research/domain/roster";
import type { LineupBody, LineupSlotView } from "../contract";
import {
  fixCandidates,
  lineupFixPlans,
  lineupProblems,
  startersWithFix,
  type LineupProblemsInput,
} from "./lineup-problems";

const slot = (overrides: Partial<LineupSlotView> & Pick<LineupSlotView, "slot" | "slotIndex">): LineupSlotView => ({
  playerId: null,
  playerName: null,
  position: null,
  nflTeam: null,
  headshotUrl: null,
  adp: null,
  injuryDesignation: null,
  ...overrides,
});

const scheduled: FixtureLabel = { opp: "vs MIN", when: "Sun 1:00p", status: "scheduled" };
const live: FixtureLabel = { opp: "@ NE", when: "Live", status: "in_progress" };

const STARTERS: readonly LineupSlotView[] = [
  slot({ slot: "QB", slotIndex: 0, playerId: "qb1", playerName: "Jordan Love", position: "QB", nflTeam: "GB" }),
  slot({ slot: "WR", slotIndex: 0, playerId: "wr1", playerName: "Puka Nacua", position: "WR", nflTeam: "LAR" }),
  slot({ slot: "WR", slotIndex: 1, playerId: "wr2", playerName: "Zay Flowers", position: "WR", nflTeam: "BAL" }),
];

const BENCH: readonly LineupSlotView[] = [
  slot({
    slot: "BENCH",
    slotIndex: 0,
    playerId: "wr3",
    playerName: "Romeo Doubs",
    position: "WR",
    nflTeam: "GB",
    adp: 90,
  }),
  slot({
    slot: "BENCH",
    slotIndex: 1,
    playerId: "wr4",
    playerName: "Quentin Johnston",
    position: "WR",
    nflTeam: "LAC",
    adp: 120,
  }),
  slot({ slot: "BENCH", slotIndex: 2, playerId: "rb1", playerName: "Tyjae Spears", position: "RB", nflTeam: "TEN" }),
];

const LINEUP: LineupBody = {
  weekNumber: 2,
  locked: false,
  lockedPlayerIds: [],
  starters: STARTERS,
  bench: BENCH,
  injuredReserve: [],
};

// BAL absent: Zay Flowers is on bye.
const FIXTURES = new Map<string, FixtureLabel>([
  ["GB", scheduled],
  ["LAR", scheduled],
  ["LAC", scheduled],
  ["TEN", scheduled],
]);

const PROJECTIONS = new Map<string, number>([
  ["qb1", 21.4],
  ["wr1", 18.2],
  ["wr3", 9.8],
  ["wr4", 6.4],
  ["rb1", 7.9],
]);

const INPUT: LineupProblemsInput = {
  lineup: LINEUP,
  rosterSlots: STANDARD_ROSTER_SLOTS,
  fixturesByNflTeam: FIXTURES,
  projectionsByPlayerId: PROJECTIONS,
  weekStatus: "scheduled",
};

describe("lineupProblems", () => {
  it("reports a starter on bye", () => {
    const problems = lineupProblems(INPUT);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ slot: "WR", slotIndex: 1, reason: "bye", playerName: "Zay Flowers" });
  });

  it("reports an empty slot ahead of a bye", () => {
    const withEmpty: LineupProblemsInput = {
      ...INPUT,
      lineup: { ...LINEUP, starters: [...STARTERS, slot({ slot: "TE", slotIndex: 0 })] },
    };
    const problems = lineupProblems(withEmpty);
    expect(problems.map((problem) => problem.reason)).toEqual(["empty", "bye"]);
  });

  it("reports a starter ruled out", () => {
    const out: LineupProblemsInput = {
      ...INPUT,
      lineup: {
        ...LINEUP,
        starters: [
          ...STARTERS.slice(0, 2),
          slot({
            slot: "WR",
            slotIndex: 1,
            playerId: "wr2",
            playerName: "Zay Flowers",
            position: "WR",
            nflTeam: "GB",
            injuryDesignation: "O",
          }),
        ],
      },
    };
    expect(lineupProblems(out)[0]?.reason).toBe("out");
  });

  it("a questionable starter is not a problem", () => {
    const questionable: LineupProblemsInput = {
      ...INPUT,
      lineup: {
        ...LINEUP,
        starters: STARTERS.map((s) =>
          s.playerId === "wr2" ? { ...s, nflTeam: "GB", injuryDesignation: "Q" } : s,
        ),
      },
    };
    expect(lineupProblems(questionable)).toHaveLength(0);
  });

  it("says nothing once the week is final", () => {
    expect(lineupProblems({ ...INPUT, weekStatus: "final" })).toHaveLength(0);
  });

  it("skips a slot whose occupant already kicked off", () => {
    expect(lineupProblems({ ...INPUT, lineup: { ...LINEUP, lockedPlayerIds: ["wr2"] } })).toHaveLength(0);
  });
});

describe("fixCandidates", () => {
  const problem = lineupProblems(INPUT)[0]!;

  it("ranks eligible bench players by this week's projection, best first", () => {
    const candidates = fixCandidates(problem, INPUT);
    expect(candidates.map((candidate) => candidate.playerId)).toEqual(["wr3", "wr4"]);
    expect(candidates[0]?.delta).toBe(9.8);
  });

  it("excludes positions the slot cannot take", () => {
    const candidates = fixCandidates(problem, INPUT);
    expect(candidates.some((candidate) => candidate.playerId === "rb1")).toBe(false);
  });

  it("a FLEX slot takes RB, WR and TE", () => {
    const flexProblem = { ...problem, slot: "FLEX" as const };
    const ids = fixCandidates(flexProblem, INPUT).map((candidate) => candidate.playerId);
    expect(ids).toContain("rb1");
    expect(ids).toContain("wr3");
  });

  it("excludes a bench player on bye", () => {
    const fixtures = new Map(FIXTURES);
    fixtures.delete("GB");
    // Losing GB also puts the QB on bye; only the candidate list is under test here.
    const ids = fixCandidates(problem, { ...INPUT, fixturesByNflTeam: fixtures }).map((c) => c.playerId);
    expect(ids).toEqual(["wr4"]);
  });

  it("excludes a bench player whose game already kicked off", () => {
    const fixtures = new Map(FIXTURES);
    fixtures.set("GB", live);
    const ids = fixCandidates(problem, { ...INPUT, fixturesByNflTeam: fixtures }).map((c) => c.playerId);
    expect(ids).toEqual(["wr4"]);
  });

  it("excludes a bench player ruled out", () => {
    const bench = BENCH.map((s) => (s.playerId === "wr3" ? { ...s, injuryDesignation: "O" } : s));
    const ids = fixCandidates(problem, { ...INPUT, lineup: { ...LINEUP, bench } }).map((c) => c.playerId);
    expect(ids).toEqual(["wr4"]);
  });

  it("falls back to ADP order when the projection snapshot is empty", () => {
    const ids = fixCandidates(problem, { ...INPUT, projectionsByPlayerId: new Map() }).map((c) => c.playerId);
    expect(ids).toEqual(["wr3", "wr4"]);
  });
});

describe("lineupFixPlans", () => {
  it("states the projected total before and after the recommended fix", () => {
    const plan = lineupFixPlans(INPUT)[0]!;
    expect(plan.hasProjections).toBe(true);
    expect(plan.totalBefore).toBeCloseTo(21.4 + 18.2);
    expect(plan.totalAfter).toBeCloseTo(21.4 + 18.2 + 9.8);
  });

  it("states no totals when the projection snapshot is empty", () => {
    const plan = lineupFixPlans({ ...INPUT, projectionsByPlayerId: new Map() })[0]!;
    expect(plan.hasProjections).toBe(false);
    expect(plan.totalBefore).toBeNull();
    expect(plan.totalAfter).toBeNull();
  });

  it("hands back an empty candidate list rather than inventing a fix", () => {
    const noBench: LineupProblemsInput = { ...INPUT, lineup: { ...LINEUP, bench: [] } };
    const plan = lineupFixPlans(noBench)[0]!;
    expect(plan.candidates).toHaveLength(0);
    expect(plan.totalAfter).toBeNull();
  });
});

describe("startersWithFix", () => {
  it("puts the chosen player in the broken slot and touches nothing else", () => {
    const problem = lineupProblems(INPUT)[0]!;
    const slots = startersWithFix(LINEUP, problem, "wr3");
    expect(slots).toEqual([
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "WR", slotIndex: 0, playerId: "wr1" },
      { slot: "WR", slotIndex: 1, playerId: "wr3" },
    ]);
  });
});
