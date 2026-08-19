import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import Redis from "ioredis";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Db } from "@/db/client";
import { drafts, leagues, matchups, playerStatLines, players, rosterSlots, statWeeks, teams, users } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import { writeSchedule } from "@/league-service/schedule";
import type { PublishFn } from "@/lib/realtime/publish";
import { createRequestBudget, type RequestBudget } from "./budget";
import { STATS_INGESTION_CONFIG } from "./config";
import type { ScoreUpdatePayload } from "./contract";
import { fakeStatsProvider, type FakeStatsProviderScript, type ScriptedGame } from "./test-support";
import { createIngestionWorker } from "./worker";

// Lets one test force `finalizeWeek` to throw for a single named league, without disturbing
// every other test's real scoring — the mock delegates to the real implementation by default.
let throwFinalizeForLeague: string | null = null;
vi.mock("./finalize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./finalize")>();
  return {
    ...actual,
    finalizeWeek: vi.fn(async (db: Parameters<typeof actual.finalizeWeek>[0], leagueId: string, week: number) => {
      if (leagueId === throwFinalizeForLeague) throw new Error("simulated finalize failure");
      return actual.finalizeWeek(db, leagueId, week);
    }),
  };
});

// Lets one test force `persistTick` to throw exactly once (a simulated transient Postgres
// failure AFTER a box score has already been fetched), then fall through to the real
// implementation on every other call — including the very next tick in the same test, which is
// the recovery half of that test.
let throwPersistOnce = false;
vi.mock("./persist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./persist")>();
  return {
    ...actual,
    persistTick: vi.fn(async (db: Parameters<typeof actual.persistTick>[0], input: Parameters<typeof actual.persistTick>[1]) => {
      if (throwPersistOnce) {
        throwPersistOnce = false;
        throw new Error("simulated persist failure");
      }
      return actual.persistTick(db, input);
    }),
  };
});

const db = createTestDb();
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const redis = new Redis(REDIS_URL);
const now = "2026-09-14T20:00:00.000Z";
const clock = { now: () => now };
const budget = createRequestBudget({ redis, clock });

const SLOTS = [{ slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] }];

beforeEach(async () => {
  await truncateAll(db);
  const keys = await redis.keys("stats:*");
  if (keys.length > 0) await redis.unlink(...keys);
});

afterEach(() => {
  throwFinalizeForLeague = null;
  throwPersistOnce = false;
});

afterAll(async () => {
  await truncateAll(db);
  const keys = await redis.keys("stats:*");
  if (keys.length > 0) await redis.unlink(...keys);
  redis.disconnect();
});

function statLine(playerId: string, week: number, over: Partial<StatLine> = {}): StatLine {
  return {
    playerId, week, passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0,
    rushingTouchdowns: 0, receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
    fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
    ...over,
  };
}

async function seedPlayers(ids: readonly string[]): Promise<void> {
  await db.insert(players).values(ids.map((id) => ({ id, name: id, position: "QB" as const, nflTeam: "KC" }))).onConflictDoNothing();
}

/** A league shell: users, the league row, its teams and its draft. A schedule (and matchups
 *  rows) is only written for two or more teams — matching `writeSchedule`'s own behavior — so a
 *  single-team fixture naturally has no `matchups` row for the ingestion worker's finalize path
 *  to find, which is exactly what the affected-teams-only test cases below want. */
async function seedLeagueShell(
  leagueId: string,
  teamSpecs: readonly { readonly teamId: string; readonly userId: string }[],
  draftStatus: "scheduled" | "complete",
  weeks = 3,
): Promise<void> {
  await db.insert(users).values(teamSpecs.map((t) => ({ id: t.userId, email: `${t.userId}@test.local`, displayName: t.userId })));
  await db.insert(leagues).values({
    id: leagueId, name: leagueId, format: "snake", teamCount: teamSpecs.length,
    commissionerUserId: teamSpecs[0]!.userId, rosterSlots: SLOTS,
  });
  await db.insert(teams).values(teamSpecs.map((t) => ({ id: t.teamId, leagueId, userId: t.userId, name: t.teamId })));
  await db.insert(drafts).values({
    id: `${leagueId}_draft`, leagueId, format: "snake", status: draftStatus,
    kickoffAt: new Date("2026-09-01T00:00:00.000Z"), auctionBudget: null,
  });
  if (teamSpecs.length >= 2) {
    await db.transaction((tx) => writeSchedule(tx, { leagueId, teamIds: teamSpecs.map((t) => t.teamId), weeks }));
  }
}

