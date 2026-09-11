import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LANE_SET_KEY_LENGTH,
  PRIMARY_LANE_SET,
  TEST_DB_LANE_COUNT,
  currentTestDbLane,
  databaseNameFromUrl,
  laneDatabaseName,
  laneNeedsMigration,
  laneSetDatabasesToDrop,
  laneSetForWorktree,
  laneSetKeyForPath,
  parseLaneSetDatabaseName,
  parseLaneSetOverride,
  testDatabaseUrlForLane,
} from "./test-lanes";

const BASE_URL = "postgres://commish:commish@localhost:5433/commish_test";
const PRIMARY_ROOT = "/Users/jh/code/fantasy";
const PRIMARY_IDENTITY = { root: PRIMARY_ROOT, gitCommonDir: `${PRIMARY_ROOT}/.git` } as const;
const WORKTREE_ROOT = "/Users/jh/code/fantasy/.claude/worktrees/agent-abc";
const WORKTREE_IDENTITY = { root: WORKTREE_ROOT, gitCommonDir: `${PRIMARY_ROOT}/.git` } as const;

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

describe("laneSetKeyForPath", () => {
  it("is short, lowercase hex and stable for the same absolute path", () => {
    const key = laneSetKeyForPath(WORKTREE_ROOT);
    expect(key).toMatch(new RegExp(`^[0-9a-f]{${LANE_SET_KEY_LENGTH}}$`));
    expect(laneSetKeyForPath(WORKTREE_ROOT)).toBe(key);
  });

  it("normalizes a trailing slash and a relative segment to the same key", () => {
    expect(laneSetKeyForPath(`${WORKTREE_ROOT}/`)).toBe(laneSetKeyForPath(WORKTREE_ROOT));
    expect(laneSetKeyForPath(`${WORKTREE_ROOT}/./`)).toBe(laneSetKeyForPath(WORKTREE_ROOT));
  });

  it("gives two different worktrees two different keys", () => {
    expect(laneSetKeyForPath(`${WORKTREE_ROOT}-two`)).not.toBe(laneSetKeyForPath(WORKTREE_ROOT));
  });
});

describe("laneSetForWorktree", () => {
  it("is the primary set for the main checkout, whose .git sits inside its own root", () => {
    expect(laneSetForWorktree(PRIMARY_IDENTITY, {})).toBe(PRIMARY_LANE_SET);
  });

  it("is the path-derived key for a linked worktree, whose .git lives in the main checkout", () => {
    expect(laneSetForWorktree(WORKTREE_IDENTITY, {})).toBe(laneSetKeyForPath(WORKTREE_ROOT));
  });

  it("lets TEST_DB_LANE_SET win outright in either checkout", () => {
    expect(laneSetForWorktree(PRIMARY_IDENTITY, { TEST_DB_LANE_SET: "round7" })).toBe("round7");
    expect(laneSetForWorktree(WORKTREE_IDENTITY, { TEST_DB_LANE_SET: "round7" })).toBe("round7");
  });

  it("treats an empty TEST_DB_LANE_SET as unset rather than as the primary set", () => {
    expect(laneSetForWorktree(WORKTREE_IDENTITY, { TEST_DB_LANE_SET: "" })).toBe(laneSetKeyForPath(WORKTREE_ROOT));
  });
});

describe("parseLaneSetOverride", () => {
  it("accepts lowercase letters and digits", () => {
    expect(parseLaneSetOverride("ab12cd")).toBe("ab12cd");
    expect(parseLaneSetOverride("round7")).toBe("round7");
  });

  it("reads an absent or blank value as no override", () => {
    expect(parseLaneSetOverride(undefined)).toBe(PRIMARY_LANE_SET);
    expect(parseLaneSetOverride("")).toBe(PRIMARY_LANE_SET);
    expect(parseLaneSetOverride("   ")).toBe(PRIMARY_LANE_SET);
  });

  it("refuses anything that would not survive as part of a database name", () => {
    expect(() => parseLaneSetOverride("Round7")).toThrow(/lane-set key/);
    expect(() => parseLaneSetOverride("round-7")).toThrow(/lane-set key/);
    expect(() => parseLaneSetOverride("round_7")).toThrow(/lane-set key/);
    expect(() => parseLaneSetOverride('a"; DROP DATABASE commish_test; --')).toThrow(/lane-set key/);
    expect(() => parseLaneSetOverride("a".repeat(25))).toThrow(/lane-set key/);
  });
});

describe("laneDatabaseName", () => {
  it("names the primary set exactly as it always has", () => {
    expect(laneDatabaseName("commish_test", 1, PRIMARY_LANE_SET)).toBe("commish_test");
    expect(laneDatabaseName("commish_test", 2, PRIMARY_LANE_SET)).toBe("commish_test_2");
    expect(laneDatabaseName("commish_test", 4, PRIMARY_LANE_SET)).toBe("commish_test_4");
  });

  it("suffixes every lane of a worktree set, lane 1 included", () => {
    expect(laneDatabaseName("commish_test", 1, "ab12cd")).toBe("commish_test_ab12cd_1");
    expect(laneDatabaseName("commish_test", 4, "ab12cd")).toBe("commish_test_ab12cd_4");
  });
});

