import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

/**
 * THE ONE-RUNNER ERA'S REPLACEMENT (Round D, Task 3 scope extension).
 *
 * Every DB-backed test truncates the whole schema between tests (`test-db.ts`'s own
 * `truncateAll`), which is why this repository has always run test FILES one at a time: two
 * files racing the same `TRUNCATE ... RESTART IDENTITY CASCADE` against one shared database is
 * not a flaky test, it is two tests sharing a database that was never built to be shared. FOUR
 * lane databases on the one `postgres-test` container (created and migrated by
 * `scripts/migrate-test-lanes.ts`, which `npm run db:migrate:test` runs) let `vitest run` shard
 * files across up to four parallel workers instead: each worker gets its own database, so
 * cross-worker interleaving is no longer possible for the SAME reason a single serial run was
 * always safe — one worker, one database, files still run one at a time within it.
 *
 * LANE 1 IS THE BASE DATABASE, UNCHANGED. Every existing default (`.env.local`'s
 * `TEST_DATABASE_URL`, docker-compose's `POSTGRES_DB: commish_test`) keeps naming `commish_test`
 * with no suffix, so `vitest run --no-file-parallelism` — which
 * Vitest resolves to exactly one worker, `VITEST_POOL_ID` "1" — reads and migrates the SAME
 * database it always has. Lanes 2-4 are `commish_test_2`, `commish_test_3`, `commish_test_4`.
 *
 * PURE AND VITEST-FREE ON PURPOSE. `scripts/migrate-test-lanes.ts` runs as a plain Node process
 * that never loads the `vitest` package, and `vitest.setup.mts` (which does) imports this SAME
 * module rather than the lane-naming rule being written twice and drifting.
 *
 * ONE LANE SET PER WORKTREE (2026-09-11). Four lanes were enough while one checkout ran the
 * suite. They are not enough for several agent worktrees of the same repository running vitest at
 * the same time: every checkout resolved the identical four database names, so two rounds
 * interleaved their fixtures in one database — a duplicate key on `audit_events` `evt_1`, two
 * `TRUNCATE ... RESTART IDENTITY CASCADE` statements queueing behind each other, one lock-order
 * suite measured at 460s against its usual 7s. So the four lanes are now a SET, and each worktree
 * gets its own:
 *
 *   primary checkout   commish_test, commish_test_2, commish_test_3, commish_test_4  (unchanged)
 *   worktree <set>     commish_test_<set>_1 .. commish_test_<set>_4
 *
 * The set key is the first six hex characters of the SHA-256 of the worktree's absolute root
 * path: short enough to read in `\l`, stable across runs and reboots, and derived from the one
 * thing that is already unique per checkout. A checkout is the PRIMARY one when its `.git` lives
 * inside its own root (`git rev-parse --git-common-dir` resolves to `<root>/.git`) — true of the
 * main checkout and of every plain `git clone`, CI included, which is why nothing about CI or the
 * primary lanes changes. A linked worktree shares the main checkout's git directory, so the same
 * test names it as not-primary without knowing any machine's paths. `TEST_DB_LANE_SET` overrides
 * the derivation outright; `TEST_DB_LANE` still pins one lane WITHIN whichever set is resolved.
 *
 * The rule is split in two on purpose: the naming and the choice of set are pure functions here,
 * and `test-lane-set.ts` beside it holds the one part that must ask git where it is. Resolving a
 * set is therefore testable without a repository, and the shell-out happens once per process.
 */
export const TEST_DB_LANE_COUNT = 4;

/**
 * The main checkout's set, which has no set segment at all: lane 1 is `commish_test`, exactly the
 * name every default (`.env.local`'s `TEST_DATABASE_URL`, docker-compose's `POSTGRES_DB`, CI's
 * written `.env.local`) already carries.
 */
export const PRIMARY_LANE_SET = null;

/** A resolved lane set: a key for a linked worktree, `PRIMARY_LANE_SET` for the main checkout. */
export type LaneSet = string | null;

/** How much of the path hash names a set. Six hex characters is ~16.7M keys. */
export const LANE_SET_KEY_LENGTH = 6;

/**
 * A lane-set key becomes part of a database name and must therefore survive as a bare SQL
 * identifier and stay unambiguous against the `<base>_<lane>` primary names. Lowercase
 * alphanumerics only: no underscore, so `<base>_<set>_<lane>` splits exactly one way.
 */
const LANE_SET_KEY_PATTERN = /^[a-z0-9]{1,24}$/;

/** Where a checkout is and which git directory it shares — everything the set rule needs. */
export type WorktreeIdentity = {
  readonly root: string;
  readonly gitCommonDir: string;
};

/** The set key a worktree at `worktreeRoot` owns. Stable for the life of that path. */
export function laneSetKeyForPath(worktreeRoot: string): string {
  return createHash("sha256").update(resolve(worktreeRoot)).digest("hex").slice(0, LANE_SET_KEY_LENGTH);
}

/**
 * Whether this checkout owns its own git directory (the main checkout, and every plain clone) as
 * opposed to borrowing another checkout's (a linked worktree). This is the whole primary test:
 * it needs no hardcoded machine path and no branch name.
 */
export function isPrimaryWorktree(identity: WorktreeIdentity): boolean {
  return dirname(resolve(identity.gitCommonDir)) === resolve(identity.root);
}

