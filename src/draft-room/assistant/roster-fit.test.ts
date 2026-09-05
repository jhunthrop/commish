import { describe, expect, it } from "vitest";
import { LAW_SPECS } from "@/projections/laws/populations";
import type { Law } from "@/projections/laws/types";
import {
  REACH_THRESHOLD_PICKS,
  byeCollisionFor,
  reachSentence,
  stackNoteFor,
  type ReachInput,
  type StackCandidate,
} from "./roster-fit";

describe("byeCollisionFor", () => {
  it("returns null when the candidate has no known bye week", () => {
    const byeWeeks = new Map<string, number>([["KC", 10]]);
    expect(byeCollisionFor("SF", byeWeeks, ["KC"])).toBeNull();
  });

  it("returns null when nobody on the roster shares the candidate's bye week", () => {
    const byeWeeks = new Map<string, number>([
      ["SF", 9],
      ["KC", 10],
    ]);
    expect(byeCollisionFor("SF", byeWeeks, ["KC"])).toBeNull();
  });

  it("reports the collision count and what drafting him would make it", () => {
    const byeWeeks = new Map<string, number>([
      ["SF", 9],
      ["KC", 9],
      ["DAL", 9],
      ["MIA", 9],
      ["NYJ", 11],
    ]);
    // Three rostered teams already share week 9 with the candidate — he'd make it four.
    expect(byeCollisionFor("SF", byeWeeks, ["KC", "DAL", "MIA", "NYJ"])).toEqual({ week: 9, count: 3, wouldMake: 4 });
  });

  it("counts a single existing collision correctly", () => {
    const byeWeeks = new Map<string, number>([
      ["SF", 9],
      ["KC", 9],
    ]);
    expect(byeCollisionFor("SF", byeWeeks, ["KC"])).toEqual({ week: 9, count: 1, wouldMake: 2 });
  });

  it("ignores roster entries with no known bye week", () => {
    const byeWeeks = new Map<string, number>([["SF", 9]]);
    expect(byeCollisionFor("SF", byeWeeks, ["UNKNOWN"])).toBeNull();
  });
});

describe("reachSentence", () => {
  function input(overrides: Partial<ReachInput>): ReachInput {
    return { candidateAdp: null, currentPick: 1, makeItBack: null, ...overrides };
  }

  it("returns null when the candidate has no market ADP", () => {
    expect(reachSentence(input({ candidateAdp: null, currentPick: 10 }))).toBeNull();
  });

  it("returns null when the gap is below REACH_THRESHOLD_PICKS", () => {
    const gap = REACH_THRESHOLD_PICKS - 1;
    expect(reachSentence(input({ candidateAdp: 10 + gap, currentPick: 10 }))).toBeNull();
  });

  it("fires at exactly REACH_THRESHOLD_PICKS", () => {
    const result = reachSentence(input({ candidateAdp: 10 + REACH_THRESHOLD_PICKS, currentPick: 10, makeItBack: null }));
    expect(result).toBe("The market has him going about 12 picks from now.");
  });

  it("omits the odds sentence when make-it-back odds are unknown, never estimating inline", () => {
    const result = reachSentence(input({ candidateAdp: 40, currentPick: 20, makeItBack: null }));
    expect(result).toBe("The market has him going about 20 picks from now.");
  });

  it("appends the odds sentence, rounded to a whole percent, when odds are known", () => {
    const result = reachSentence(input({ candidateAdp: 40, currentPick: 20, makeItBack: 0.624 }));
    expect(result).toBe(
      "The market has him going about 20 picks from now. Our sims make it 62% he is still here at your next turn.",
    );
  });

  it("rounds the pick gap to a whole number", () => {
    const result = reachSentence(input({ candidateAdp: 32.4, currentPick: 18, makeItBack: null }));
    expect(result).toBe("The market has him going about 14 picks from now.");
  });

  it("formats certain odds as 100%", () => {
    const result = reachSentence(input({ candidateAdp: 40, currentPick: 20, makeItBack: 1 }));
    expect(result).toContain("100%");
  });

  it("never contains an em-dash or a semicolon", () => {
    const result = reachSentence(input({ candidateAdp: 40, currentPick: 20, makeItBack: 0.5 }))!;
    expect(result).not.toMatch(/[—;]/);
  });
});

function makeLaw(overrides: Partial<Law>): Law {
  return {
    id: "test_law",
    position: "all",
    claim: "A made-up claim.",
    measured: { effect: 1.2, ci: [0.5, 1.9], sample: 100, seasons: "2020-2024" },
    trainEffect: 1.2,
    verdict: "confirmed",
    modelPath: null,
    origin: "tribal",
    hasFoldEvidence: true,
    primaryQuantityId: null,
    primaryQuantityNoun: null,
    primaryQuantityUnit: null,
    ...overrides,
  };
}

function player(id: string, position: StackCandidate["position"], nflTeam: string): StackCandidate {
  return { playerId: id, name: id, position, nflTeam };
}

