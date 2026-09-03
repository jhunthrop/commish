import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_DB_LANE_COUNT, currentTestDbLane, testDatabaseUrlForLane } from "./test-lanes";

const BASE_URL = "postgres://commish:commish@localhost:5433/commish_test";

describe("testDatabaseUrlForLane", () => {
  it("returns the base URL unchanged for lane 1 — the backward-compatible default", () => {
    expect(testDatabaseUrlForLane(BASE_URL, 1)).toBe(BASE_URL);
  });

  it("appends _N to the database name for lanes 2 through the lane count", () => {
    expect(testDatabaseUrlForLane(BASE_URL, 2)).toBe("postgres://commish:commish@localhost:5433/commish_test_2");
    expect(testDatabaseUrlForLane(BASE_URL, 3)).toBe("postgres://commish:commish@localhost:5433/commish_test_3");
    expect(testDatabaseUrlForLane(BASE_URL, TEST_DB_LANE_COUNT)).toBe("postgres://commish:commish@localhost:5433/commish_test_4");
  });

  it("preserves query params and credentials, touching only the path", () => {
    const withParams = "postgres://commish:commish@localhost:5433/commish_test?sslmode=disable";
    expect(testDatabaseUrlForLane(withParams, 2)).toBe("postgres://commish:commish@localhost:5433/commish_test_2?sslmode=disable");
  });

  it("throws for lane 0 and for a lane beyond the lane count", () => {
    expect(() => testDatabaseUrlForLane(BASE_URL, 0)).toThrow(/out of range/);
    expect(() => testDatabaseUrlForLane(BASE_URL, TEST_DB_LANE_COUNT + 1)).toThrow(/out of range/);
  });

  it("throws for a non-integer lane", () => {
    expect(() => testDatabaseUrlForLane(BASE_URL, 1.5)).toThrow(/out of range/);
  });
});

describe("currentTestDbLane", () => {
  const ORIGINAL_TEST_DB_LANE = process.env.TEST_DB_LANE;
  const ORIGINAL_VITEST_POOL_ID = process.env.VITEST_POOL_ID;

  beforeEach(() => {
    delete process.env.TEST_DB_LANE;
    delete process.env.VITEST_POOL_ID;
  });

  afterEach(() => {
    if (ORIGINAL_TEST_DB_LANE === undefined) delete process.env.TEST_DB_LANE;
    else process.env.TEST_DB_LANE = ORIGINAL_TEST_DB_LANE;
    if (ORIGINAL_VITEST_POOL_ID === undefined) delete process.env.VITEST_POOL_ID;
    else process.env.VITEST_POOL_ID = ORIGINAL_VITEST_POOL_ID;
  });

  it("falls back to lane 1 when neither env var is set — every non-Vitest caller", () => {
    expect(currentTestDbLane()).toBe(1);
  });

  it("reads VITEST_POOL_ID when TEST_DB_LANE is absent — Vitest's own per-worker identity", () => {
    process.env.VITEST_POOL_ID = "3";
    expect(currentTestDbLane()).toBe(3);
  });

  it("TEST_DB_LANE wins outright over VITEST_POOL_ID — an explicit override pins one lane", () => {
    process.env.VITEST_POOL_ID = "3";
    process.env.TEST_DB_LANE = "2";
    expect(currentTestDbLane()).toBe(2);
  });

  it("wraps a pool id wider than the lane count with modulo, rather than a nonexistent database", () => {
    process.env.VITEST_POOL_ID = String(TEST_DB_LANE_COUNT + 1);
    expect(currentTestDbLane()).toBe(1);
    process.env.VITEST_POOL_ID = String(TEST_DB_LANE_COUNT + 2);
    expect(currentTestDbLane()).toBe(2);
  });

  it("treats an empty-string or non-numeric env var as absent, falling back to lane 1", () => {
    process.env.VITEST_POOL_ID = "";
    expect(currentTestDbLane()).toBe(1);
    process.env.VITEST_POOL_ID = "not-a-number";
    expect(currentTestDbLane()).toBe(1);
  });
});
