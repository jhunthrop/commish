import { beforeEach, describe, expect, it } from "vitest";
import { QUILT_CONFIG } from "./config";
import { readSeedSheet, seedOrderFrom, SHEET_SEED_STORAGE_KEY, writeSeedSheet } from "./sheet-seed";

beforeEach(() => {
  window.localStorage.clear();
});

describe("seedOrderFrom", () => {
  it("puts the mock picks first, in pick order, then the rest of the board in board order", () => {
    expect(seedOrderFrom(["p3", "p1"], ["p1", "p2", "p3", "p4"])).toEqual(["p3", "p1", "p2", "p4"]);
  });

  it("is a full permutation — nothing duplicated, nothing dropped", () => {
    const order = seedOrderFrom(["p2"], ["p1", "p2", "p3"]);
    expect([...order].sort()).toEqual(["p1", "p2", "p3"]);
  });
});

describe("the seed store", () => {
  it("round-trips through the sheet codec under the well-known key", () => {
    expect(writeSeedSheet(["p2", "p1"])).toBe(true);
    expect(SHEET_SEED_STORAGE_KEY).toBe(`${QUILT_CONFIG.sheetStorageKeyPrefix}seed`);
    expect(readSeedSheet()).toEqual({ order: ["p2", "p1"], notes: {} });
  });

  it("reads a missing or malformed store as no seed at all", () => {
    expect(readSeedSheet()).toBeNull();
    window.localStorage.setItem(SHEET_SEED_STORAGE_KEY, "{broken");
    expect(readSeedSheet()).toBeNull();
  });
});
