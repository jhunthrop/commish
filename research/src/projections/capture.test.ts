import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { desc } from "drizzle-orm";
import { createTestDb, truncateAll } from "@research/db/test-db";
import { captureSnapshots } from "@research/db/schema";
import type { Tank01Client } from "@research/stats/tank01/client";
import { Tank01Error } from "@research/stats/tank01/client";
import { captureOnce, type CaptureDeps } from "./capture";
import { cadenceAllows, freshnessSeconds, requestCostOf, CAPTURE_CONFIG, CAPTURE_FEEDS } from "./capture-feeds";

const db = createTestDb();

/** A Thursday — a game day, so every cadence is permitted. */
const THURSDAY = "2026-09-10T15:00:00.000Z";
/** A Wednesday — no NFL game, so the game-day feeds stand down. */
const WEDNESDAY = "2026-09-09T15:00:00.000Z";

beforeEach(async () => {
  await db.execute("TRUNCATE TABLE capture_snapshots RESTART IDENTITY");
});

afterAll(async () => {
  await truncateAll(db);
  await db.execute("TRUNCATE TABLE capture_snapshots RESTART IDENTITY");
});

/** An in-memory stand-in for the attempt keys the real job holds in Redis. */
function fakeFreshness() {
  const held = new Map<string, string>();
  return {
    held,
    markFresh: async (key: string) => {
      held.set(key, "1");
    },
    isFresh: async (key: string) => held.has(key),
  };
}

function client(answer: (path: string) => unknown = (path) => ({ ok: path })): Tank01Client & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      return answer(path);
    },
  };
}

type TestDeps = CaptureDeps & { readonly held: Map<string, string> };

function deps(over: Partial<CaptureDeps> = {}): TestDeps {
  const freshness = fakeFreshness();
  return {
    db,
    client: client(),
    clock: { now: () => THURSDAY },
    budget: { reserve: async () => ({ granted: true }) },
    season: 2026,
    week: 2,
    teams: ["BUF", "KC"],
    ...freshness,
    ...over,
  };
}

async function snapshots(source?: string) {
  const rows = await db.select().from(captureSnapshots).orderBy(desc(captureSnapshots.id));
  return source === undefined ? rows : rows.filter((row) => row.source === source);
}

describe("cadence rules", () => {
  it("stands the game-day feeds down midweek and lets them run Thursday to Monday", () => {
    expect(cadenceAllows("game-day", new Date(WEDNESDAY))).toBe(false);
    expect(cadenceAllows("game-day", new Date(THURSDAY))).toBe(true);
    expect(cadenceAllows("game-day", new Date("2026-09-14T15:00:00Z"))).toBe(true); // Monday
  });

  it("lets daily and weekly feeds run any day", () => {
    expect(cadenceAllows("daily", new Date(WEDNESDAY))).toBe(true);
    expect(cadenceAllows("weekly", new Date(WEDNESDAY))).toBe(true);
  });

  it("holds a daily capture fresh for slightly under a day, so it cannot drift past one", () => {
    expect(freshnessSeconds("daily")).toBeLessThan(24 * 3600);
    expect(freshnessSeconds("daily")).toBeGreaterThan(12 * 3600);
  });

  /**
   * THE 200-WITH-A-REFUSAL (2026-08-28). Both game-day feeds shipped asking for a `gameWeek`, and
   * Tank01 answers that with HTTP 200 and the complaint in the BODY: "Need to pass gameID or
   * gameDate as parameter", "Invalid date. Date must be in format YYYYMMDD". Nothing threw,
   * nothing was captured, and the two feeds that cannot be backfilled were the two that stayed
   * silent — for a day, until the server log was read.
   *
   * Both are addressed by DATE. Pinning the parameter names is cheap insurance against a class of
   * failure this capture cannot afford, because a feed that quietly writes nothing is
   * indistinguishable from a feed with nothing to say, and the difference is a day of data that
   * does not exist anywhere else.
   */
  it("addresses the two game-day feeds by date, because a week is a 200 with a refusal in it", () => {
    const context = { season: 2026, week: 2, day: "20260912", teams: ["BUF"] };
    const queried = (source: string): Readonly<Record<string, string>> =>
      CAPTURE_FEEDS.find((feed) => feed.source === source)!.requests(context)[0]!.query;

    expect(queried("tank01_betting_odds")).toEqual({ gameDate: "20260912" });
    expect(queried("tank01_dfs_salaries")).toEqual({ date: "20260912" });
    // The failure that started this: neither may ask for a week.
    for (const source of ["tank01_betting_odds", "tank01_dfs_salaries"]) {
      expect(Object.keys(queried(source))).not.toContain("gameWeek");
      expect(Object.keys(queried(source))).not.toContain("week");
    }
  });

  it("prices a whole pass, counting the injury feed's fan-out over teams", () => {
    const context = { season: 2026, week: 2, day: "20260912", teams: ["BUF", "KC", "SF"] };
    expect(requestCostOf(CAPTURE_FEEDS, context)).toBe(CAPTURE_FEEDS.length - 1 + 3);
  });

  it("says of every feed why it cannot be backfilled", () => {
    expect(CAPTURE_FEEDS.every((feed) => feed.irrecoverable.length > 20)).toBe(true);
  });
});

