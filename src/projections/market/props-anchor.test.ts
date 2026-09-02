import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import {
  MINIMUM_ANCHORED_PER_POSITION,
  propsAnchorPoints,
  WEEK_ONE_WINDOW_DAYS,
  type ArchivedPropLine,
  type PropsAnchorInputs,
} from "./props-anchor";

const FIRST_KICKOFF = new Date("2023-09-07T20:20:00.000Z");
const WEEK_ONE_GAME = new Date("2023-09-10T17:00:00.000Z");
const BEFORE_KICKOFF = new Date("2023-09-05T12:00:00.000Z");
const AFTER_KICKOFF = new Date("2023-09-08T12:00:00.000Z");
const IMPLIED_GAMES = 15;

function line(overrides: Partial<ArchivedPropLine> = {}): ArchivedPropLine {
  return {
    playerId: "p1",
    market: "player_reception_yds",
    point: 60,
    commenceTime: WEEK_ONE_GAME,
    fetchedAt: BEFORE_KICKOFF,
    ...overrides,
  };
}

/** Enough distinct WRs that the per-position coverage floor is cleared, all priced identically, so a
 *  test can add ONE interesting player and read the scale off the population it already knows. */
function filler(count: number): { lines: ArchivedPropLine[]; ids: string[] } {
  const lines: ArchivedPropLine[] = [];
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const playerId = `filler-${index}`;
    ids.push(playerId);
    lines.push(line({ playerId, point: 60 }));
  }
  return { lines, ids };
}

function inputs(playerIds: readonly string[], overrides: Partial<PropsAnchorInputs> = {}): PropsAnchorInputs {
  const positionByPlayerId = new Map<string, Position>(playerIds.map((id) => [id, "WR" as Position]));
  const marketPointsByPlayerId = new Map<string, number>(playerIds.map((id) => [id, 100]));
  return {
    firstKickoff: FIRST_KICKOFF,
    positionByPlayerId,
    marketPointsByPlayerId,
    impliedGamesByPosition: { QB: IMPLIED_GAMES, RB: IMPLIED_GAMES, WR: IMPLIED_GAMES, TE: IMPLIED_GAMES },
    ...overrides,
  };
}

describe("propsAnchorPoints — THE LEAKAGE GATE", () => {
  it("NEVER admits a line stamped at or after the season's first kickoff", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION);
    const leaked = lines.map((entry) => ({ ...entry, fetchedAt: AFTER_KICKOFF }));
    expect(propsAnchorPoints(leaked, inputs(ids)).size).toBe(0);
  });

  it("refuses a line stamped EXACTLY at kickoff — strictly before, never at", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION);
    const atKickoff = lines.map((entry) => ({ ...entry, fetchedAt: FIRST_KICKOFF }));
    expect(propsAnchorPoints(atKickoff, inputs(ids)).size).toBe(0);
  });

  it("drops ONLY the post-kickoff rows when an archive holds both, and the survivors still anchor", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION);
    const mixed = [...lines, ...lines.map((entry) => ({ ...entry, point: 500, fetchedAt: AFTER_KICKOFF }))];
    const anchored = propsAnchorPoints(mixed, inputs(ids));
    const clean = propsAnchorPoints(lines, inputs(ids));
    expect(anchored.size).toBe(clean.size);
    for (const [playerId, points] of clean) expect(anchored.get(playerId)).toBeCloseTo(points, 9);
  });
});

describe("propsAnchorPoints — the week-one window", () => {
  it("ignores a game kicking off after the week-one window, however early it was priced", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION);
    const week12 = lines.map((entry) => ({
      ...entry,
      commenceTime: new Date(FIRST_KICKOFF.getTime() + (WEEK_ONE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000),
    }));
    expect(propsAnchorPoints(week12, inputs(ids)).size).toBe(0);
  });
});

