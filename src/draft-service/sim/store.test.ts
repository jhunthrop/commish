import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research/db/client";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research/domain/roster";
import {
  countInFlightSimRuns,
  createSimRun,
  findCachedRun,
  findInFlightRun,
  getSimRun,
  hashSimConfig,
  SIM_RULES_VERSION,
  listSimRunsForUser,
  markSimRunFailed,
  markSimRunRunning,
  markSimRunSucceeded,
} from "./store";
import type { SimConfig, SimSummary } from "./types";

const CONFIG: SimConfig = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, slot: 7, rounds: 15, runs: 100, sharpness: 0.5, seed: 1 };

const SUMMARY: SimSummary = {
  runs: 100,
  teamCount: 12,
  slot: 7,
  rounds: 15,
  baselineTop3Rate: 0.25,
  builds: [],
  availability: [],
  exposure: [],
  meanFinishRank: 6,
  elapsedMs: 500,
};

describe("sim_runs store", () => {
  let db: Db;
  // A user of this file's OWN, unique per test (fix round 1 of the draft advisor round): under a
  // full-directory run on the shared 5433 lane, "finds a cached succeeded run" failed the
  // `sim_runs.user_id` FK once and passed alone, an ordering dependency on a row another file's
  // fixture happened to leave. A fresh id inserted right before each test cannot depend on it.
  let USER = "";

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    USER = `sim-store-user-${randomUUID()}`;
    await db.insert(users).values({ id: USER, displayName: "A", email: `${USER}@example.com` }).onConflictDoNothing();
  });

  it("hashes a config stably, ignoring nothing about its own shape but insensitive to object identity", () => {
    const a = hashSimConfig(CONFIG);
    const b = hashSimConfig({ ...CONFIG });
    expect(a).toBe(b);
    expect(hashSimConfig({ ...CONFIG, seed: 2 })).not.toBe(a);
  });

  it("invalidates its own cache when the simulation rules change, and only then", () => {
    // The cache key is `(configHash, boardGeneration)`, and a change to what a run MEANS moves
    // neither on its own. Folding the rules version in is what retires every stale row the day
    // the rules change, rather than leaving yesterday's answer served under today's rules.
    const current = hashSimConfig(CONFIG);
    expect(hashSimConfig(CONFIG, SIM_RULES_VERSION)).toBe(current);
    expect(hashSimConfig(CONFIG, SIM_RULES_VERSION + 1)).not.toBe(current);
    expect(hashSimConfig({ ...CONFIG })).toBe(current);
  });

  it("round-trips a created run through pending, running, and succeeded", async () => {
    const hash = hashSimConfig(CONFIG);
    await createSimRun(db, { id: "run-1", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });

    const pending = await getSimRun(db, "run-1");
    expect(pending?.status).toBe("pending");

    await markSimRunRunning(db, "run-1");
    expect((await getSimRun(db, "run-1"))?.status).toBe("running");

    await markSimRunSucceeded(db, "run-1", SUMMARY);
    const done = await getSimRun(db, "run-1");
    expect(done?.status).toBe("succeeded");
    expect(done?.summary).toEqual(SUMMARY);
    expect(done?.finishedAt).not.toBeNull();
  });

  it("a failed run carries its error and never a summary", async () => {
    const hash = hashSimConfig(CONFIG);
    await createSimRun(db, { id: "run-2", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });
    await markSimRunFailed(db, "run-2", "the pool was too thin");
    const row = await getSimRun(db, "run-2");
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("the pool was too thin");
    expect(row?.summary).toBeNull();
  });

  it("finds a cached succeeded run for the same user, config hash, and board generation", async () => {
    const hash = hashSimConfig(CONFIG);
    await createSimRun(db, { id: "run-3", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });
    await markSimRunSucceeded(db, "run-3", SUMMARY);

    const hit = await findCachedRun(db, USER, hash, "gen-1");
    expect(hit?.id).toBe("run-3");

    // A different board generation is a cache MISS: the board moved, so the old numbers are stale.
    expect(await findCachedRun(db, USER, hash, "gen-2")).toBeNull();
    // A pending (not yet succeeded) run of the identical config is not a cache hit either.
    await createSimRun(db, { id: "run-4", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-3" });
    expect(await findCachedRun(db, USER, hash, "gen-3")).toBeNull();
  });

  it("never lets one user's cache serve another user's run", async () => {
    await db.insert(users).values({ id: "user-2", displayName: "B", email: "b@example.com" });
    const hash = hashSimConfig(CONFIG);
    await createSimRun(db, { id: "run-5", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });
    await markSimRunSucceeded(db, "run-5", SUMMARY);
    expect(await findCachedRun(db, "user-2", hash, "gen-1")).toBeNull();
  });

  it("lists a user's own runs, newest first", async () => {
    const hash = hashSimConfig(CONFIG);
    // Distinct board generations: each row is its own real piece of work, not a duplicate of the
    // other, so both may sit `pending` at once under `SIM_RUNS_INFLIGHT_INDEX`.
    await createSimRun(db, { id: "run-a", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });
    await createSimRun(db, { id: "run-b", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-2" });
    const rows = await listSimRunsForUser(db, USER, 10);
    expect(rows.map((r) => r.id).sort()).toEqual(["run-a", "run-b"]);
  });

  it("counts only pending/running runs as in flight", async () => {
    const hash = hashSimConfig(CONFIG);
    // Three DISTINCT board generations, so all three may exist without tripping the in-flight
    // uniqueness constraint — this test is about the status filter, not about the race guard.
    await createSimRun(db, { id: "run-p", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-p" });
    await createSimRun(db, { id: "run-r", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-r" });
    await markSimRunRunning(db, "run-r");
    await createSimRun(db, { id: "run-s", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-s" });
    await markSimRunSucceeded(db, "run-s", SUMMARY);

    expect(await countInFlightSimRuns(db, USER)).toBe(2);
  });

  describe("the in-flight uniqueness constraint (fix round 1, MEDIUM 1)", () => {
    it("createSimRun returns 'created' for the first insert of a (user, config, generation)", async () => {
      const hash = hashSimConfig(CONFIG);
      const result = await createSimRun(db, { id: "run-1", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });
      expect(result).toEqual({ outcome: "created" });
    });

    it("a second insert for the IDENTICAL (user, config, generation), while the first is still in flight, joins it instead of creating a duplicate", async () => {
      const hash = hashSimConfig(CONFIG);
      await createSimRun(db, { id: "run-1", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });
      const second = await createSimRun(db, { id: "run-2", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });

      expect(second.outcome).toBe("joined_in_flight");
      if (second.outcome === "joined_in_flight") expect(second.existing.id).toBe("run-1");
      // The loser's own row was never written.
      expect(await getSimRun(db, "run-2")).toBeNull();
      const rows = await listSimRunsForUser(db, USER, 10);
      expect(rows).toHaveLength(1);
    });

    it("once the first run finishes (no longer in flight), a fresh identical request creates its own new row", async () => {
      const hash = hashSimConfig(CONFIG);
      await createSimRun(db, { id: "run-1", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });
      await markSimRunSucceeded(db, "run-1", SUMMARY);

      const result = await createSimRun(db, { id: "run-2", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });
      expect(result).toEqual({ outcome: "created" });
    });

    it("findInFlightRun answers null once nothing is pending/running for that key", async () => {
      const hash = hashSimConfig(CONFIG);
      expect(await findInFlightRun(db, USER, hash, "gen-1")).toBeNull();
      await createSimRun(db, { id: "run-1", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" });
      expect((await findInFlightRun(db, USER, hash, "gen-1"))?.id).toBe("run-1");
      await markSimRunSucceeded(db, "run-1", SUMMARY);
      expect(await findInFlightRun(db, USER, hash, "gen-1")).toBeNull();
    });

    it("REAL CONCURRENCY: two genuinely simultaneous identical requests never both create a row", async () => {
      const hash = hashSimConfig(CONFIG);
      const [a, b] = await Promise.all([
        createSimRun(db, { id: "run-a", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" }),
        createSimRun(db, { id: "run-b", userId: USER, leagueId: null, config: CONFIG, configHash: hash, boardGeneration: "gen-1" }),
      ]);
      const outcomes = [a.outcome, b.outcome].sort();
      expect(outcomes).toEqual(["created", "joined_in_flight"]);
      const rows = await listSimRunsForUser(db, USER, 10);
      expect(rows).toHaveLength(1); // exactly one row exists, whichever request won
    });

    it("two DIFFERENT configs for the same user never collide", async () => {
      const hashA = hashSimConfig(CONFIG);
      const hashB = hashSimConfig({ ...CONFIG, seed: 999 });
      const a = await createSimRun(db, { id: "run-a", userId: USER, leagueId: null, config: CONFIG, configHash: hashA, boardGeneration: "gen-1" });
      const b = await createSimRun(db, { id: "run-b", userId: USER, leagueId: null, config: CONFIG, configHash: hashB, boardGeneration: "gen-1" });
      expect(a).toEqual({ outcome: "created" });
      expect(b).toEqual({ outcome: "created" });
    });
  });
});
