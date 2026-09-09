import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { MissingModelArtifactError, publishModelArtifact } from "../model/artifacts";
import { VARIANCE_POSITIONS, type GameVariancePriors } from "./game-variance";
import {
  composeGameVariance,
  GAME_VARIANCE_KDEF_ARTIFACT,
  GAME_VARIANCE_SKILL_ARTIFACT,
  loadShippedGameVariance,
  parseGameVariancePriors,
} from "./game-variance-artifacts";

const db = createTestDb();

const SKILL: GameVariancePriors = {
  rookie: { QB: 51.11, RB: 34.02, WR: 30.78, TE: 22.39 },
  veteran: { QB: 50.9, RB: 31.1, WR: 35.78, TE: 21.75 },
};
const KDEF: GameVariancePriors = { rookie: { K: 13.4, DEF: 35.93 }, veteran: { K: 13.4, DEF: 35.93 } };
const PROVENANCE = { fitStamp: new Date("2026-09-05T00:00:00.000Z"), fittedOn: "a test window" };

describe("parseGameVariancePriors", () => {
  it("accepts a partial table with finite, non-negative cells at known positions", () => {
    expect(parseGameVariancePriors(SKILL)).toEqual(SKILL);
    expect(parseGameVariancePriors({ rookie: {}, veteran: { K: 0 } })).toEqual({ rookie: {}, veteran: { K: 0 } });
  });

  it("names what it refuses: a missing class, an unknown position, a non-finite or negative cell", () => {
    expect(() => parseGameVariancePriors({ rookie: {} })).toThrow(/veteran/);
    expect(() => parseGameVariancePriors({ rookie: { FB: 1 }, veteran: {} })).toThrow(/FB/);
    expect(() => parseGameVariancePriors({ rookie: { QB: Number.NaN }, veteran: {} })).toThrow(/rookie\.QB/);
    expect(() => parseGameVariancePriors({ rookie: { QB: -1 }, veteran: {} })).toThrow(/rookie\.QB/);
    expect(() => parseGameVariancePriors(null)).toThrow(/object/);
    expect(() => parseGameVariancePriors({ rookie: [], veteran: {} })).toThrow(/rookie/);
  });
});

describe("composeGameVariance", () => {
  it("lays the two halves side by side and leaves every cell exactly as its own fit produced it", () => {
    const composed = composeGameVariance(SKILL, KDEF);
    for (const playerClass of ["rookie", "veteran"] as const) {
      for (const position of VARIANCE_POSITIONS) {
        expect(composed[playerClass][position]).toBe(SKILL[playerClass][position] ?? KDEF[playerClass][position]);
      }
    }
  });

  /**
   * A COLLISION WOULD REPLACE ONE MEASURED CELL WITH ANOTHER AND LOOK LIKE NOTHING. The two
   * halves are fit by different scripts from different stores and carry disjoint positions; a
   * future fit that widened one of them must fail here, loudly, rather than let a spread pick a
   * winner.
   */
  it("refuses an overlapping cell, naming it", () => {
    expect(() => composeGameVariance(SKILL, { ...KDEF, veteran: { ...KDEF.veteran, TE: 1 } })).toThrow(/veteran\.TE/);
  });
});

describe("loadShippedGameVariance", () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("composes the two pinned artifacts from the store", async () => {
    await publishModelArtifact(db, GAME_VARIANCE_SKILL_ARTIFACT, SKILL, PROVENANCE);
    await publishModelArtifact(db, GAME_VARIANCE_KDEF_ARTIFACT, KDEF, PROVENANCE);
    expect(await loadShippedGameVariance(db)).toEqual(composeGameVariance(SKILL, KDEF));
  });

  it("fails loudly when either half is missing, never serving a games-only band by default", async () => {
    await publishModelArtifact(db, GAME_VARIANCE_SKILL_ARTIFACT, SKILL, PROVENANCE);
    await expect(loadShippedGameVariance(db)).rejects.toBeInstanceOf(MissingModelArtifactError);
  });
});