describe("propsAnchorPoints — the mapping to a season-strength signal", () => {
  it("is ORDER-PRESERVING: a bigger weekly line is a bigger season anchor", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION);
    const strong = line({ playerId: "strong", point: 90 });
    const weak = line({ playerId: "weak", point: 30 });
    const all = [...lines, strong, weak];
    const anchor = propsAnchorPoints(all, inputs([...ids, "strong", "weak"]));
    expect(anchor.get("strong")!).toBeGreaterThan(anchor.get("weak")!);
  });

  it("MEAN-MATCHES the market's own units per position: the anchored population's mean is the market's", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION);
    const anchor = propsAnchorPoints(lines, inputs(ids));
    const total = [...anchor.values()].reduce((sum, value) => sum + value, 0);
    expect(total / anchor.size).toBeCloseTo(100, 6);
  });

  it("sums a player's markets: receptions and receiving yards both count toward one anchor", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION);
    const yardsOnly = line({ playerId: "yards", market: "player_reception_yds", point: 60 });
    const both = [
      line({ playerId: "both", market: "player_reception_yds", point: 60 }),
      line({ playerId: "both", market: "player_receptions", point: 5 }),
    ];
    const anchor = propsAnchorPoints([...lines, yardsOnly, ...both], inputs([...ids, "yards", "both"]));
    expect(anchor.get("both")!).toBeGreaterThan(anchor.get("yards")!);
  });

  it("takes the MEDIAN across books for one player and market, not the mean, so one stale book cannot swing him", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION);
    const median = [
      line({ playerId: "median", point: 59.5 }),
      line({ playerId: "median", point: 60 }),
      line({ playerId: "median", point: 60.5 }),
      line({ playerId: "median", point: 6000 }),
    ];
    const plain = line({ playerId: "plain", point: 60 });
    const anchor = propsAnchorPoints([...lines, ...median, plain], inputs([...ids, "median", "plain"]));
    // Median of [59.5, 60, 60.5, 6000] is 60.25 — a whisker above the plain 60, not a thousand-fold.
    // The ratio reads 6.03/6.00 rather than 60.25/60 because `computeFantasyPoints` rounds a per-game
    // points number to two decimals, which is the engine's own scoring path doing what it always does.
    expect(anchor.get("median")! / anchor.get("plain")!).toBeCloseTo(6.03 / 6, 4);
    expect(anchor.get("median")! / anchor.get("plain")!).toBeLessThan(1.01);
  });
});

describe("propsAnchorPoints — when it declines to anchor at all", () => {
  it("returns an EMPTY map for a season with no archived rows — the null cell, cleanly", () => {
    expect(propsAnchorPoints([], inputs([])).size).toBe(0);
  });

  it("refuses a position with fewer than MINIMUM_ANCHORED_PER_POSITION anchored players", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION - 1);
    expect(propsAnchorPoints(lines, inputs(ids)).size).toBe(0);
  });

  it("drops a player whose position is unknown — never guesses one to scale him by", () => {
    const { lines, ids } = filler(MINIMUM_ANCHORED_PER_POSITION);
    const stranger = line({ playerId: "stranger" });
    const anchor = propsAnchorPoints([...lines, stranger], inputs(ids));
    expect(anchor.has("stranger")).toBe(false);
    expect(anchor.size).toBe(MINIMUM_ANCHORED_PER_POSITION);
  });

  it("scales each position off ITS OWN population, never a pooled one", () => {
    const wr = filler(MINIMUM_ANCHORED_PER_POSITION);
    const rbLines: ArchivedPropLine[] = [];
    const rbIds: string[] = [];
    for (let index = 0; index < MINIMUM_ANCHORED_PER_POSITION; index += 1) {
      const playerId = `rb-${index}`;
      rbIds.push(playerId);
      rbLines.push(line({ playerId, market: "player_rush_yds", point: 40 }));
    }
    const positionByPlayerId = new Map<string, Position>([
      ...wr.ids.map((id) => [id, "WR"] as const),
      ...rbIds.map((id) => [id, "RB"] as const),
    ]);
    const marketPointsByPlayerId = new Map<string, number>([
      ...wr.ids.map((id) => [id, 100] as const),
      ...rbIds.map((id) => [id, 250] as const),
    ]);
    const anchor = propsAnchorPoints([...wr.lines, ...rbLines], inputs([], { positionByPlayerId, marketPointsByPlayerId }));
    expect(anchor.get(wr.ids[0]!)).toBeCloseTo(100, 6);
    expect(anchor.get(rbIds[0]!)).toBeCloseTo(250, 6);
  });
});
