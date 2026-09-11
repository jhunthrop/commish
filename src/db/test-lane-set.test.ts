import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentLaneSet, liveLaneSetKeys, readWorktreeIdentity } from "./test-lane-set";
import { laneSetForWorktree, laneSetKeyForPath } from "./test-lanes";

describe("readWorktreeIdentity", () => {
  it("reads THIS checkout's root and the git directory it shares", () => {
    const identity = readWorktreeIdentity();
    expect(identity.root.startsWith("/")).toBe(true);
    expect(existsSync(identity.root)).toBe(true);
    expect(identity.gitCommonDir.startsWith("/")).toBe(true);
    expect(existsSync(identity.gitCommonDir)).toBe(true);
  });
});

describe("currentLaneSet", () => {
  it("agrees with the pure rule applied to this checkout's own identity", () => {
    expect(currentLaneSet({})).toBe(laneSetForWorktree(readWorktreeIdentity(), {}));
  });

  it("honours an explicit TEST_DB_LANE_SET without consulting git", () => {
    expect(currentLaneSet({ TEST_DB_LANE_SET: "round7" })).toBe("round7");
  });

  it("caches its answer in the env it was handed, so a worker resolves git once", () => {
    const env: Record<string, string | undefined> = {};
    const first = currentLaneSet(env);
    expect(env.__TEST_DB_LANE_SET_RESOLVED__).toBe(first ?? "");
    env.__TEST_DB_LANE_SET_RESOLVED__ = "cached1";
    expect(currentLaneSet(env)).toBe("cached1");
  });

  it("reads a cached empty string back as the primary set", () => {
    expect(currentLaneSet({ __TEST_DB_LANE_SET_RESOLVED__: "" })).toBeNull();
  });
});

describe("liveLaneSetKeys", () => {
  it("includes the key of this very worktree, because its path exists", () => {
    const identity = readWorktreeIdentity();
    const keys = liveLaneSetKeys();
    expect(keys.has(laneSetKeyForPath(identity.root))).toBe(true);
  });

  it("never includes a key for a path that no longer exists", () => {
    expect(liveLaneSetKeys().has(laneSetKeyForPath("/Users/jh/code/fantasy/.claude/worktrees/gone-forever"))).toBe(false);
  });
});