describe("testDatabaseUrlForLane with a lane set", () => {
  it("rewrites every lane of a worktree set, lane 1 included", () => {
    expect(testDatabaseUrlForLane(BASE_URL, 1, "ab12cd")).toBe("postgres://commish:commish@localhost:5433/commish_test_ab12cd_1");
    expect(testDatabaseUrlForLane(BASE_URL, 3, "ab12cd")).toBe("postgres://commish:commish@localhost:5433/commish_test_ab12cd_3");
  });

  it("preserves credentials and query params inside a set", () => {
    const withParams = "postgres://commish:commish@localhost:5433/commish_test?sslmode=disable";
    expect(testDatabaseUrlForLane(withParams, 2, "ab12cd")).toBe("postgres://commish:commish@localhost:5433/commish_test_ab12cd_2?sslmode=disable");
  });

  it("defaults to the primary set when no set is passed — every existing caller", () => {
    expect(testDatabaseUrlForLane(BASE_URL, 1)).toBe(BASE_URL);
    expect(testDatabaseUrlForLane(BASE_URL, 2)).toBe("postgres://commish:commish@localhost:5433/commish_test_2");
  });

  it("still refuses a lane outside the lane count inside a set", () => {
    expect(() => testDatabaseUrlForLane(BASE_URL, 0, "ab12cd")).toThrow(/out of range/);
    expect(() => testDatabaseUrlForLane(BASE_URL, TEST_DB_LANE_COUNT + 1, "ab12cd")).toThrow(/out of range/);
  });
});

describe("databaseNameFromUrl", () => {
  it("reads the database name out of a lane URL", () => {
    expect(databaseNameFromUrl(BASE_URL)).toBe("commish_test");
    expect(databaseNameFromUrl(testDatabaseUrlForLane(BASE_URL, 2, "ab12cd"))).toBe("commish_test_ab12cd_2");
  });
});

describe("parseLaneSetDatabaseName", () => {
  it("recognizes a worktree lane database and its set", () => {
    expect(parseLaneSetDatabaseName("commish_test", "commish_test_ab12cd_3")).toEqual({
      name: "commish_test_ab12cd_3",
      set: "ab12cd",
      lane: 3,
    });
  });

  it("never recognizes a primary lane database — the primary set has no set segment", () => {
    expect(parseLaneSetDatabaseName("commish_test", "commish_test")).toBeNull();
    expect(parseLaneSetDatabaseName("commish_test", "commish_test_2")).toBeNull();
    expect(parseLaneSetDatabaseName("commish_test", "commish_test_4")).toBeNull();
  });

  it("ignores unrelated databases", () => {
    expect(parseLaneSetDatabaseName("commish_test", "postgres")).toBeNull();
    expect(parseLaneSetDatabaseName("commish_test", "commish")).toBeNull();
    expect(parseLaneSetDatabaseName("commish_test", "commish_test_ab12cd_x")).toBeNull();
    expect(parseLaneSetDatabaseName("commish_test", "other_test_ab12cd_1")).toBeNull();
  });
});

describe("laneSetDatabasesToDrop", () => {
  const names = [
    "postgres",
    "commish",
    "commish_test",
    "commish_test_2",
    "commish_test_3",
    "commish_test_4",
    "commish_test_live01_1",
    "commish_test_live01_2",
    "commish_test_dead99_1",
    "commish_test_dead99_4",
  ];

  it("drops every lane of a set no live worktree claims", () => {
    expect(laneSetDatabasesToDrop(names, "commish_test", new Set(["live01"]))).toEqual([
      "commish_test_dead99_1",
      "commish_test_dead99_4",
    ]);
  });

  it("never drops the primary set, even when no set key is live at all", () => {
    const dropped = laneSetDatabasesToDrop(names, "commish_test", new Set());
    expect(dropped).not.toContain("commish_test");
    expect(dropped).not.toContain("commish_test_2");
    expect(dropped).not.toContain("commish_test_4");
    expect(dropped).toEqual([
      "commish_test_live01_1",
      "commish_test_live01_2",
      "commish_test_dead99_1",
      "commish_test_dead99_4",
    ]);
  });

  it("drops nothing when every set is live", () => {
    expect(laneSetDatabasesToDrop(names, "commish_test", new Set(["live01", "dead99"]))).toEqual([]);
  });
});

describe("laneNeedsMigration", () => {
  it("is behind when fewer migrations are applied than the journal holds", () => {
    expect(laneNeedsMigration(0, 88)).toBe(true);
    expect(laneNeedsMigration(87, 88)).toBe(true);
  });

  it("is current when the applied count has caught up or run ahead of the journal", () => {
    expect(laneNeedsMigration(88, 88)).toBe(false);
    expect(laneNeedsMigration(89, 88)).toBe(false);
  });
});
