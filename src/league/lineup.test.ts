import { describe, it, expect } from "vitest";
import { STANDARD_ROSTER_SLOTS, type RosterSlot } from "@research/domain/roster";
import { validateLineup } from "@research/domain/roster-eligibility";
import { SUPERFLEX_ROSTER_SLOTS } from "@research/domain/roster-shape";
import { benchOf, defaultLineup, setSlotPlayer, startersOf } from "./lineup";

const SLOTS = [
  { slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] },
  { slot: "RB" as const, count: 2, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["QB" as const, "RB" as const] },
];

const roster: readonly RosterSlot[] = [
  { slot: "QB", slotIndex: 0, playerId: "qb1" },
  { slot: "RB", slotIndex: 0, playerId: "rb1" },
  { slot: "BENCH", slotIndex: 0, playerId: "rb2" },
];

describe("defaultLineup", () => {
  it("expands the league's declared shape and fills what the roster holds", () => {
    expect(defaultLineup(SLOTS, roster)).toEqual([
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "RB", slotIndex: 0, playerId: "rb1" },
      { slot: "RB", slotIndex: 1, playerId: null },
      { slot: "BENCH", slotIndex: 0, playerId: "rb2" },
    ]);
  });

  it("keeps an explicitly empty roster spot empty", () => {
    const withHole: readonly RosterSlot[] = [{ slot: "QB", slotIndex: 0, playerId: null }];
    expect(defaultLineup(SLOTS, withHole)[0]).toEqual({ slot: "QB", slotIndex: 0, playerId: null });
  });
});

describe("setSlotPlayer", () => {
  const lineup = defaultLineup(SLOTS, roster);

  it("fills an empty slot and empties the one the player came from", () => {
    expect(setSlotPlayer(lineup, "RB", 1, "rb2")).toEqual([
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "RB", slotIndex: 0, playerId: "rb1" },
      { slot: "RB", slotIndex: 1, playerId: "rb2" },
      { slot: "BENCH", slotIndex: 0, playerId: null },
    ]);
  });

  it("swaps when the target slot is already taken", () => {
    expect(setSlotPlayer(lineup, "RB", 0, "rb2")).toEqual([
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "RB", slotIndex: 0, playerId: "rb2" },
      { slot: "RB", slotIndex: 1, playerId: null },
      { slot: "BENCH", slotIndex: 0, playerId: "rb1" },
    ]);
  });

  it("clears a slot when given null, and never places the same player twice", () => {
    const cleared = setSlotPlayer(lineup, "QB", 0, null);
    expect(cleared[0]).toEqual({ slot: "QB", slotIndex: 0, playerId: null });
    const ids = setSlotPlayer(lineup, "RB", 1, "rb1").map((s) => s.playerId).filter((id) => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves a player where they already are", () => {
    expect(setSlotPlayer(lineup, "RB", 0, "rb1")).toEqual(lineup);
  });

  it("is a no-op for a slot the league does not have, and never mutates", () => {
    expect(setSlotPlayer(lineup, "TE", 0, "rb2")).toEqual(lineup);
    expect(lineup[3]).toEqual({ slot: "BENCH", slotIndex: 0, playerId: "rb2" });
  });
});

describe("startersOf and benchOf", () => {
  it("split the lineup on the bench slot", () => {
    const lineup = defaultLineup(SLOTS, roster);
    expect(startersOf(lineup).map((s) => s.slot)).toEqual(["QB", "RB", "RB"]);
    expect(benchOf(lineup).map((s) => s.playerId)).toEqual(["rb2"]);
  });
});

describe("the lineups this module produces", () => {
  const positions: Readonly<Record<string, string>> = {
    qb1: "QB", rb1: "RB", rb2: "RB", rb3: "RB", wr1: "WR", wr2: "WR", wr3: "WR", te1: "TE", k1: "K", def1: "DEF",
  };
  const fullRoster: readonly RosterSlot[] = [
    { slot: "QB", slotIndex: 0, playerId: "qb1" },
    { slot: "RB", slotIndex: 0, playerId: "rb1" },
    { slot: "RB", slotIndex: 1, playerId: "rb2" },
    { slot: "WR", slotIndex: 0, playerId: "wr1" },
    { slot: "WR", slotIndex: 1, playerId: "wr2" },
    { slot: "TE", slotIndex: 0, playerId: "te1" },
    { slot: "FLEX", slotIndex: 0, playerId: "wr3" },
    { slot: "K", slotIndex: 0, playerId: "k1" },
    { slot: "DEF", slotIndex: 0, playerId: "def1" },
    { slot: "BENCH", slotIndex: 0, playerId: "rb3" },
  ];

  it("are lineups the domain's own eligibility rules accept, before and after an edit", () => {
    const lineup = defaultLineup(STANDARD_ROSTER_SLOTS, fullRoster);
    const check = (entries: readonly RosterSlot[]) =>
      validateLineup({ slotConfig: STANDARD_ROSTER_SLOTS, roster: entries, playerPositions: positions });

    expect(check(startersOf(lineup))).toEqual({ valid: true });
    // Swapping the FLEX starter for the benched RB keeps every starting slot legal.
    expect(check(startersOf(setSlotPlayer(lineup, "FLEX", 0, "rb3")))).toEqual({ valid: true });
  });
});

/** SUPERFLEX (Task 1) — the season's half of the same eligibility proof `slotting.test.ts` carries for the draft. */
describe("the lineups this module produces, with a superflex shape", () => {
  const positions: Readonly<Record<string, string>> = {
    qb1: "QB", qb2: "QB", rb1: "RB", rb2: "RB", wr1: "WR", wr2: "WR", wr3: "WR", te1: "TE", k1: "K", def1: "DEF",
  };
  const superflexStarters = (): readonly RosterSlot[] => [
    { slot: "QB", slotIndex: 0, playerId: "qb1" },
    { slot: "RB", slotIndex: 0, playerId: "rb1" },
    { slot: "RB", slotIndex: 1, playerId: "rb2" },
    { slot: "WR", slotIndex: 0, playerId: "wr1" },
    { slot: "WR", slotIndex: 1, playerId: "wr2" },
    { slot: "TE", slotIndex: 0, playerId: "te1" },
    { slot: "FLEX", slotIndex: 0, playerId: "wr3" },
    { slot: "SUPERFLEX", slotIndex: 0, playerId: "qb2" },
    { slot: "K", slotIndex: 0, playerId: "k1" },
    { slot: "DEF", slotIndex: 0, playerId: "def1" },
  ];
  const withSlot = (starters: readonly RosterSlot[], slot: RosterSlot["slot"], playerId: string): readonly RosterSlot[] =>
    starters.map((entry) => (entry.slot === slot ? { ...entry, playerId } : entry));

  it("accepts a quarterback started in SUPERFLEX", () => {
    expect(validateLineup({ slotConfig: SUPERFLEX_ROSTER_SLOTS, roster: superflexStarters(), playerPositions: positions }))
      .toEqual({ valid: true });
  });

  it("refuses a kicker in SUPERFLEX, and says which positions it takes", () => {
    const result = validateLineup({
      slotConfig: SUPERFLEX_ROSTER_SLOTS,
      roster: withSlot(superflexStarters(), "SUPERFLEX", "k1"),
      playerPositions: positions,
    });
    expect(result).toMatchObject({ valid: false, reason: expect.stringContaining("SUPERFLEX") });
  });
});
