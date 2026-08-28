import { describe, expect, it } from "vitest";
import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { computeFantasyPoints } from "@/scoring/compute";
import type { LeagueShape } from "../decide/replacement";
import type { GamesPlayedOutlook } from "./availability";
import { byValueOverReplacement, overlapTiers, preseasonBoard, scaleStatLine, type BoardCandidate } from "./board";

const SCORED: readonly Position[] = ["QB", "RB", "WR", "TE"];
const SLOTS: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter(
  (slot) => slot.slot === BENCH_SLOT || slot.eligiblePositions.every((position) => SCORED.includes(position)),
).map((slot) => ({ ...slot, eligiblePositions: slot.eligiblePositions.filter((position) => SCORED.includes(position)) }));
const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: SLOTS };

function line(playerId: string, fields: Partial<StatLine>): StatLine {
  return {
    playerId,
    week: 1,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
    ...fields,
  };
}

function games(expected: number, spread = 2): GamesPlayedOutlook {
  return {
    expected,
    rate: expected / 17,
    distribution: {
      floor: Math.max(0, Math.round(expected - spread)),
      median: Math.round(expected),
      ceiling: Math.min(17, Math.round(expected + spread)),
    },
    probabilities: [],
  };
}

function candidate(
  playerId: string,
  position: Position,
  perGame: Partial<StatLine>,
  expectedGames = 17,
  spread = 2,
): BoardCandidate {
  return { playerId, position, team: "BUF", perGame: line(playerId, perGame), games: games(expectedGames, spread), reasons: [] };
}

/**
 * A pool deep enough that replacement level is a real number at every position, shaped so the two
 * things a board has to get right are both visible in it.
 *
 * QUARTERBACKS OUTSCORE EVERYBODY, by a distance, and there are forty of them against a league that
 * starts twelve. That is the real shape of a fantasy player pool and it is what makes ranking by
 * points wrong.
 *
 * THE RECEIVERS HAVE A CLIFF IN THEM after the third man, because an evenly spaced pool has no
 * cliffs and a tier test run against one would pass whatever the tiering did.
 */
function pool(): BoardCandidate[] {
  const candidates: BoardCandidate[] = [];
  for (let index = 0; index < 40; index += 1) {
    candidates.push(candidate(`qb-${String(index).padStart(2, "0")}`, "QB", { passingYards: 310 - index * 3, passingTouchdowns: 2.4 - index * 0.02 }));
    candidates.push(candidate(`rb-${String(index).padStart(2, "0")}`, "RB", { rushingYards: 90 - index * 2, receptions: 3 - index * 0.05, rushingTouchdowns: 0.7 - index * 0.015 }));
    const elite = index < 3 ? 40 : 0;
    candidates.push(candidate(`wr-${String(index).padStart(2, "0")}`, "WR", { receivingYards: 60 + elite - index * 1.2, receptions: 5 - index * 0.1, receivingTouchdowns: 0.5 - index * 0.01 }));
    candidates.push(candidate(`te-${String(index).padStart(2, "0")}`, "TE", { receivingYards: 55 - index * 1.2, receptions: 4.5 - index * 0.1, receivingTouchdowns: 0.4 - index * 0.009 }));
  }
  return candidates;
}

const OPTIONS = { season: 2024, asOf: new Date("2024-09-01T00:00:00.000Z"), rules: PPR_SCORING, shape: SHAPE } as const;

describe("scaleStatLine", () => {
  it("multiplies every component by the games, and leaves identity alone", () => {
    const perGame = line("a", { receptions: 5, receivingYards: 70, receivingTouchdowns: 0.4 });
    const season = scaleStatLine(perGame, 15);
    expect(season.receptions).toBeCloseTo(75, 10);
    expect(season.receivingYards).toBeCloseTo(1050, 10);
    expect(season.playerId).toBe("a");
  });

  it("composes to the same points either way, which is why scaling components is safe", () => {
    const perGame = line("a", { receptions: 5, receivingYards: 70, receivingTouchdowns: 0.4 });
    expect(computeFantasyPoints(scaleStatLine(perGame, 15), "WR", PPR_SCORING)).toBeCloseTo(
      computeFantasyPoints(perGame, "WR", PPR_SCORING) * 15,
      6,
    );
  });

  it("refuses a games count that is not a finite number", () => {
    expect(() => scaleStatLine(line("a", {}), Number.NaN)).toThrow(/finite number of games/);
    expect(() => scaleStatLine(line("a", {}), -1)).toThrow(/finite number of games/);
  });
});

