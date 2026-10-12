import { describe, expect, it } from "vitest";
import type { Position } from "@research/domain/player";
import { outlookAround, type ProjectionDistribution } from "./outlook";
import type { ValuedPlayer } from "./replacement";
import { sleepers, type MarketPrice, type SleeperCause } from "./sleepers";

function valued(playerId: string, position: Position, valueOverReplacement: number): ValuedPlayer {
  return {
    playerId,
    position,
    projectedPoints: 100 + valueOverReplacement,
    valueOverReplacement,
    positionRank: 1,
    replacementLevel: 100,
  };
}

/** Our board: 120 men, best first, evenly spaced so a rank maps to a value predictably. */
const OUR_BOARD: readonly ValuedPlayer[] = Array.from({ length: 120 }, (_, index) =>
  valued(`P${index + 1}`, "WR", 200 - index * 1.5),
);

/** The market agrees with us exactly, until a test moves somebody. */
function marketAgreeing(overrides: Readonly<Record<string, number>> = {}): readonly MarketPrice[] {
  return OUR_BOARD.map((player, index) => ({
    playerId: player.playerId,
    averageDraftPosition: overrides[player.playerId] ?? index + 1,
  }));
}

describe("sleepers", () => {
  it("surfaces a man the market has priced far below where we rank him", () => {
    // We have him tenth; the market has him at pick 90.
    const found = sleepers({ board: OUR_BOARD, market: marketAgreeing({ P10: 90 }) });
    expect(found[0]!.playerId).toBe("P10");
    expect(found[0]!.ourRank).toBe(10);
    expect(found[0]!.marketRank).toBeGreaterThan(80);
  });

  it("A STAR IS NOT A SLEEPER: ranking him highly is not disagreeing with anybody", () => {
    // The market has our second-best man third. We like him. So does everyone.
    const found = sleepers({ board: OUR_BOARD, market: marketAgreeing({ P2: 3, P3: 2 }) });
    expect(found.some((sleeper) => sleeper.playerId === "P2")).toBe(false);
  });

  it("cannot exist without both numbers: a man the market never priced is left out", () => {
    const market = marketAgreeing().filter((price) => price.playerId !== "P10");
    const found = sleepers({ board: OUR_BOARD, market });
    expect(found.some((sleeper) => sleeper.playerId === "P10")).toBe(false);
  });

  it("AN UNEXPLAINED DISAGREEMENT RANKS BELOW AN EQUAL ONE WITH A CAUSE", () => {
    // Two identical disagreements. One has a reason drawn from the model; the other is just us.
    // P10 is the BIGGER disagreement of the two and has nothing behind it. P11 is a smaller one
    // with a cause drawn from the model. The explained man still wins.
    const market = marketAgreeing({ P10: 90, P11: 91 });
    const causes: readonly SleeperCause[] = [
      { playerId: "P11", kind: "vacated_opportunity", feature: "targetShare", magnitude: 0.08 },
    ];

    const withoutCauses = sleepers({ board: OUR_BOARD, market });
    expect(withoutCauses[0]!.playerId).toBe("P10");

    const withCauses = sleepers({ board: OUR_BOARD, market, causes });
    const explained = withCauses.find((sleeper) => sleeper.playerId === "P11")!;
    const unexplained = withCauses.find((sleeper) => sleeper.playerId === "P10")!;

    expect(explained.disagreement).toBeLessThan(unexplained.disagreement);
    expect(explained.score).toBeGreaterThan(unexplained.score);
    expect(withCauses[0]!.playerId).toBe("P11");
    expect(explained.causes).toHaveLength(1);
    expect(unexplained.causes).toHaveLength(0);
  });

  it("carries causes through as structured data and invents none of its own", () => {
    const causes: readonly SleeperCause[] = [
      { playerId: "P10", kind: "play_caller_change", feature: "teamPassAttempts", magnitude: 4.2 },
    ];
    const [best] = sleepers({ board: OUR_BOARD, market: marketAgreeing({ P10: 90 }), causes });
    expect(best!.causes).toEqual(causes);
    // Nothing on a sleeper is a sentence: the room renders these.
    for (const cause of best!.causes) {
      expect(cause.kind).toMatch(/^[a-z_]+$/);
      expect(typeof cause.magnitude).toBe("number");
    }
  });

  it("UPSIDE COMES FROM THE DISTRIBUTION, NOT THE MEAN", () => {
    // Identical projections, identical market price, identical disagreement. Only the shape of
    // the two outlooks differs, and only the upside claim moves.
    const market = marketAgreeing({ P10: 90, P11: 91 });
    const distributions = new Map<string, ProjectionDistribution>([
      ["P10", outlookAround(OUR_BOARD[9]!.projectedPoints, 40)],
      ["P11", outlookAround(OUR_BOARD[10]!.projectedPoints, 4)],
    ]);
    const found = sleepers({ board: OUR_BOARD, market, distributions });
    const wide = found.find((sleeper) => sleeper.playerId === "P10")!;
    const narrow = found.find((sleeper) => sleeper.playerId === "P11")!;

    expect(wide.ceilingAbovePrice).toBeGreaterThan(narrow.ceilingAbovePrice!);
    expect(wide.ceilingAbovePrice).toBeGreaterThan(0);
  });

  it("declines the ceiling claim outright when it has no distribution to make it from", () => {
    const [best] = sleepers({ board: OUR_BOARD, market: marketAgreeing({ P10: 90 }) });
    expect(best!.ceilingAbovePrice).toBeNull();
  });

  it("returns nobody when we and the market agree about everybody", () => {
    expect(sleepers({ board: OUR_BOARD, market: marketAgreeing() })).toEqual([]);
  });

  it("holds the list to a length a manager can act on", () => {
    const scattered = marketAgreeing(
      Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`P${index + 1}`, 90 + index])),
    );
    expect(sleepers({ board: OUR_BOARD, market: scattered, limit: 8 })).toHaveLength(8);
  });
});