describe("stackNoteFor", () => {
  it("returns null when no law in the registry states a QB and pass-catcher correlation (today's real registry)", () => {
    // Import the ACTUAL registry claim strings (`LAW_SPECS`, built straight from
    // `populations.ts`'s `LAW_ENTRIES` via `claim: entry.claim`) rather than hand-typed
    // paraphrases, so a future wording change in the registry that happened to introduce a real
    // stacking correlation would flip this test red instead of silently drifting out of sync.
    const laws = LAW_SPECS.map((spec) => makeLaw({ claim: spec.claim }));
    expect(laws.length).toBeGreaterThan(0);
    const qb = player("qb1", "QB", "KC");
    const wr = player("wr1", "WR", "KC");
    expect(stackNoteFor(qb, [wr], laws)).toBeNull();
  });

  it("returns null when the laws list is empty", () => {
    const qb = player("qb1", "QB", "KC");
    const wr = player("wr1", "WR", "KC");
    expect(stackNoteFor(qb, [wr], [])).toBeNull();
  });

  it("returns null when a stacking law exists but no roster teammate matches it", () => {
    const laws = [makeLaw({ claim: "A quarterback paired with his own wide receiver gains points per game together." })];
    const qb = player("qb1", "QB", "KC");
    const wrOtherTeam = player("wr1", "WR", "SF");
    expect(stackNoteFor(qb, [wrOtherTeam], laws)).toBeNull();
  });

  it("fires when a stacking law exists and the roster holds the matching teammate on the same team", () => {
    const laws = [makeLaw({ claim: "A quarterback paired with his own wide receiver gains points per game together." })];
    const qb = player("qb1", "QB", "KC");
    const wr = player("wr1", "WR", "KC");
    const note = stackNoteFor(qb, [wr], laws);
    expect(note).not.toBeNull();
    expect(note).toContain("KC");
    expect(note).not.toMatch(/[—;]/);
  });

  it("also matches the pass-catcher's own side of the pairing (TE looking for his QB)", () => {
    const laws = [makeLaw({ claim: "A quarterback paired with his own tight end gains points per game together." })];
    const te = player("te1", "TE", "DAL");
    const qb = player("qb1", "QB", "DAL");
    const note = stackNoteFor(te, [qb], laws);
    expect(note).not.toBeNull();
  });

  it("also matches the pass-catcher's own side of the pairing (WR looking for his QB)", () => {
    const laws = [makeLaw({ claim: "A quarterback paired with his own wide receiver gains points per game together." })];
    const wr = player("wr1", "WR", "DAL");
    const qb = player("qb1", "QB", "DAL");
    const note = stackNoteFor(wr, [qb], laws);
    expect(note).not.toBeNull();
  });

  it("does not suggest a stack for a position pair the law does not cover (RB with QB)", () => {
    const laws = [makeLaw({ claim: "A quarterback paired with his own wide receiver gains points per game together." })];
    const qb = player("qb1", "QB", "KC");
    const rb = player("rb1", "RB", "KC");
    expect(stackNoteFor(rb, [qb], laws)).toBeNull();
  });

  it("does not stitch a TE-specific law's claim onto a mismatched WR teammate", () => {
    const laws = [makeLaw({ claim: "A quarterback paired with his own tight end gains points per game together." })];
    const qb = player("qb1", "QB", "KC");
    const wr = player("wr1", "WR", "KC");
    expect(stackNoteFor(qb, [wr], laws)).toBeNull();
  });

  it("does not stitch a WR-specific law's claim onto a mismatched TE teammate", () => {
    const laws = [makeLaw({ claim: "A quarterback paired with his own wide receiver gains points per game together." })];
    const qb = player("qb1", "QB", "KC");
    const te = player("te1", "TE", "KC");
    expect(stackNoteFor(qb, [te], laws)).toBeNull();
  });

  it("matches either pass-catcher position when the law uses generic pass-catcher wording", () => {
    const laws = [makeLaw({ claim: "A quarterback paired with his own pass-catcher gains points per game together." })];
    const qb = player("qb1", "QB", "KC");
    const te = player("te1", "TE", "KC");
    expect(stackNoteFor(qb, [te], laws)).not.toBeNull();
  });

  it("checks every stacking law in the payload, not just the first, so an earlier mismatched law cannot shadow a real match", () => {
    const laws = [
      makeLaw({ id: "qb_wr_stack", claim: "A quarterback paired with his own wide receiver gains points per game together." }),
      makeLaw({ id: "qb_te_stack", claim: "A quarterback paired with his own tight end gains points per game together." }),
    ];
    const qb = player("qb1", "QB", "KC");
    const te = player("te1", "TE", "KC");
    // Only the second law names TE, and only a TE is on the roster — the WR-specific first law
    // must not consume the search and return null before the TE-specific law is even tried.
    const note = stackNoteFor(qb, [te], laws);
    expect(note).not.toBeNull();
    expect(note).toContain("tight end");
  });
});
