import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { createSimRun, getSimRun, hashSimConfig, markSimRunSucceeded } from "@/draft-service/sim/store";
import type { SimConfig } from "@/draft-service/sim/types";
import { evidencePoolFor } from "@/draft-service/sim/evidence";
import { parseSimJobPayload, runSimJobStep } from "./sim-job";

/** `runSimJobStep` reads the evidence board through `evidencePoolFor`, which is a real DB read
 *  against `preseason_projections`/`player_crosswalk`. This suite seeds none of that (out of
 *  scope for a job-lifecycle test) and instead asserts the job's own contract: a config the pure
 *  sim layer refuses (an empty pool) fails the run terminally and records the reason, rather than
 *  silently succeeding with fabricated numbers. */
describe("sim job", () => {
  let db: Db;
  const USER = "user-1";

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(users).values({ id: USER, displayName: "A", email: "a@example.com" });
  });

  it("parses a well-formed payload and rejects a malformed one", () => {
    expect(parseSimJobPayload({ simRunId: "run-1" })).toEqual({ simRunId: "run-1" });
    expect(() => parseSimJobPayload({})).toThrow();
    expect(() => parseSimJobPayload({ simRunId: 5 })).toThrow();
  });

  it("throws a terminal error for a sim_runs row that does not exist", async () => {
    await expect(runSimJobStep(db, { simRunId: "missing" })).rejects.toThrow(/no sim_runs row/);
  });

  it("marks the run failed (never fabricates a summary) when the evidence board is empty", async () => {
    const config: SimConfig = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, slot: 7, rounds: 15, runs: 10, sharpness: 0.5, seed: 1 };
    const { boardGeneration } = await evidencePoolFor(db); // no board rows seeded: empty pool, generation ""
    await createSimRun(db, { id: "run-1", userId: USER, leagueId: null, config, configHash: hashSimConfig(config), boardGeneration });

    await expect(runSimJobStep(db, { simRunId: "run-1" })).rejects.toThrow(/fewer than/);
    const row = await getSimRun(db, "run-1");
    expect(row?.status).toBe("failed");
    expect(row?.error).toMatch(/fewer than/);
  });

  it("replays an already-succeeded run idempotently, without re-simulating", async () => {
    const config: SimConfig = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, slot: 7, rounds: 15, runs: 10, sharpness: 0.5, seed: 1 };
    await createSimRun(db, { id: "run-done", userId: USER, leagueId: null, config, configHash: hashSimConfig(config), boardGeneration: "gen-1" });
    await markSimRunSucceeded(db, "run-done", {
      runs: 10, teamCount: 12, slot: 7, rounds: 15, baselineTop3Rate: 0.25, builds: [], availability: [], exposure: [], meanFinishRank: 6, elapsedMs: 1,
    });
    const outcome = await runSimJobStep(db, { simRunId: "run-done" });
    expect(outcome.summary).toMatch(/already succeeded/);
  });
});
