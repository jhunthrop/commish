import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlotConfig } from "@/domain/roster";
import { SUPERFLEX_ROSTER_SLOTS } from "@/league/roster-shape";
import { outlookAround } from "./outlook";
import { startSit, type LineupCandidate, type MatchupContext } from "./lineup";

function candidate(
  playerId: string,
  position: Position,
  median: number,
  standardDeviation: number,
): LineupCandidate {
  return { playerId, position, outlook: outlookAround(median, standardDeviation) };
}

/** One receiver spot and a bench. The smallest shape that can express a start-or-sit choice. */
const ONE_RECEIVER: readonly RosterSlotConfig[] = [
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
  { slot: BENCH_SLOT, count: 1, eligiblePositions: ["WR"] },
];

const FAVOURED: MatchupContext = { projectedMargin: 15, opponentStandardDeviation: 20 };
const TRAILING: MatchupContext = { projectedMargin: -15, opponentStandardDeviation: 20 };

describe("startSit", () => {
  it("THE PIN: the same two men, the same projections, and the answer changes with the matchup", () => {
    // Identical expected points. One is steady, one is not. Nothing else differs.
    const candidates = [candidate("steady", "WR", 12, 2.4), candidate("volatile", "WR", 12, 7.8)];

    const ahead = startSit({ candidates, rosterSlots: ONE_RECEIVER, matchup: FAVOURED });
    const behind = startSit({ candidates, rosterSlots: ONE_RECEIVER, matchup: TRAILING });

    expect(ahead.starters[0]!.playerId).toBe("steady");
    expect(behind.starters[0]!.playerId).toBe("volatile");
    // Otherwise it is a ranking wearing a different hat.
    expect(ahead.starters[0]!.playerId).not.toBe(behind.starters[0]!.playerId);
  });

  it("names the reason it changed, as data", () => {
    const candidates = [candidate("steady", "WR", 12, 2.4), candidate("volatile", "WR", 12, 7.8)];
    const ahead = startSit({ candidates, rosterSlots: ONE_RECEIVER, matchup: FAVOURED });
    const behind = startSit({ candidates, rosterSlots: ONE_RECEIVER, matchup: TRAILING });

    expect(ahead.starters[0]!.reasons.map((r) => r.code)).toContain("floor_protects_a_lead");
    expect(behind.starters[0]!.reasons.map((r) => r.code)).toContain("ceiling_chases_a_deficit");
    for (const reason of [...ahead.starters[0]!.reasons, ...behind.starters[0]!.reasons]) {
      for (const [key, value] of Object.entries(reason)) {
        if (key === "code") continue;
        if (typeof value === "string") expect(value).toMatch(/^[A-Z_]+$/);
        else expect(typeof value).toBe("number");
      }
    }
  });

  it("starts the better man when the two are shaped alike, whichever way the matchup runs", () => {
    const candidates = [candidate("better", "WR", 16, 4), candidate("worse", "WR", 11, 4)];
    for (const matchup of [FAVOURED, TRAILING]) {
      const decision = startSit({ candidates, rosterSlots: ONE_RECEIVER, matchup });
      expect(decision.starters[0]!.playerId).toBe("better");
      expect(decision.starters[0]!.reasons.map((r) => r.code)).toContain("highest_expected_points");
    }
  });

  it("fills the narrow slots before the wide ones, which is what makes the lineup the best one", () => {
    // Naive widest-first would put the best back in the flex and leave the worst in the RB slot.
    const slots: readonly RosterSlotConfig[] = [
      { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
      { slot: "RB", count: 1, eligiblePositions: ["RB"] },
      { slot: BENCH_SLOT, count: 3, eligiblePositions: ["RB", "WR", "TE"] },
    ];
    const candidates = [
      candidate("bestBack", "RB", 20, 5),
      candidate("goodReceiver", "WR", 15, 5),
      candidate("weakBack", "RB", 10, 5),
    ];
    const decision = startSit({ candidates, rosterSlots: slots, matchup: FAVOURED });
    const started = new Map(decision.starters.map((s) => [s.slot, s.playerId]));

    expect(started.get("RB")).toBe("bestBack");
    expect(started.get("FLEX")).toBe("goodReceiver");
    expect(decision.bench).toEqual(["weakBack"]);
  });

  it("uses the league's real slots, so a superflex actually takes a quarterback", () => {
    const candidates = [
      candidate("starterQb", "QB", 22, 6),
      candidate("secondQb", "QB", 18, 6),
      candidate("back", "RB", 12, 4),
      candidate("receiverOne", "WR", 13, 4),
      candidate("receiverTwo", "WR", 12, 4),
      candidate("tightEnd", "TE", 9, 3),
      candidate("backTwo", "RB", 8, 4),
      candidate("flexBack", "RB", 7, 4),
    ];
    const decision = startSit({ candidates, rosterSlots: SUPERFLEX_ROSTER_SLOTS, matchup: FAVOURED });
    const started = new Map(decision.starters.map((s) => [s.slot, s.playerId]));

    expect(started.get("QB")).toBe("starterQb");
    expect(started.get("SUPERFLEX")).toBe("secondQb");
  });

  it("leaves a slot empty rather than starting somebody who cannot fill it", () => {
    const decision = startSit({
      candidates: [candidate("onlyReceiver", "WR", 12, 3)],
      rosterSlots: [
        { slot: "WR", count: 1, eligiblePositions: ["WR"] },
        { slot: "TE", count: 1, eligiblePositions: ["TE"] },
        { slot: BENCH_SLOT, count: 1, eligiblePositions: ["WR", "TE"] },
      ],
      matchup: FAVOURED,
    });
    const tightEnd = decision.starters.find((s) => s.slot === "TE")!;
    expect(tightEnd.playerId).toBeNull();
    expect(tightEnd.reasons.map((r) => r.code)).toEqual(["no_eligible_player"]);
  });

  it("reports the chance the lineup it chose actually wins", () => {
    const candidates = [candidate("steady", "WR", 12, 2.4), candidate("volatile", "WR", 12, 7.8)];
    const ahead = startSit({ candidates, rosterSlots: ONE_RECEIVER, matchup: FAVOURED });
    const behind = startSit({ candidates, rosterSlots: ONE_RECEIVER, matchup: TRAILING });
    expect(ahead.winProbability).toBeGreaterThan(0.5);
    expect(behind.winProbability).toBeLessThan(0.5);
  });

  it("refuses a matchup with no uncertainty in it, rather than dividing by nothing", () => {
    expect(() =>
      startSit({
        candidates: [candidate("a", "WR", 12, 0)],
        rosterSlots: ONE_RECEIVER,
        matchup: { projectedMargin: 5, opponentStandardDeviation: 0 },
      }),
    ).toThrow(/spread/);
  });

  it("answers the same twice", () => {
    const query = {
      candidates: [candidate("steady", "WR", 12, 2.4), candidate("volatile", "WR", 12, 7.8)],
      rosterSlots: ONE_RECEIVER,
      matchup: FAVOURED,
    } as const;
    expect(startSit(query)).toEqual(startSit(query));
  });
});
