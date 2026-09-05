import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll, truncateJobTables } from "@/db/test-db";
import { defineJob, type AnyJobDefinition } from "./contract";
import { JOBS_CONFIG } from "./config";
import { enqueueJob } from "./store";
import { isAuthorizedTick } from "./tick-auth";
import { handleTick, tickBudgetMs, type TickHandlerDeps } from "./tick-handler";

const db = createTestDb();

const SECRET = "test-cron-secret-value";

const noop: AnyJobDefinition = defineJob({
  name: "noop",
  maxAttempts: 3,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "only", run: async () => ({ summary: "done", detail: [] }) }],
});

/** The real SCHEDULES fire "season-week", so the tick's schedule pass needs a definition under
 *  that name too — a canned one here; the real one is wired by the route via the registry. */
const cannedSeasonWeek: AnyJobDefinition = defineJob({
  name: "season-week",
  maxAttempts: 3,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "only", run: async () => ({ summary: "canned", detail: [] }) }],
});

/** Same reason: the real SCHEDULES now also fire "draft-sweep" every minute. */
const cannedDraftSweep: AnyJobDefinition = defineJob({
  name: "draft-sweep",
  maxAttempts: 2,
  timeoutMs: 5_000,
  backoff: { baseMs: 30_000, maxMs: 60_000 },
  parsePayload: () => ({}),
  steps: [{ name: "sweep", run: async () => ({ summary: "canned", detail: [] }) }],
});

/** Same reason: the real SCHEDULES now also fire "adp-snapshot" nightly (Draft HQ phase 2 Task 6). */
const cannedAdpSnapshot: AnyJobDefinition = defineJob({
  name: "adp-snapshot",
  maxAttempts: 3,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "capture", run: async () => ({ summary: "canned", detail: [] }) }],
});

/** Same reason: the real SCHEDULES now also fire "capsule-sweep" nightly (player capsules). */
const cannedCapsuleSweep: AnyJobDefinition = defineJob({
  name: "capsule-sweep",
  maxAttempts: 2,
  timeoutMs: 5_000,
  backoff: { baseMs: 60_000, maxMs: 600_000 },
  parsePayload: () => ({}),
  steps: [{ name: "sweep", run: async () => ({ summary: "canned", detail: [] }) }],
});

function deps(env: Readonly<Record<string, string | undefined>> = { CRON_SECRET: SECRET }): TickHandlerDeps {
  return {
    db,
    definitions: new Map([
      ["noop", noop],
      ["season-week", cannedSeasonWeek],
      ["draft-sweep", cannedDraftSweep],
      ["adp-snapshot", cannedAdpSnapshot],
      ["capsule-sweep", cannedCapsuleSweep],
    ]),
    env,
    workerId: "tick-test",
  };
}

function request(authorization?: string): Request {
  return new Request("https://example.test/api/jobs/tick", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
});

describe("handleTick", () => {
  it("refuses every request when CRON_SECRET is not configured, with no hint in the body", async () => {
    const response = await handleTick(request(`Bearer ${SECRET}`), deps({}));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { readonly ok: boolean; readonly error: string };
    expect(body.ok).toBe(false);
    expect(body.error).not.toContain(SECRET);
  });

  it("turns away a missing or wrong bearer with 401", async () => {
    expect((await handleTick(request(), deps())).status).toBe(401);
    expect((await handleTick(request("Bearer wrong"), deps())).status).toBe(401);
    expect((await handleTick(request(SECRET), deps())).status).toBe(401); // no Bearer prefix
  });

  it("runs one bounded tick for the right bearer and reports what it did", async () => {
    await enqueueJob(
      db,
      { now: () => new Date().toISOString() },
      { name: "noop", idempotencyKey: "tick-noop", payload: {}, maxAttempts: 3, runAt: new Date(0) },
    );

    const response = await handleTick(request(`Bearer ${SECRET}`), deps());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly ok: boolean;
      readonly data: { readonly executed: readonly { readonly outcome: string }[]; readonly stoppedBecause: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data.executed).toHaveLength(1);
    expect(body.data.executed[0]!.outcome).toBe("succeeded");
    expect(["queue-drained", "max-jobs"]).toContain(body.data.stoppedBecause);
  });
});

describe("tickBudgetMs", () => {
  it("defaults, honors an override, and clamps nonsense", () => {
    expect(tickBudgetMs({})).toBe(JOBS_CONFIG.vercelTickBudgetMsDefault);
    expect(tickBudgetMs({ JOBS_TICK_BUDGET_MS: "120000" })).toBe(120_000);
    expect(tickBudgetMs({ JOBS_TICK_BUDGET_MS: "50" })).toBe(5_000);
    expect(tickBudgetMs({ JOBS_TICK_BUDGET_MS: "9999999" })).toBe(280_000);
    expect(tickBudgetMs({ JOBS_TICK_BUDGET_MS: "not-a-number" })).toBe(JOBS_CONFIG.vercelTickBudgetMsDefault);
  });
});

describe("isAuthorizedTick", () => {
  it("accepts only the exact bearer", () => {
    expect(isAuthorizedTick(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedTick(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedTick(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isAuthorizedTick(null, SECRET)).toBe(false);
    expect(isAuthorizedTick("Basic dXNlcjpwYXNz", SECRET)).toBe(false);
  });
});
