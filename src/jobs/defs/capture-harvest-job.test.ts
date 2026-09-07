import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { captureSnapshots, jobs, players, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { createLeague } from "@/league-service/creation";
import { scoringHashOf } from "@/scoring";
import { TANK01_CONFIG } from "@/stats/tank01/config";
import { TerminalJobError } from "../contract";
import { JOB_DEFINITIONS } from "../registry";
import { PEEK_DOCUMENT_JOB_NAME } from "./peek-document-job";
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

/**
 * THE HARVEST'S OWN EVENT (peek document design §3.4, row four): a capture that MOVED an injury
 * designation enqueues a peek-document rebuild naming exactly the players it moved, and a capture
 * that moved nothing enqueues nothing at all. The first capture of a feed moves nobody, since there
 * is no earlier claim for it to contradict.
 */
describe("the harvest's peek-document event", () => {
  const FIRST = { now: () => "2026-09-02T12:00:00.000Z" };
  const LATER = { now: () => "2026-09-02T13:00:00.000Z" };

  /** A fetch that answers the injuries feed with the given designations and every other feed with a
   *  body that never changes, so only the injury arm can move between two runs. */
  function injuryFetch(designations: Readonly<Record<string, string>>): typeof globalThis.fetch {
    return (async (url: unknown) => {
      const parsed = new URL(url as string);
      if (parsed.pathname.toLowerCase().includes("injur")) {
        return new Response(
          JSON.stringify({ body: { injList: Object.entries(designations).map(([playerID, designation]) => ({ playerID, designation })) } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ body: { path: parsed.pathname } }), { status: 200 });
    }) as typeof globalThis.fetch;
  }

  async function harvestJobs(db: Db): Promise<readonly (typeof jobs.$inferSelect)[]> {
    return await db.select().from(jobs).where(eq(jobs.name, PEEK_DOCUMENT_JOB_NAME));
  }

  async function seeded(): Promise<Db> {
    const db = createTestDb();
    await truncateAll(db);
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Manager 1" });
    const created = await createLeague({ db, clock: FIRST, newId: () => "league_1" }, {
      name: "Harvest League", format: "snake", teamCount: 12, scoringPreset: "ppr", auctionBudget: null,
      rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
      experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
    });
    if (!created.ok) throw new Error(created.reason);
    await db.insert(players).values({ id: "rb1", name: "Volume Back", position: "RB", nflTeam: "SF", adp: 11 });
    return db;
  }

  it("enqueues nothing on a first capture, since there is no claim it contradicts", async () => {
    const db = await seeded();

    await runCaptureHarvestStep(db, FIRST, {}, { apiKey: "test-key", fetch: injuryFetch({ rb1: "Q" }) });

    expect(await harvestJobs(db)).toEqual([]);
  });

  it("enqueues only the players whose designation moved", async () => {
    const db = await seeded();
    await runCaptureHarvestStep(db, FIRST, {}, { apiKey: "test-key", fetch: injuryFetch({ rb1: "Q" }) });

    const outcome = await runCaptureHarvestStep(db, LATER, {}, { apiKey: "test-key", fetch: injuryFetch({ rb1: "O" }) });

    expect(outcome.summary).toContain("1 player moved, 1 rebuild enqueued");
    const enqueued = await harvestJobs(db);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.payload).toMatchObject({
      scoringHash: scoringHashOf(PPR_SCORING),
      playerIds: ["rb1"],
      reason: "harvest:2026-09-02T13:00:00.000Z",
    });
  });

  it("enqueues nothing when the capture is unchanged", async () => {
    const db = await seeded();
    await runCaptureHarvestStep(db, FIRST, {}, { apiKey: "test-key", fetch: injuryFetch({ rb1: "Q" }) });

    const outcome = await runCaptureHarvestStep(db, LATER, {}, { apiKey: "test-key", fetch: injuryFetch({ rb1: "Q" }) });

    expect(outcome.summary).toContain("0 players moved, 0 rebuilds enqueued");
    expect(await harvestJobs(db)).toEqual([]);
  });

  /**
   * THE BUG THIS PINS (fix round, 2026-09-07). The diff used to compare the archive's two newest
   * rows on every fire, and those rows do not change when a fire captures nothing. So after ONE
   * designation moved, every hourly fire for the rest of the day re-reported the same player under a
   * fresh `harvest:<now>` key that could never coalesce with the last: seventeen spurious
   * generations a day per scoring hash, each one a full rebuild of documents nothing had moved.
   */
  it("does not re-enqueue the same move on the next unchanged fire", async () => {
    const db = await seeded();
    await runCaptureHarvestStep(db, FIRST, {}, { apiKey: "test-key", fetch: injuryFetch({ rb1: "Q" }) });
    await runCaptureHarvestStep(db, LATER, {}, { apiKey: "test-key", fetch: injuryFetch({ rb1: "O" }) });
    expect(await harvestJobs(db)).toHaveLength(1);

    const later = { now: () => "2026-09-02T14:00:00.000Z" };
    const outcome = await runCaptureHarvestStep(db, later, {}, { apiKey: "test-key", fetch: injuryFetch({ rb1: "O" }) });

    expect(outcome.summary).toContain("0 players moved, 0 rebuilds enqueued");
    expect(await harvestJobs(db)).toHaveLength(1);
  });

  it("names nobody when only a feed no document reads was captured", async () => {
    const db = await seeded();
    await runCaptureHarvestStep(db, FIRST, {}, { apiKey: "test-key", fetch: injuryFetch({ rb1: "Q" }) });

    // The injuries feed answers identically (so it writes no row) while the depth-chart feed's own
    // body moves, which captures a row for a feed the peek document does not read at all.
    const depthMoved: typeof globalThis.fetch = (async (url: unknown) => {
      const parsed = new URL(url as string);
      if (parsed.pathname.toLowerCase().includes("injur")) {
        return new Response(JSON.stringify({ body: { injList: [{ playerID: "rb1", designation: "Q" }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ body: { path: parsed.pathname, moved: true } }), { status: 200 });
    }) as typeof globalThis.fetch;
    const outcome = await runCaptureHarvestStep(db, LATER, {}, { apiKey: "test-key", fetch: depthMoved });

    expect(outcome.summary).toContain("0 players moved, 0 rebuilds enqueued");
    expect(await harvestJobs(db)).toEqual([]);
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