describe("captureOnce", () => {
  it("stamps every snapshot with the moment WE fetched it, from the injected clock", async () => {
    await captureOnce(deps());
    const rows = await snapshots();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.capturedAt.toISOString() === THURSDAY)).toBe(true);
  });

  it("stores the upstream body verbatim, so a mapper can be written against it later", async () => {
    await captureOnce(deps({ client: client(() => ({ body: [{ playerID: "1", injury: "Questionable" }] })) }));
    const [row] = await snapshots("tank01_depth_charts");
    expect(row?.payload).toEqual({ body: [{ playerID: "1", injury: "Questionable" }] });
  });

  it("captures every daily and weekly feed midweek, and no game-day feed", async () => {
    const result = await captureOnce(deps({ clock: { now: () => WEDNESDAY } }));
    const captured = result.feeds.filter((feed) => feed.status === "captured").map((feed) => feed.source);
    expect(captured).toContain("tank01_injuries");
    expect(captured).not.toContain("tank01_betting_odds");
    expect(captured).not.toContain("tank01_dfs_salaries");
  });

  it("writes nothing on a second run over unchanged data", async () => {
    const shared = deps();
    await captureOnce(shared);
    const first = (await snapshots()).length;
    // Freshness is what stops the second poll happening at all; clear it to prove the DIGEST is
    // an independent guard, so a restart that loses Redis still cannot duplicate a row.
    shared.held.clear();
    const second = await captureOnce(shared);
    expect((await snapshots()).length).toBe(first);
    expect(second.feeds.every((feed) => feed.status === "unchanged")).toBe(true);
  });

  it("writes a new row the moment the feed actually changes", async () => {
    let designation = "Questionable";
    const shared = deps({ client: client(() => ({ status: designation })) });
    await captureOnce(shared);
    shared.held.clear();
    designation = "Out";
    await captureOnce(shared);

    const rows = await snapshots("tank01_depth_charts");
    expect(rows.map((row) => row.payload)).toEqual([{ status: "Out" }, { status: "Questionable" }]);
  });

  it("skips a feed that is still fresh, without spending a request on it", async () => {
    const spy = client();
    const shared = deps({ client: spy });
    await captureOnce(shared);
    const callsAfterFirst = spy.calls.length;
    await captureOnce(shared);
    expect(spy.calls.length).toBe(callsAfterFirst);
  });

  it("marks a feed fresh under its own key, so one feed's cadence never gates another's", async () => {
    const shared = deps();
    await captureOnce(shared);
    expect(shared.held.has(CAPTURE_CONFIG.attemptKey("tank01_injuries"))).toBe(true);
    expect(shared.held.has(CAPTURE_CONFIG.attemptKey("tank01_betting_odds"))).toBe(true);
  });

  it("reports a feed whose upstream request failed, and captures the rest anyway", async () => {
    const failing = client((path) => {
      if (path.includes("DepthCharts")) throw new Tank01Error("upstream", path, "boom");
      return { ok: true };
    });
    const result = await captureOnce(deps({ client: failing }));

    const depthCharts = result.feeds.find((feed) => feed.source === "tank01_depth_charts")!;
    expect(depthCharts).toMatchObject({ status: "failed", reason: expect.stringContaining("boom") });
    expect(result.feeds.some((feed) => feed.source === "tank01_news" && feed.status === "captured")).toBe(true);
  });

  it("does not mark a failed feed fresh — it retries on the next tick rather than waiting a day", async () => {
    const failing = client((path) => {
      if (path.includes("DepthCharts")) throw new Tank01Error("upstream", path, "boom");
      return { ok: true };
    });
    const shared = deps({ client: failing });
    await captureOnce(shared);
    expect(shared.held.has(CAPTURE_CONFIG.attemptKey("tank01_depth_charts"))).toBe(false);
  });

  it("captures nothing at all when the request budget refuses", async () => {
    const spy = client();
    const result = await captureOnce(
      deps({ client: spy, budget: { reserve: async () => ({ granted: false, denial: "budget-exhausted" }) } }),
    );
    expect(spy.calls).toEqual([]);
    expect(result.reason).toMatch(/budget/i);
    expect(await snapshots()).toEqual([]);
  });

  it("reserves exactly what the due feeds will spend, never a worst case", async () => {
    const reserved: number[] = [];
    await captureOnce(
      deps({
        clock: { now: () => WEDNESDAY },
        budget: {
          reserve: async (count: number) => {
            reserved.push(count);
            return { granted: true };
          },
        },
      }),
    );
    // Midweek: the three game-day feeds (odds, DFS, inactives) stand down, and the injury feed
    // fans out over two teams.
    expect(reserved).toEqual([CAPTURE_FEEDS.length - 3 - 1 + 2]);
  });

  it("does nothing and spends nothing when every feed is fresh", async () => {
    const spy = client();
    const shared = deps({ client: spy });
    await captureOnce(shared);
    const reserved: number[] = [];
    await captureOnce({
      ...shared,
      client: spy,
      budget: {
        reserve: async (count: number) => {
          reserved.push(count);
          return { granted: true };
        },
      },
    });
    expect(reserved).toEqual([]);
  });

  it("keeps a multi-request feed's responses together as one snapshot, in team order", async () => {
    const result = await captureOnce(
      deps({ client: client((path) => ({ path })), teams: ["BUF", "KC", "SF"] }),
    );
    expect(result.feeds.find((feed) => feed.source === "tank01_injuries")?.requests).toBe(3);
    const [row] = await snapshots("tank01_injuries");
    expect(Array.isArray(row?.payload)).toBe(true);
    expect((row?.payload as unknown[]).length).toBe(3);
  });
});
