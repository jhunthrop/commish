import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { captureSnapshots } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { TANK01_CONFIG } from "@/stats/tank01/config";
import { TerminalJobError } from "../contract";
import { JOB_DEFINITIONS } from "../registry";
import {
  CAPTURE_HARVEST_JOB_NAME,
  captureHarvestJob,
  parseCaptureHarvestPayload,
  runCaptureHarvestStep,
} from "./capture-harvest-job";

// A Wednesday: none of `CAPTURE_CONFIG.gameDaysUtc` (`capture-feeds.ts`), so only the three DAILY
// feeds in this job's allowlist are due (injuries-by-date, news, depth charts) — inactives and
// betting odds (both `game-day`) are off-cadence and never requested.
const OFF_GAME_DAY_CLOCK = { now: () => "2026-09-02T12:00:00.000Z" };
// A Thursday: in `gameDaysUtc`, so every feed in the allowlist is due — all five.
const GAME_DAY_CLOCK = { now: () => "2026-09-03T12:00:00.000Z" };

function fixtureFetch(seen: string[]): typeof globalThis.fetch {
  return (async (url: unknown) => {
    const parsed = new URL(url as string);
    seen.push(parsed.pathname);
    // Each request's own path+query makes its body unique, so every due feed's digest differs
    // from "no prior row" and is reported "captured" rather than "unchanged".
    return new Response(JSON.stringify({ body: { path: parsed.pathname, query: parsed.search } }), { status: 200 });
  }) as typeof globalThis.fetch;
}

describe("the capture-harvest job", () => {
  it("is registered under its own name", () => {
    expect(JOB_DEFINITIONS.get(CAPTURE_HARVEST_JOB_NAME)).toBe(captureHarvestJob);
  });

  it("is shaped as one bounded step with a retry budget for ordinary network weather", () => {
    expect(captureHarvestJob.stepNames).toEqual(["harvest"]);
    expect(captureHarvestJob.maxAttempts).toBeGreaterThan(1);
  });
});

describe("runCaptureHarvestStep", () => {
  let db: Db;

  it("captures the due daily feeds and writes one snapshot row per feed", async () => {
    db = createTestDb();
    await truncateAll(db);
    const seen: string[] = [];

    const outcome = await runCaptureHarvestStep(db, OFF_GAME_DAY_CLOCK, {}, { apiKey: "test-key", fetch: fixtureFetch(seen) });

    expect(outcome.summary).toContain("5 feed(s) considered");
    expect(outcome.summary).toContain("3 captured");
    expect(outcome.summary).toContain("0 failed");
    expect(outcome.summary).toContain("2 skipped");

    const rows = await db.select().from(captureSnapshots);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.source).sort()).toEqual(["tank01_depth_charts", "tank01_injuries_by_date", "tank01_news"]);
  });

  it("passes exactly the configured allowlist of feeds — never the 32-request roster sweep, the ADP feed, or the player list", async () => {
    db = createTestDb();
    await truncateAll(db);
    const seen: string[] = [];

    await runCaptureHarvestStep(db, GAME_DAY_CLOCK, {}, { apiKey: "test-key", fetch: fixtureFetch(seen) });

    const expectedPaths = [
      TANK01_CONFIG.paths.injuriesByDate,
      TANK01_CONFIG.paths.news,
      TANK01_CONFIG.paths.depthCharts,
      TANK01_CONFIG.paths.inactives,
      TANK01_CONFIG.paths.bettingOdds,
    ];
    expect(seen.sort()).toEqual([...expectedPaths].sort());
    expect(seen).not.toContain(TANK01_CONFIG.paths.teamRoster);
    expect(seen).not.toContain(TANK01_CONFIG.paths.playerList);
    expect(seen).not.toContain(TANK01_CONFIG.paths.adp);
    expect(seen).not.toContain(TANK01_CONFIG.paths.projections);
    expect(seen).not.toContain(TANK01_CONFIG.paths.changelog);
    expect(seen).not.toContain(TANK01_CONFIG.paths.dfs);
  });

  it("works in the preseason, with no stat_weeks row yet, by deriving week 1 for the one week-keyed feed", async () => {
    db = createTestDb();
    await truncateAll(db);
    const seen: string[] = [];

    const outcome = await runCaptureHarvestStep(db, GAME_DAY_CLOCK, {}, { apiKey: "test-key", fetch: fixtureFetch(seen) });

    expect(outcome.summary).toContain("5 feed(s) considered");
    expect(outcome.summary).toContain("5 captured");
    expect(seen.some((p) => p === TANK01_CONFIG.paths.inactives)).toBe(true);
  });

  it("reports failed feeds honestly rather than fabricating a captured row", async () => {
    db = createTestDb();
    await truncateAll(db);
    const failingFetch = (async () => new Response("nope", { status: 500 })) as typeof globalThis.fetch;

    const outcome = await runCaptureHarvestStep(db, OFF_GAME_DAY_CLOCK, {}, { apiKey: "test-key", fetch: failingFetch });

    expect(outcome.summary).toContain("5 feed(s) considered");
    expect(outcome.summary).toContain("0 captured");
    expect(outcome.summary).toContain("3 failed");
    expect(outcome.summary).toContain("2 skipped");
    expect(await db.select().from(captureSnapshots)).toHaveLength(0);
  });

  it("throws a TerminalJobError when TANK01_API_KEY is not set, without ever building a client", async () => {
    db = createTestDb();
    await truncateAll(db);
    vi.stubEnv("TANK01_API_KEY", "");

    await expect(runCaptureHarvestStep(db, OFF_GAME_DAY_CLOCK, {}, {})).rejects.toBeInstanceOf(TerminalJobError);

    vi.unstubAllEnvs();
  });

  it("reads TANK01_API_KEY from the environment when no apiKey dep is injected", async () => {
    db = createTestDb();
    await truncateAll(db);
    vi.stubEnv("TANK01_API_KEY", "env-key");
    const seen: string[] = [];

    const outcome = await runCaptureHarvestStep(db, OFF_GAME_DAY_CLOCK, {}, { fetch: fixtureFetch(seen) });

    expect(outcome.summary).toContain("3 captured");
    vi.unstubAllEnvs();
  });
});

describe("parseCaptureHarvestPayload", () => {
  it("accepts an empty payload", () => {
    expect(parseCaptureHarvestPayload({})).toEqual({});
  });

  it("accepts a well-formed firedAt", () => {
    expect(parseCaptureHarvestPayload({ firedAt: "2026-09-02T03:00:00.000Z" })).toEqual({ firedAt: "2026-09-02T03:00:00.000Z" });
  });

  it("rejects a malformed firedAt", () => {
    expect(() => parseCaptureHarvestPayload({ firedAt: "not-a-date" })).toThrow();
    expect(() => parseCaptureHarvestPayload({ firedAt: 5 })).toThrow();
  });
});