/** Reads an explicit `TEST_DB_LANE_SET`. Blank or absent means "no override", never "primary". */
export function parseLaneSetOverride(raw: string | undefined): LaneSet {
  const key = raw?.trim() ?? "";
  if (key === "") return PRIMARY_LANE_SET;
  if (!LANE_SET_KEY_PATTERN.test(key)) {
    throw new Error(`TEST_DB_LANE_SET "${raw}" is not a valid lane-set key (1-24 lowercase letters and digits).`);
  }
  return key;
}

/** Which set a checkout should use: an explicit override, else primary or this path's own key. */
export function laneSetForWorktree(identity: WorktreeIdentity, env: Readonly<Record<string, string | undefined>>): LaneSet {
  const override = parseLaneSetOverride(env.TEST_DB_LANE_SET);
  if (override !== PRIMARY_LANE_SET) return override;
  return isPrimaryWorktree(identity) ? PRIMARY_LANE_SET : laneSetKeyForPath(identity.root);
}

/** One lane's database name. The primary set keeps the historical `<base>`/`<base>_N` names. */
export function laneDatabaseName(baseName: string, lane: number, laneSet: LaneSet = PRIMARY_LANE_SET): string {
  assertLane(lane);
  if (laneSet === PRIMARY_LANE_SET) return lane === 1 ? baseName : `${baseName}_${lane}`;
  return `${baseName}_${laneSet}_${lane}`;
}

/** The database a connection URL points at — its path with the leading slash removed. */
export function databaseNameFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** A worktree-set lane database, as read back off the server. */
export type LaneSetDatabase = {
  readonly name: string;
  readonly set: string;
  readonly lane: number;
};

/**
 * Reads a database name back into the set and lane that produced it, or `null` when it was not
 * produced by a worktree set. Primary lane names have no set segment, so they never parse — which
 * is the structural reason `db:lanes:prune` cannot reach them.
 */
export function parseLaneSetDatabaseName(baseName: string, name: string): LaneSetDatabase | null {
  const match = new RegExp(`^${escapeForRegExp(baseName)}_([a-z0-9]{1,24})_([1-9][0-9]*)$`).exec(name);
  if (match === null) return null;
  const [, set, lane] = match;
  if (set === undefined || lane === undefined) return null;
  return { name, set, lane: Number(lane) };
}

/**
 * Which lane databases belong to a set no live worktree claims. The primary set is unreachable
 * here by construction (its names carry no set segment), so an abandoned-worktree sweep can never
 * take `commish_test` with it.
 */
export function laneSetDatabasesToDrop(
  databaseNames: readonly string[],
  baseName: string,
  liveSetKeys: ReadonlySet<string>,
): readonly string[] {
  return databaseNames
    .map((name) => parseLaneSetDatabaseName(baseName, name))
    .filter((parsed): parsed is LaneSetDatabase => parsed !== null && !liveSetKeys.has(parsed.set))
    .map((parsed) => parsed.name);
}

/**
 * Whether a lane still owes migrations, comparing its applied-migration count to the journal's.
 * Fewer applied than the journal holds means behind; equal or more means current (a lane can read
 * one ahead after a merge-time journal renumbering, which is not a reason to re-run anything).
 */
export function laneNeedsMigration(appliedMigrations: number, journalEntries: number): boolean {
  return appliedMigrations < journalEntries;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertLane(lane: number): void {
  if (!Number.isInteger(lane) || lane < 1 || lane > TEST_DB_LANE_COUNT) {
    throw new Error(`Lane ${lane} is out of range (1-${TEST_DB_LANE_COUNT}).`);
  }
}

/**
 * Rewrites a Postgres connection URL's database name for a 1-based lane in a lane set. In the
 * primary set, lane 1 returns `baseUrl` untouched and lane N appends `_N`, exactly as before sets
 * existed; in a worktree set every lane is suffixed, so `postgres://.../commish_test` becomes
 * `postgres://.../commish_test_ab12cd_1`. Only the path is touched — credentials, host and query
 * params come through as they were.
 */
export function testDatabaseUrlForLane(baseUrl: string, lane: number, laneSet: LaneSet = PRIMARY_LANE_SET): string {
  assertLane(lane);
  if (laneSet === PRIMARY_LANE_SET && lane === 1) return baseUrl;
  const url = new URL(baseUrl);
  url.pathname = `/${laneDatabaseName(databaseNameFromUrl(baseUrl), lane, laneSet)}`;
  return url.toString();
}

/**
 * Which lane THIS process should use.
 *
 * `TEST_DB_LANE` (an explicit env var — a manual run pinned to one lane, a CI job isolating a
 * single lane) wins outright when set. Otherwise `VITEST_POOL_ID`, which Vitest sets on every
 * worker (threads or forks) before that worker runs its first test file's `setupFiles` — the
 * exact per-worker identity this lane split exists to key off. Either source is wrapped into
 * `[1, TEST_DB_LANE_COUNT]` with modulo arithmetic so a worker pool wider than the lane count (a
 * future `maxWorkers` bump, a CI runner with more cores) still resolves to a real database rather
 * than a nonexistent `commish_test_7`. Falls back to lane 1 for every caller outside Vitest's
 * worker pool entirely (a one-off script, a REPL, `db:migrate:test`'s single-lane invocation) —
 * the same database every such caller has always used.
 */
export function currentTestDbLane(): number {
  const explicit = readLane(process.env.TEST_DB_LANE);
  if (explicit !== null) return explicit;

  const pooled = readLane(process.env.VITEST_POOL_ID);
  return pooled ?? 1;
}

function readLane(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return ((parsed - 1) % TEST_DB_LANE_COUNT) + 1;
}