async function addRoster(teamId: string, playerId: string): Promise<void> {
  await db.insert(rosterSlots).values({ teamId, slot: "QB", slotIndex: 0, playerId });
}

function publishRecorder() {
  const calls: { leagueId: string; type: string; payload: unknown }[] = [];
  const fn: PublishFn = async (input) => {
    calls.push(input);
    return "1-0";
  };
  return { fn, calls };
}

describe("createIngestionWorker", () => {
  it("a week whose games are all scheduled costs one request and writes nothing", async () => {
    const script: FakeStatsProviderScript = {
      games: { 1: [{ gameId: "g_sched", week: 1, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    };
    const provider = fakeStatsProvider(script);
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    await worker.tick();

    expect(listGamesSpy).toHaveBeenCalledWith(1);
    expect(getGameStatLinesSpy).not.toHaveBeenCalled();
    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(week).toMatchObject({ status: "scheduled", version: 0, gamesTotal: 1, gamesFinal: 0 });
    expect(await db.select().from(playerStatLines).where(eq(playerStatLines.week, 1))).toHaveLength(0);
  });

  it("final-only fetches a game's box score the tick it turns final, and never again", async () => {
    await seedPlayers(["p1"]);
    const script: FakeStatsProviderScript = {
      games: { 1: [{ gameId: "g_final_only", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    };
    const provider = fakeStatsProvider(script);
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    await worker.tick(); // tick 1: in progress, no fetch
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(0);

    script.games[1] = [{
      gameId: "g_final_only", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
      lines: [statLine("p1", 1, { passingYards: 200, passingTouchdowns: 2 })],
    }];
    await worker.tick(); // tick 2: turns final, fetch
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);

    await worker.tick(); // tick 3: still final, the redis marker stops a refetch
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);
  });

  it("a persist failure after a successful fetch leaves no Redis trace, and the next tick recovers", async () => {
    // The failure mode Case 2 depends on not existing: a marker or snapshot write BEFORE
    // persistTick commits would make a fetched-but-never-stored game permanently unfetchable
    // under final-only mode. This forces persistTick to fail on the tick that fetches the game.
    await seedPlayers(["p1"]);
    const script: FakeStatsProviderScript = {
      games: {
        1: [{
          gameId: "g_persist_fail", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
          lines: [statLine("p1", 1, { passingYards: 200, passingTouchdowns: 2 })],
        }],
      },
    };
    const provider = fakeStatsProvider(script);
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    throwPersistOnce = true;
    const outcomes = await worker.tick(); // fetches the box score, then persistTick throws
    expect(outcomes.some((o) => o.week === 1 && o.applied === false)).toBe(true);
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);

    // (a) the finalGame marker was never set
    const markerExists = await redis.exists(STATS_INGESTION_CONFIG.keys.finalGame("g_persist_fail"));
    expect(markerExists).toBe(0);
    // (b) the digest snapshot is unchanged (still empty — nothing was ever written to it)
    const snapshot = await redis.hgetall(STATS_INGESTION_CONFIG.keys.snapshot(1));
    expect(snapshot).toEqual({});
    // and nothing landed in Postgres either — persistTick itself never ran this time
    expect(await db.select().from(playerStatLines).where(eq(playerStatLines.week, 1))).toHaveLength(0);

    // (c) recovery: the NEXT tick (persistTick no longer forced to fail) refetches the same
    // game — proving final-only didn't wrongly mark it as already handled — and this time it
    // actually lands.
    const secondOutcomes = await worker.tick();
    expect(secondOutcomes.some((o) => o.week === 1 && o.applied === true)).toBe(true);
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(2);
    const lines = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 1));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ playerId: "p1", passingYards: 200 });
    expect(await redis.exists(STATS_INGESTION_CONFIG.keys.finalGame("g_persist_fail"))).toBe(1);
  });

  it("live mode fetches every non-final game every tick while the week is still open, turns final the tick it settles, and is never re-listed after", async () => {
    await seedPlayers(["p1"]);
    const script: FakeStatsProviderScript = {
      games: { 1: [{ gameId: "g_live", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    };
    const provider = fakeStatsProvider(script);
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, mode: "live" });

    await worker.tick(); // still in progress: live mode fetches it anyway
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);

    await worker.tick(); // in progress again — unlike final-only mode, live refetches every tick
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(2);

    script.games[1] = [{
      gameId: "g_live", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
      lines: [statLine("p1", 1, { passingYards: 200, passingTouchdowns: 2 })],
    }];
    await worker.tick(); // turns final: live mode still fetches it THIS tick too
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(3);
    const [settled] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(settled).toMatchObject({ status: "final" });

    // Fully ingested and final now: `weeksToExamine`'s cold-start-mid-season fix advances the
    // pointer past a genuinely settled week regardless of mode, so a further tick never re-lists
    // week 1 — no further fetch, live mode or not.
    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(3);
  });

  it("only affected leagues get a score.update, and the payload carries the week's honest state", async () => {
    await seedPlayers(["p1", "p2"]);
    await seedLeagueShell("lg_affected_a", [{ teamId: "team_a", userId: "user_a" }], "complete");
    await addRoster("team_a", "p1");
    await seedLeagueShell("lg_affected_b", [{ teamId: "team_b", userId: "user_b" }], "complete");
    await addRoster("team_b", "p2");

    const script: FakeStatsProviderScript = {
      games: {
        1: [
          {
            gameId: "g_aff_final", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
            lines: [statLine("p1", 1, { passingYards: 250, passingTouchdowns: 2 })],
          },
          { gameId: "g_aff_live", week: 1, status: "in_progress", homeNflTeam: "SF", awayNflTeam: "LAR", lines: [] },
        ],
      },
    };
    const provider = fakeStatsProvider(script);
    const { fn: publish, calls } = publishRecorder();
    const worker = createIngestionWorker({ db, provider, redis, publish, clock, budget });

    await worker.tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.leagueId).toBe("lg_affected_a");
    expect(calls[0]!.type).toBe("score.update");
    const payload = calls[0]!.payload as ScoreUpdatePayload;
    // Not all of the week's games are final (the second game is still in progress), so the week
    // itself is honestly reported as still in progress even though this one game settled.
    expect(payload).toMatchObject({ week: 1, status: "in_progress", version: 1, gamesFinal: 1, gamesTotal: 2 });
    // 250 * 0.04 + 2 * 4 = 18, under the PPR fallback (no scoring_settings row for this fixture).
    expect(payload.scores).toEqual([{ teamId: "team_a", points: 18 }]);
  });

  it("a week that turns final finalizes every drafted league in it, skips the undrafted one, and publishes a final score.update for each finalized league", async () => {
    await seedPlayers(["p1", "p2"]);
    await seedLeagueShell("lg_final_drafted", [{ teamId: "fd1", userId: "ufd1" }, { teamId: "fd2", userId: "ufd2" }], "complete", 2);
    await addRoster("fd1", "p1");
    await addRoster("fd2", "p2");
    // No rosters at all for the undrafted league — a real undrafted league has nothing to
    // roster yet, which is also what keeps it out of the affected-teams publish path below.
    await seedLeagueShell("lg_final_undrafted", [{ teamId: "fu1", userId: "ufu1" }, { teamId: "fu2", userId: "ufu2" }], "scheduled", 2);

    const script: FakeStatsProviderScript = {
      games: {
        1: [{
          gameId: "g_finalize", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
          lines: [statLine("p1", 1, { passingYards: 300, passingTouchdowns: 3 }), statLine("p2", 1, { passingYards: 100 })],
        }],
      },
    };
    const provider = fakeStatsProvider(script);
    const { fn: publish, calls } = publishRecorder();
    const worker = createIngestionWorker({ db, provider, redis, publish, clock, budget });

    await worker.tick();

    const [drafted] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_final_drafted"), eq(matchups.weekNumber, 1)));
    expect(drafted!.homeScore).not.toBeNull();
    expect(drafted!.awayScore).not.toBeNull();

    const [undrafted] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_final_undrafted"), eq(matchups.weekNumber, 1)));
    expect(undrafted!.homeScore).toBeNull();
    expect(undrafted!.awayScore).toBeNull();

    const finalCalls = calls.filter((c) => (c.payload as ScoreUpdatePayload).status === "final");
    expect(finalCalls.some((c) => c.leagueId === "lg_final_drafted")).toBe(true);
    expect(calls.some((c) => c.leagueId === "lg_final_undrafted")).toBe(false);
  });

  it("a denied budget reservation skips the tick without writing anything, and reports an outcome rather than throwing", async () => {
    const provider = fakeStatsProvider({
      games: { 1: [{ gameId: "g_denied", week: 1, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    });
    const deniedBudget: RequestBudget = { reserve: async () => false, remaining: async () => 0 };
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget: deniedBudget });

    const outcomes = await worker.tick();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ applied: false });

    expect(await db.select().from(statWeeks)).toHaveLength(0);
  });

  it("one examined week's failure does not stop the other week in the same tick", async () => {
    // `maxWeeksPerTick` examines week 1 and week 2 together on a fresh database. `listGames`
    // throws for week 1 only — week 2 must still be recorded, mirroring the draft ticker's
    // per-draft isolation one level up (per-week, not per-league).
    const script: FakeStatsProviderScript = {
      games: { 2: [{ gameId: "g_week2_ok", week: 2, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    };
    const provider = fakeStatsProvider(script);
    vi.spyOn(provider, "listGames").mockImplementation(async (week: number) => {
      if (week === 1) throw new Error("simulated upstream failure for week 1");
      return script.games[week]?.map(({ gameId, week: w, status, homeNflTeam, awayNflTeam }) => ({ gameId, week: w, status, homeNflTeam, awayNflTeam })) ?? [];
    });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    const outcomes = await worker.tick();

    const weekOneOutcome = outcomes.find((o) => o.week === 1);
    expect(weekOneOutcome).toMatchObject({ applied: false });
    const weekTwoOutcome = outcomes.find((o) => o.week === 2);
    expect(weekTwoOutcome).toMatchObject({ applied: true });

    const [weekTwoRow] = await db.select().from(statWeeks).where(eq(statWeeks.week, 2));
    expect(weekTwoRow).toMatchObject({ status: "scheduled" });
  });

  it("one league's failure does not stop the tick — the other league is still finalized", async () => {
    throwFinalizeForLeague = "lg_isolate_a";
    await seedPlayers(["p1", "p2"]);
    await seedLeagueShell("lg_isolate_a", [{ teamId: "ia1", userId: "uia1" }, { teamId: "ia2", userId: "uia2" }], "complete", 2);
    await addRoster("ia1", "p1");
    await addRoster("ia2", "p2");
    await seedLeagueShell("lg_isolate_b", [{ teamId: "ib1", userId: "uib1" }, { teamId: "ib2", userId: "uib2" }], "complete", 2);
    await addRoster("ib1", "p1");
    await addRoster("ib2", "p2");

    const script: FakeStatsProviderScript = {
      games: {
        1: [{
          gameId: "g_isolate", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
          lines: [statLine("p1", 1, { passingYards: 300, passingTouchdowns: 3 }), statLine("p2", 1, { passingYards: 100 })],
        }],
      },
    };
    const provider = fakeStatsProvider(script);
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    const outcomes = await worker.tick();
    expect(outcomes.some((o) => o.applied === true)).toBe(true);

    const [a] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_isolate_a"), eq(matchups.weekNumber, 1)));
    expect(a!.homeScore).toBeNull();

    const [b] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_isolate_b"), eq(matchups.weekNumber, 1)));
    expect(b!.homeScore).not.toBeNull();
  });

  it("publishing failure never fails the write — the stat lines and stat_weeks are still committed", async () => {
    await seedPlayers(["p1"]);
    await seedLeagueShell("lg_pubfail", [{ teamId: "pf1", userId: "upf1" }], "complete");
    await addRoster("pf1", "p1");

    const script: FakeStatsProviderScript = {
      games: {
        1: [{
          gameId: "g_pubfail", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
          lines: [statLine("p1", 1, { passingYards: 300, passingTouchdowns: 3 })],
        }],
      },
    };
    const provider = fakeStatsProvider(script);
    const publish: PublishFn = async () => {
      throw new Error("simulated publish failure");
    };
    const worker = createIngestionWorker({ db, provider, redis, publish, clock, budget });

    await expect(worker.tick()).resolves.toBeDefined();

    expect(await db.select().from(playerStatLines).where(eq(playerStatLines.week, 1))).toHaveLength(1);
    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(week!.version).toBe(1);
  });

  it("tick() does not overlap itself under start()", async () => {
    // Real timers throughout (not `vi.useFakeTimers()`): the tick this drives makes real
    // Postgres/Redis calls, and faking global timers alongside a real DB driver in the same
    // file risks stalling those drivers' own internal timeouts. `intervalMs` is just short
    // enough that a handful of real 20ms waits below cover several interval periods.
    let releaseListGames: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseListGames = resolve;
    });
    const provider = fakeStatsProvider({ games: {} });
    vi.spyOn(provider, "listGames").mockImplementation(async () => {
      await gate;
      return [];
    });
    // `budget.reserve` is the first call `tick()` makes — a call count on it is a direct proxy
    // for "how many times has a tick actually started running", independent of where inside the
    // tick this test chooses to stall it.
    const reserveSpy = vi.spyOn(budget, "reserve");

    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, intervalMs: 20 });
    try {
      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 70)); // several interval periods, tick still stuck on `gate`
      expect(reserveSpy).toHaveBeenCalledTimes(1); // only the first fire actually ran; the guard skipped the rest

      releaseListGames?.();
      await new Promise((resolve) => setTimeout(resolve, 70)); // let it finish, then fire again
      expect(reserveSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      releaseListGames?.();
      worker.stop();
      reserveSpy.mockRestore();
    }
  });

  it("start()'s outer catch survives a failure before per-week isolation begins, and the interval keeps running", async () => {
    // `weeksToExamine` is the very first thing `tick()` does, before `budget.reserve` and
    // before the per-week `try/catch` even exists. A `db` outage there (or `budget.reserve`
    // itself throwing instead of failing closed, which it's designed not to) propagates out of
    // `tick()` uncaught by anything inside it — only `start()`'s own outer `.catch()` stands
    // between that and an unhandled rejection killing the interval for good.
    const throwingDb = new Proxy(db, {
      get(target, prop, receiver: unknown) {
        if (prop === "select") {
          return (): never => {
            throw new Error("simulated db outage before weeksToExamine can run");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const provider = fakeStatsProvider({ games: {} });
    const worker = createIngestionWorker({
      db: throwingDb as Db, provider, redis, publish: publishRecorder().fn, clock, budget, intervalMs: 20,
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      worker.start();
      await new Promise((resolve) => setTimeout(resolve, 70)); // several interval periods

      const tickerFailures = consoleErrorSpy.mock.calls.filter((args) => args[0] === "[stats-pipeline] ticker failed");
      // More than one failure logged proves `running` reset after each throw rather than
      // freezing the interval forever after the first one — which is the whole point of the
      // outer catch existing at all.
      expect(tickerFailures.length).toBeGreaterThanOrEqual(2);
    } finally {
      worker.stop();
      consoleErrorSpy.mockRestore();
    }
  });

  it("cold start mid-season: reaches and ingests the live week within a bounded number of ticks, never re-listing a finalized week", async () => {
    // Weeks 1-5 already final on the calendar, week 6 in progress — exactly the shape of
    // starting the pipeline for the first time partway through a season, or restarting after an
    // outage spanning more than `maxWeeksPerTick - 1` weeks. On a totally EMPTY `stat_weeks`
    // table, the old fallback ("no non-final row exists -> start at week 1") marked weeks 1-2
    // final on tick 1, found no non-final row on tick 2, and reset to week 1 forever — never
    // reaching week 6 in any number of ticks. The fix resumes at `MAX(week) + 1` once every
    // EXISTING row is final, so the pointer walks 1-2, 3-4, 5-6 and converges in bounded ticks.
    const script: FakeStatsProviderScript = {
      games: {
        1: [{ gameId: "g_w1", week: 1, status: "final", homeNflTeam: "A1", awayNflTeam: "A2", lines: [] }],
        2: [{ gameId: "g_w2", week: 2, status: "final", homeNflTeam: "B1", awayNflTeam: "B2", lines: [] }],
        3: [{ gameId: "g_w3", week: 3, status: "final", homeNflTeam: "C1", awayNflTeam: "C2", lines: [] }],
        4: [{ gameId: "g_w4", week: 4, status: "final", homeNflTeam: "D1", awayNflTeam: "D2", lines: [] }],
        5: [{ gameId: "g_w5", week: 5, status: "final", homeNflTeam: "E1", awayNflTeam: "E2", lines: [] }],
        6: [{ gameId: "g_w6", week: 6, status: "in_progress", homeNflTeam: "F1", awayNflTeam: "F2", lines: [] }],
      },
    };
    const provider = fakeStatsProvider(script);
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    // Generous but bounded: `ceil(6 / maxWeeksPerTick)` is the minimum ticks a correct
    // implementation needs (1-2, 3-4, 5-6); the old bug never converged in ANY number of ticks,
    // so this loop existing at all — and terminating — is itself part of the proof.
    const MAX_TICKS = Math.ceil(6 / STATS_INGESTION_CONFIG.maxWeeksPerTick) + 1;
    let reachedLiveWeek = false;
    for (let i = 0; i < MAX_TICKS && !reachedLiveWeek; i++) {
      await worker.tick();
      const [week6] = await db.select().from(statWeeks).where(eq(statWeeks.week, 6));
      reachedLiveWeek = week6?.status === "in_progress";
    }

    expect(reachedLiveWeek).toBe(true);

    // Each already-settled week was examined exactly once, on the tick that finalized it — never
    // re-listed afterward, which is the failure mode the fix closes.
    for (const settledWeek of [1, 2, 3, 4, 5]) {
      expect(listGamesSpy.mock.calls.filter(([week]) => week === settledWeek)).toHaveLength(1);
    }
  });

  it("resumes at the week after the settled history, not week 1, once every existing row is final", async () => {
    // The shape two prior ticks would have left behind: weeks 1 and 2 both settled. This is
    // exactly the state that used to fall back to week 1 forever.
    await db.insert(statWeeks).values([
      { week: 1, status: "final" },
      { week: 2, status: "final" },
    ]);
    const script: FakeStatsProviderScript = {
      games: { 3: [{ gameId: "g_w3", week: 3, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    };
    const provider = fakeStatsProvider(script);
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    await worker.tick();

    expect(listGamesSpy).toHaveBeenCalledWith(3);
    expect(listGamesSpy).not.toHaveBeenCalledWith(1);
    expect(listGamesSpy).not.toHaveBeenCalledWith(2);
  });

  it("a week's final games exceeding maxGamesPerTick's budget stay in_progress until every one is ingested, over two ticks", async () => {
    // More final games in one week than a single tick's budget can fetch — a real Sunday's ~16
    // games can still exceed `maxGamesPerTick` once a second examined week's own budget share is
    // subtracted, and this is the boundary case: everything in ONE week alone.
    const gameCount = STATS_INGESTION_CONFIG.maxGamesPerTick + 5;
    const games: ScriptedGame[] = Array.from({ length: gameCount }, (_, i) => ({
      gameId: `g_budget_${i}`, week: 1, status: "final", homeNflTeam: `H${i}`, awayNflTeam: `A${i}`, lines: [],
    }));
    const script: FakeStatsProviderScript = { games: { 1: games } };
    const provider = fakeStatsProvider(script);
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    await worker.tick(); // fetches only the first maxGamesPerTick box scores
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(STATS_INGESTION_CONFIG.maxGamesPerTick);
    const [afterFirstTick] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    // The provider reports every game final, but not every final game's box score has been
    // ingested yet — the week must not be marked final on the provider's word alone, or the
    // unfetched games' points would never be fetched again (a final week is never re-examined).
    expect(afterFirstTick).toMatchObject({ status: "in_progress", gamesFinal: gameCount });

    await worker.tick(); // fetches the remainder — and only now finalizes
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(gameCount);
    const [afterSecondTick] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(afterSecondTick).toMatchObject({ status: "final" });
  });
});
