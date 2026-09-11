/**
 * WHERE AM I, AND WHICH LANE SET IS THAT? The one half of the lane-set rule that has to ask git.
 * `test-lanes.ts` beside this file holds the pure naming and the pure choice of set; this file
 * turns "the process running right now" into the `WorktreeIdentity` that rule takes, and caches
 * the answer so a Vitest worker shells out to git once rather than once per test file.
 *
 * Node-only and test-only: nothing under `src/` outside the test harness imports it.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type LaneSet,
  PRIMARY_LANE_SET,
  type WorktreeIdentity,
  laneSetForWorktree,
  laneSetKeyForPath,
  parseLaneSetOverride,
} from "./test-lanes";

/**
 * Where the resolved set is remembered for the life of a process. `process.env` survives Vitest's
 * per-file module isolation (the same reason `vitest.setup.mts` caches the pristine base URL in
 * `__TEST_DATABASE_BASE_URL__`), so one git call per worker covers every file that worker runs.
 * An empty string is a cached PRIMARY set, which is exactly why `TEST_DB_LANE_SET` itself cannot
 * carry that meaning: there, blank means "no override".
 */
const RESOLVED_LANE_SET_ENV = "__TEST_DB_LANE_SET_RESOLVED__";

/** A mutable environment map. Not `NodeJS.ProcessEnv`: Next.js augments that with a REQUIRED
 *  `NODE_ENV`, which would make every caller hand over a whole environment to read one key. */
type Env = Record<string, string | undefined>;

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * This checkout's absolute root and the git directory it shares. Both come back absolute:
 * `--path-format=absolute` matters because `--git-common-dir` otherwise answers a bare `.git`
 * relative to the CURRENT directory, which is wrong the moment anything runs from a subdirectory.
 */
export function readWorktreeIdentity(): WorktreeIdentity {
  return {
    root: git(["rev-parse", "--path-format=absolute", "--show-toplevel"]),
    gitCommonDir: git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  };
}

/**
 * The lane set this process should use.
 *
 * Order: an explicit `TEST_DB_LANE_SET`, then the cached answer from earlier in this process, then
 * git. When git cannot answer at all (no git on PATH, a source archive rather than a checkout) the
 * answer is the PRIMARY set: a lone unpacked copy of this repository is the one checkout there is,
 * and it deserves the plain names.
 */
export function currentLaneSet(env: Env = process.env): LaneSet {
  const decided = decidedLaneSet(env);
  if (decided !== undefined) return decided;

  const identity = readWorktreeIdentityOrNull();
  const resolved = identity === null ? PRIMARY_LANE_SET : laneSetForWorktree(identity, env);
  env[RESOLVED_LANE_SET_ENV] = resolved ?? "";
  return resolved;
}

/** The set keys of every worktree git knows about whose directory is still on disk. */
export function liveLaneSetKeys(): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const line of worktreeListLines()) {
    if (!line.startsWith("worktree ")) continue;
    const path = line.slice("worktree ".length);
    if (existsSync(path)) keys.add(laneSetKeyForPath(path));
  }
  return keys;
}

function worktreeListLines(): readonly string[] {
  try {
    return git(["worktree", "list", "--porcelain"]).split("\n");
  } catch {
    return [];
  }
}

/** `undefined` means "nothing decided yet"; a `LaneSet` (null included) is a decided answer. */
function decidedLaneSet(env: Env): LaneSet | undefined {
  const override = parseLaneSetOverride(env.TEST_DB_LANE_SET);
  if (override !== PRIMARY_LANE_SET) return override;
  const cached = env[RESOLVED_LANE_SET_ENV];
  if (cached === undefined) return undefined;
  return cached === "" ? PRIMARY_LANE_SET : cached;
}

function readWorktreeIdentityOrNull(): WorktreeIdentity | null {
  try {
    return readWorktreeIdentity();
  } catch {
    return null;
  }
}