describe("preseasonBoard", () => {
  const board = preseasonBoard(pool(), OPTIONS);

  it("composes season points as expected games times the per-game line, through the league's rules", () => {
    const entry = board.find((row) => row.playerId === "wr-00")!;
    const perGame = line("wr-00", { receivingYards: 100, receptions: 5, receivingTouchdowns: 0.5 });
    expect(entry.projectedPoints).toBeCloseTo(computeFantasyPoints(perGame, "WR", PPR_SCORING) * 17, 6);
  });

  it("IS ORDERED BY POINTS, because that is the ordering that measured better on both held-out seasons", () => {
    for (let index = 1; index < board.length; index += 1) {
      expect(board[index - 1]!.projectedPoints).toBeGreaterThanOrEqual(board[index]!.projectedPoints);
    }
    expect(board.map((entry) => entry.rank)).toEqual(board.map((_, index) => index + 1));
    expect(preseasonBoard(pool(), OPTIONS)).toEqual(board);
  });

  it("KEEPS VALUE OVER REPLACEMENT AS A LABELLED VIEW — the quarterback case, at board level", () => {
    // The quarterbacks here outscore every back by a distance, and there are forty of them against a
    // league that starts twelve. The points order puts a quarterback first, which is the true answer
    // to "who scores most"; the draft-value view must not, which is the true answer to "what is this
    // pick worth".
    const view = byValueOverReplacement(board);
    expect(board[0]!.position).toBe("QB");
    expect(view[0]!.position).not.toBe("QB");
    expect(view[0]!.valueOverReplacement).toBeGreaterThan(board[0]!.valueOverReplacement);
    for (let index = 1; index < view.length; index += 1) {
      expect(view[index - 1]!.valueOverReplacement).toBeGreaterThanOrEqual(view[index]!.valueOverReplacement);
    }
    expect(view.map((entry) => entry.valueRank)).toEqual(view.map((_, index) => index + 1));
  });

  it("gives the same order under both readings WITHIN a position, which bounds the disagreement", () => {
    // Value over replacement subtracts a constant per position, so it can only change how positions
    // interleave. Everything computed per position is therefore the same under either default.
    const view = byValueOverReplacement(board);
    for (const position of SCORED) {
      const byPoints = board.filter((entry) => entry.position === position).map((entry) => entry.playerId);
      const byValue = view.filter((entry) => entry.position === position).map((entry) => entry.playerId);
      expect(byValue).toEqual(byPoints);
    }
  });

  it("carries a floor and a ceiling that bracket the projection", () => {
    for (const entry of board) {
      expect(entry.outlook.floor).toBeLessThanOrEqual(entry.outlook.median);
      expect(entry.outlook.median).toBeLessThanOrEqual(entry.outlook.ceiling);
    }
  });

  it("MOVES A PLAYER DOWN THE BOARD FOR MISSING GAMES, which is the whole of Task 1 at board level", () => {
    const healthy = pool();
    const injured = healthy.map((entry) =>
      entry.playerId === "wr-00" ? { ...entry, games: games(11) } : entry,
    );
    const before = preseasonBoard(healthy, OPTIONS).find((entry) => entry.playerId === "wr-00")!.rank;
    const after = preseasonBoard(injured, OPTIONS).find((entry) => entry.playerId === "wr-00")!.rank;
    expect(after).toBeGreaterThan(before);
  });

  it("attaches STRUCTURED reasons, never prose, and always says what the scarcity was", () => {
    for (const entry of board) {
      const scarcity = entry.reasons.find((reason) => reason.code === "scarcity");
      expect(scarcity).toBeDefined();
      expect(scarcity).toMatchObject({ positionRank: entry.positionRank, replacementLevel: entry.replacementLevel });
    }
  });

  it("carries a reason a caller handed it, so upstream causes reach the board unchanged", () => {
    const withCause = pool().map((entry) =>
      entry.playerId === "wr-00"
        ? { ...entry, reasons: [{ code: "changed_team", from: "CLE", to: "BUF" } as const] }
        : entry,
    );
    const entry = preseasonBoard(withCause, OPTIONS).find((row) => row.playerId === "wr-00")!;
    expect(entry.reasons).toContainEqual({ code: "changed_team", from: "CLE", to: "BUF" });
  });

  it("puts a cliff where the position falls off, and says how many are left before it", () => {
    const cliffs = board.filter((entry) => entry.dropToNextTier > 0);
    expect(cliffs.length).toBeGreaterThan(0);
    for (const entry of cliffs) {
      expect(entry.playersLeftInTier).toBeGreaterThanOrEqual(1);
      expect(entry.reasons.some((reason) => reason.code === "tier_cliff")).toBe(true);
    }
  });
});

describe("overlapTiers", () => {
  it("breaks a tier where two players' plausible seasons do not intersect", () => {
    const tiers = overlapTiers([
      { value: 200, outlook: { floor: 190, median: 200, ceiling: 210 } },
      { value: 100, outlook: { floor: 90, median: 100, ceiling: 110 } },
    ]);
    expect(tiers).toEqual([0, 1]);
  });

  it("REFUSES to break a tier between two men whose intervals sit on top of each other", () => {
    // A tier line here would be telling a manager something the model does not know, which is the
    // whole objection to a hand-drawn line.
    const tiers = overlapTiers([
      { value: 200, outlook: { floor: 150, median: 200, ceiling: 250 } },
      { value: 198, outlook: { floor: 148, median: 198, ceiling: 248 } },
    ]);
    expect(tiers).toEqual([0, 0]);
  });

  it("answers for an empty pool rather than throwing", () => {
    expect(overlapTiers([])).toEqual([]);
  });
});
