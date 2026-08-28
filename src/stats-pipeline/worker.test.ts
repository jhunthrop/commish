import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import Redis from "ioredis";
import { createTestDb, truncateAll } from "@/db/test-db";
import { crossLeagueHome } from "@/league-service/home";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import type { Db } from "@/db/client";
import { drafts, leagues, matchups, playerStatLines, players, rosterSlots, statWeeks, teams, users } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import { writeSchedule } from "@/league-service/schedule";
import type { PublishFn } from "@/lib/realtime/publish";
import { createRequestBudget, type RequestBudget } from "./budget";
import { STATS_INGESTION_CONFIG } from "./config";
import type { ScoreUpdatePayload } from "./contract";
import { createScoreCache } from "./score-cache";
import { fakeStatsProvider, type FakeStatsProviderScript, type ScriptedGame } from "./test-support";
import { createIngestionWorker, examinationWindow } from "./worker";

// Lets one test force `finalizeWeek` to throw for a single named league, without disturbing
// every other test's real scoring — the mock delegates to the real implementation by default.
let throwFinalizeForLeague: string | null = null;
vi.mock("./finalize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./finalize")>();
  return {
    ...actual,
    // Every argument forwarded, including the injected score cache: a mock that quietly drops a
    // parameter is a mock that proves the caller passes it and the callee ignores it.
    finalizeWeek: vi.fn(async (...args: Parameters<typeof actual.finalizeWeek>) => {
      if (args[1] === throwFinalizeForLeague) throw new Error("simulated finalize failure");
      return actual.finalizeWeek(...args);
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
  it("a week whose games are all scheduled debits one schedule request, fetches no box score and writes only the week's row", async () => {
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
    const deniedBudget: RequestBudget = {
      reserve: async () => ({ granted: false, denial: "budget-exhausted" }),
      reserveBackfill: async () => ({ granted: false, denial: "budget-exhausted" }),
      remaining: async () => 0,
    };
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget: deniedBudget });

    const outcomes = await worker.tick();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ applied: false });

    expect(await db.select().from(statWeeks)).toHaveLength(0);
  });

  it("reportIfDue suppresses a repeat of the same outcome inside warnIntervalMs, and reports again once it's passed", async () => {
    let ts = "2026-09-14T20:00:00.000Z";
    const localClock = { now: () => ts };
    const provider = fakeStatsProvider({
      games: { 1: [{ gameId: "g_denied2", week: 1, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    });
    const deniedBudget: RequestBudget = {
      reserve: async () => ({ granted: false, denial: "budget-exhausted" }),
      reserveBackfill: async () => ({ granted: false, denial: "budget-exhausted" }),
      remaining: async () => 0,
    };
    const onOutcome = vi.fn();
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: localClock, budget: deniedBudget, onOutcome });

    await worker.tick();
    expect(onOutcome).toHaveBeenCalledTimes(1);

    ts = "2026-09-14T20:05:00.000Z"; // 5 minutes later, well inside warnIntervalMs (60 minutes)
    await worker.tick();
    expect(onOutcome).toHaveBeenCalledTimes(1); // same outcome key, suppressed

    ts = "2026-09-14T21:05:00.000Z"; // 65 minutes after the first report, past warnIntervalMs
    await worker.tick();
    expect(onOutcome).toHaveBeenCalledTimes(2); // reported again
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

  it("start() is idempotent — a second call does not create a second interval", () => {
    const provider = fakeStatsProvider({ games: {} });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, intervalMs: 1_000_000 });
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    try {
      worker.start();
      worker.start(); // the guard this exercises: a second call must not mint a second timer
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      worker.stop();
      setIntervalSpy.mockRestore();
    }
  });

  it("stop() before start(), or a second stop(), is a no-op rather than an error", () => {
    const provider = fakeStatsProvider({ games: {} });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, intervalMs: 1_000_000 });
    expect(() => worker.stop()).not.toThrow(); // never started
    worker.start();
    worker.stop();
    expect(() => worker.stop()).not.toThrow(); // already stopped
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
      { week: 1, status: "final", updatedAt: new Date("2026-08-01T00:00:00.000Z") },
      { week: 2, status: "final", updatedAt: new Date("2026-08-01T00:00:00.000Z") },
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

  it("an empty window (season settled through the configured last week) skips the reservation entirely, and remaining() is unchanged", async () => {
    // Every week through the PROVIDER's own last week already final: the examination window
    // returns nothing to examine, ever, until next season resets the ledger. Reserving the
    // worst-case budget on an empty window anyway would drain the monthly ledger for zero work
    // every poll interval for as long as the season stays settled.
    const provider = fakeStatsProvider({ games: {}, lastWeekOfSeason: 4 });
    await db.insert(statWeeks).values(
      Array.from({ length: provider.lastWeekOfSeason }, (_, i) => ({
        week: i + 1,
        status: "final" as const,
        // Well outside the correction window, so no sweep is due either — an empty window means
        // empty, not "empty except for the sweep".
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      })),
    );
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const reserveSpy = vi.spyOn(budget, "reserve");
    const remainingBefore = await budget.remaining();
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    const outcomes = await worker.tick();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ applied: false });
    // The reservation call itself never happened — not just "happened and was granted for free".
    expect(reserveSpy).not.toHaveBeenCalled();
    expect(listGamesSpy).not.toHaveBeenCalled();
    expect(await budget.remaining()).toBe(remainingBefore);

    reserveSpy.mockRestore();
  });

  it("debits the ledger exactly what the tick actually spends upstream, in final-only mode", async () => {
    // THE C1 CASE. The tick used to reserve `weeks.length + maxGamesPerTick` — a worst case, with
    // no release path — so a month's ledger was spent in tens of ticks while the pipeline made a
    // fraction of those requests. Reservation is now two-phase: the schedule calls it is about to
    // make, then, once the schedules are in hand, the exact box scores it has decided to fetch.
    await seedPlayers(["p1"]);
    const script: FakeStatsProviderScript = {
      games: {
        1: [
          { gameId: "g_cost_final", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 120 })] },
          { gameId: "g_cost_live", week: 1, status: "in_progress", homeNflTeam: "SF", awayNflTeam: "LAR", lines: [] },
        ],
      },
    };
    const provider = fakeStatsProvider(script);
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    const before = await budget.remaining();
    await worker.tick();
    const spent = before - (await budget.remaining());

    const upstreamCalls = listGamesSpy.mock.calls.length + getGameStatLinesSpy.mock.calls.length;
    expect(upstreamCalls).toBe(3); // two weeks listed (week 2 is empty), one box score fetched
    expect(spent).toBe(upstreamCalls);
  });

  it("debits the ledger exactly what the tick actually spends upstream, in live mode", async () => {
    // Live mode fetches every non-final game every tick, so the same window costs strictly more —
    // and the ledger has to say so, or the mode that needs a bigger quota is the one the ledger
    // under-counts.
    await seedPlayers(["p1"]);
    const script: FakeStatsProviderScript = {
      games: {
        1: [
          { gameId: "g_live_cost_a", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 60 })] },
          { gameId: "g_live_cost_b", week: 1, status: "in_progress", homeNflTeam: "SF", awayNflTeam: "LAR", lines: [] },
        ],
      },
    };
    const provider = fakeStatsProvider(script);
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, mode: "live" });

    const before = await budget.remaining();
    await worker.tick();
    const spent = before - (await budget.remaining());

    const upstreamCalls = listGamesSpy.mock.calls.length + getGameStatLinesSpy.mock.calls.length;
    expect(upstreamCalls).toBe(4); // two weeks listed, both of week 1's live games fetched
    expect(spent).toBe(upstreamCalls);
  });

  it("a box-score reservation denied after the schedules are in keeps the week's status honest and fetches nothing", async () => {
    // Phase two of the reservation can be denied on its own. The schedules are already paid for,
    // so the week's game counts are still worth persisting — but the week must not be marked
    // final off the provider's word when none of its box scores were actually ingested.
    await seedPlayers(["p1"]);
    const provider = fakeStatsProvider({
      games: {
        1: [{ gameId: "g_phase2", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 200 })] }],
      },
    });
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    let call = 0;
    const scheduleOnlyBudget: RequestBudget = {
      reserve: async () => (++call === 1 ? { granted: true } : { granted: false, denial: "budget-exhausted" }),
      reserveBackfill: async () => ({ granted: true }),
      remaining: async () => 0,
    };
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget: scheduleOnlyBudget });

    await worker.tick();

    expect(getGameStatLinesSpy).not.toHaveBeenCalled();
    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(week).toMatchObject({ status: "in_progress", gamesTotal: 1, gamesFinal: 1 });
  });

  it("names WHY a reservation was denied, so an exhausted budget and an unreachable ledger read differently", async () => {
    const provider = fakeStatsProvider({ games: { 1: [{ gameId: "g_why", week: 1, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] } });
    const outOfBudget: RequestBudget = {
      reserve: async () => ({ granted: false, denial: "budget-exhausted" }),
      reserveBackfill: async () => ({ granted: false, denial: "budget-exhausted" }),
      remaining: async () => 0,
    };
    const noLedger: RequestBudget = {
      reserve: async () => ({ granted: false, denial: "ledger-unavailable" }),
      reserveBackfill: async () => ({ granted: false, denial: "ledger-unavailable" }),
      remaining: async () => 0,
    };

    const [exhausted] = await createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget: outOfBudget }).tick();
    const [unavailable] = await createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget: noLedger }).tick();

    expect(exhausted!.reason).toMatch(/budget is spent/);
    expect(unavailable!.reason).toMatch(/ledger could not be reached/);
    expect(exhausted!.reason).not.toBe(unavailable!.reason);
  });

  it("skips the tick entirely while another instance holds the lease", async () => {
    await redis.set(STATS_INGESTION_CONFIG.keys.tickLease, "another-instance", "PX", 30_000);
    const provider = fakeStatsProvider({
      games: { 1: [{ gameId: "g_leased", week: 1, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    });
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const reserveSpy = vi.spyOn(budget, "reserve");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    try {
      const outcomes = await worker.tick();

      expect(outcomes).toEqual([{ week: 0, applied: false, reason: "Another instance is already running this tick." }]);
      expect(reserveSpy).not.toHaveBeenCalled();
      expect(listGamesSpy).not.toHaveBeenCalled();
      expect(await db.select().from(statWeeks)).toHaveLength(0);
      // Someone else's lease is still someone else's: a skipped tick must never release it.
      expect(await redis.get(STATS_INGESTION_CONFIG.keys.tickLease)).toBe("another-instance");
    } finally {
      reserveSpy.mockRestore();
    }
  });

  it("releases its own lease on the way out, so the next tick runs", async () => {
    const provider = fakeStatsProvider({
      games: { 1: [{ gameId: "g_lease_release", week: 1, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    });
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    await worker.tick();
    expect(await redis.exists(STATS_INGESTION_CONFIG.keys.tickLease)).toBe(0);

    await worker.tick();
    expect(listGamesSpy.mock.calls.filter(([week]) => week === 1)).toHaveLength(2);
  });

  it("an expired lease lets the next tick run, so a crashed instance cannot freeze the pipeline", async () => {
    // The lease is held for one poll interval and then expires on its own. An instance that dies
    // mid-tick therefore costs at most one interval, never a stuck pipeline needing an operator.
    await redis.set(STATS_INGESTION_CONFIG.keys.tickLease, "crashed-instance", "PX", 40);
    const provider = fakeStatsProvider({
      games: { 1: [{ gameId: "g_lease_expiry", week: 1, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    expect((await worker.tick())[0]).toMatchObject({ applied: false });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const outcomes = await worker.tick();
    expect(outcomes.some((outcome) => outcome.week === 1 && outcome.applied)).toBe(true);
  });

  it("ticks unleased rather than not at all when Redis cannot serve the lease", async () => {
    // Best-effort BY DESIGN: an unreachable Redis means duplicate work across instances, which is
    // safe (the storage model is idempotent and the stat_weeks primary key serializes the write)
    // — where a lease that failed CLOSED would take live scoring down whenever Redis hiccuped.
    await seedPlayers(["p1"]);
    const provider = fakeStatsProvider({
      games: {
        1: [{ gameId: "g_unleased", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 90 })] }],
      },
    });
    const leaseBlindRedis = new Proxy(redis, {
      get(target, prop, receiver: unknown) {
        if (prop === "set") {
          return (...args: unknown[]) => {
            if (args[0] === STATS_INGESTION_CONFIG.keys.tickLease) throw new Error("simulated redis outage on the lease");
            return (Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const worker = createIngestionWorker({ db, provider, redis: leaseBlindRedis as Redis, publish: publishRecorder().fn, clock, budget });

    const outcomes = await worker.tick();

    expect(outcomes.some((outcome) => outcome.week === 1 && outcome.applied)).toBe(true);
    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(week).toMatchObject({ status: "final" });
  });

  it("fills the score cache for every affected league, at the version it just persisted", async () => {
    await seedPlayers(["p1"]);
    await seedLeagueShell("lg_cache", [{ teamId: "cache1", userId: "ucache1" }, { teamId: "cache2", userId: "ucache2" }], "complete", 2);
    await addRoster("cache1", "p1");
    const script: FakeStatsProviderScript = {
      games: {
        1: [
          { gameId: "g_cache_final", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 250, passingTouchdowns: 2 })] },
          { gameId: "g_cache_live", week: 1, status: "in_progress", homeNflTeam: "SF", awayNflTeam: "LAR", lines: [] },
        ],
      },
    };
    const scoreCache = createScoreCache({ redis });
    const worker = createIngestionWorker({ db, provider: fakeStatsProvider(script), redis, publish: publishRecorder().fn, clock, budget, scoreCache });

    await worker.tick();

    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(week).toMatchObject({ status: "in_progress", version: 1 });
    await expect(scoreCache.read("lg_cache", 1, week!.version)).resolves.toEqual([{ teamId: "cache1", points: 18 }]);
    // Version is the freshness signal: a read at any other version is a miss, not a wrong number.
    await expect(scoreCache.read("lg_cache", 1, week!.version + 1)).resolves.toBeNull();
  });

  it("the cross-league home shows the worker's live score for a week Postgres has no score for yet", async () => {
    // The read half of the cache had no producer at all: `crossLeagueHome`'s MGET always missed,
    // so on a live Sunday every league's card fell through to `matchups.home_score`, which is null
    // until the week settles — a dash where the score should be.
    await seedPlayers(["p1"]);
    await seedLeagueShell("lg_home_live", [{ teamId: "hl1", userId: "uhl1" }, { teamId: "hl2", userId: "uhl2" }], "complete", 2);
    await addRoster("hl1", "p1");
    const script: FakeStatsProviderScript = {
      games: {
        1: [
          { gameId: "g_home_final", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 250, passingTouchdowns: 2 })] },
          { gameId: "g_home_live", week: 1, status: "in_progress", homeNflTeam: "SF", awayNflTeam: "LAR", lines: [] },
        ],
      },
    };
    const scoreCache = createScoreCache({ redis });
    const worker = createIngestionWorker({ db, provider: fakeStatsProvider(script), redis, publish: publishRecorder().fn, clock, budget, scoreCache });

    await worker.tick();

    const [stored] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_home_live"), eq(matchups.weekNumber, 1)));
    expect(stored!.homeScore).toBeNull(); // the week is still in progress: Postgres has nothing to show

    const home = await crossLeagueHome(db, "uhl1", { scoreCache });
    const card = home.leagues.find((league) => league.id === "lg_home_live");
    expect(card!.weekStatus).toBe("in_progress");
    const live = card!.matchup!.homeTeamId === "hl1" ? card!.matchup!.homeScore : card!.matchup!.awayScore;
    expect(live).toBe(18);
  });

  it("a correction inside the window lands, and re-settles the week's matchup", async () => {
    // NFL scoring revisions run into the following week, and final-only stores whatever the box
    // score said the first moment the game reported final — by construction the least settled
    // version of it. Without the sweep no revision could EVER land: a final week left the
    // examination window for good, and there is no operator path back.
    await seedPlayers(["p1", "p2"]);
    await seedLeagueShell("lg_correct", [{ teamId: "cor1", userId: "ucor1" }, { teamId: "cor2", userId: "ucor2" }], "complete", 2);
    await addRoster("cor1", "p1");
    await addRoster("cor2", "p2");
    let ts = "2026-09-14T20:00:00.000Z";
    const movingClock = { now: () => ts };
    const script: FakeStatsProviderScript = {
      games: {
        1: [{
          gameId: "g_correct", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
          lines: [statLine("p1", 1, { passingYards: 200 }), statLine("p2", 1, { passingYards: 100 })],
        }],
      },
    };
    const provider = fakeStatsProvider(script);
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: movingClock, budget });

    await worker.tick();
    const [settled] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_correct"), eq(matchups.weekNumber, 1)));
    const scoreOf = (row: typeof settled) => (row!.homeTeamId === "cor1" ? row!.homeScore : row!.awayScore);
    expect(scoreOf(settled)).toBe(8); // 200 * 0.04

    // The official revision: 200 passing yards were really 325.
    script.games[1] = [{
      gameId: "g_correct", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
      lines: [statLine("p1", 1, { passingYards: 325 }), statLine("p2", 1, { passingYards: 100 })],
    }];
    ts = "2026-09-15T20:00:00.000Z"; // the next calendar day, still inside the correction window
    await worker.tick();

    const [corrected] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_correct"), eq(matchups.weekNumber, 1)));
    expect(scoreOf(corrected)).toBe(13); // 325 * 0.04
    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    // Still final — the sweep never regresses a settled week — and the version moved, so every
    // cached score and every open matchup page hears about it.
    expect(week).toMatchObject({ status: "final" });
    expect(week!.version).toBe(2);
  });

  it("a revision after the correction window closes is never fetched", async () => {
    await seedPlayers(["p1"]);
    let ts = "2026-09-14T20:00:00.000Z";
    const movingClock = { now: () => ts };
    const script: FakeStatsProviderScript = {
      games: {
        1: [{ gameId: "g_late", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 200 })] }],
      },
    };
    const provider = fakeStatsProvider(script);
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: movingClock, budget });

    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);

    // A day inside the window, with nothing to find: the sweep writes NOTHING, so it cannot push
    // the deadline out by re-stamping stat_weeks.updated_at on every pass.
    ts = "2026-09-15T20:00:00.000Z";
    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(2);

    script.games[1] = [{ gameId: "g_late", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 400 })] }];
    ts = "2026-09-19T20:00:00.000Z"; // five days after settlement, past correctionWindowDays
    await worker.tick();

    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(2);
    const [line] = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 1));
    expect(line!.passingYards).toBe(200);
  });

  it("sweeps a settled week at most once per calendar day", async () => {
    await seedPlayers(["p1"]);
    let ts = "2026-09-14T20:00:00.000Z";
    const movingClock = { now: () => ts };
    const provider = fakeStatsProvider({
      games: {
        1: [{ gameId: "g_daily", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 200 })] }],
      },
    });
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: movingClock, budget });

    await worker.tick(); // settles the week, and counts as that day's read
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);

    ts = "2026-09-14T23:30:00.000Z"; // later the same day
    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);

    ts = "2026-09-15T00:30:00.000Z"; // a new calendar day: exactly one sweep
    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(2);

    ts = "2026-09-15T12:00:00.000Z";
    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(2);
  });

  it("settles a week for a league that finished its draft after that week was already final", async () => {
    // The undrafted-league guard is right — a league with no rosters would score a season of
    // phantom zeroes — but nothing used to bring that league back once its draft completed, so a
    // league that drafted on a Sunday afternoon silently forfeited that week from its record.
    await seedPlayers(["p1", "p2"]);
    await seedLeagueShell("lg_late_draft", [{ teamId: "ld1", userId: "uld1" }, { teamId: "ld2", userId: "uld2" }], "scheduled", 2);
    const provider = fakeStatsProvider({
      games: {
        1: [{
          gameId: "g_late_draft", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
          lines: [statLine("p1", 1, { passingYards: 300 }), statLine("p2", 1, { passingYards: 100 })],
        }],
      },
    });
    const { fn: publish, calls } = publishRecorder();
    const worker = createIngestionWorker({ db, provider, redis, publish, clock, budget });

    await worker.tick();
    const [beforeDraft] = await db.select().from(matchups).where(eq(matchups.leagueId, "lg_late_draft"));
    expect(beforeDraft!.homeScore).toBeNull();

    // A tick while the league is STILL undrafted finds the unsettled week, is refused by
    // finalizeWeek's own guard, and says nothing about it: a league that has not started its
    // season is not an incident to report every thirty minutes.
    const stillUndrafted = await worker.tick();
    expect(stillUndrafted.some((outcome) => outcome.leagueId === "lg_late_draft")).toBe(false);

    // The draft completes: rosters exist now.
    await addRoster("ld1", "p1");
    await addRoster("ld2", "p2");
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, "lg_late_draft"));

    const outcomes = await worker.tick();

    const [afterDraft] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_late_draft"), eq(matchups.weekNumber, 1)));
    expect(afterDraft!.homeScore).not.toBeNull();
    expect(afterDraft!.awayScore).not.toBeNull();
    expect(outcomes.some((outcome) => outcome.leagueId === "lg_late_draft" && outcome.applied)).toBe(true);
    expect(calls.some((call) => call.leagueId === "lg_late_draft")).toBe(true);
  });

  it("a wedged week does not freeze the season: the window widens and the next week still ingests", async () => {
    // A postponed game whose upstream status never flips, or a box score that permanently 404s,
    // pins the examination window on one week forever. Widen, never skip: the stuck week is still
    // examined every tick (its games may yet be played) while the season moves on around it.
    await seedPlayers(["p1"]);
    const script: FakeStatsProviderScript = {
      games: {
        1: [{ gameId: "g_wedged", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }],
      },
    };
    const provider = fakeStatsProvider(script);
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const onOutcome = vi.fn();
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, wedgedWeekTicks: 1, onOutcome });

    await worker.tick(); // week 1 gets its row; week 2 has no games yet
    await worker.tick(); // steady state: only week 1 is worth a schedule call
    expect(await db.select().from(statWeeks).where(eq(statWeeks.week, 2))).toHaveLength(0);
    const listedWeekTwo = listGamesSpy.mock.calls.filter(([week]) => week === 2).length;

    // Week 2's games appear while week 1 is still stuck.
    script.games[2] = [{
      gameId: "g_after_wedge", week: 2, status: "final", homeNflTeam: "SF", awayNflTeam: "LAR",
      lines: [statLine("p1", 2, { passingYards: 150 })],
    }];
    await worker.tick(); // wedgedWeekTicks passed: the window widens

    expect(listGamesSpy.mock.calls.filter(([week]) => week === 2).length).toBeGreaterThan(listedWeekTwo);
    const [weekTwo] = await db.select().from(statWeeks).where(eq(statWeeks.week, 2));
    expect(weekTwo).toMatchObject({ status: "final" });
    const [weekOne] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(weekOne).toMatchObject({ status: "in_progress" }); // still examined, still not settled
    expect(onOutcome.mock.calls.some(([outcome]) => /has not finished after/.test(String(outcome.reason)))).toBe(true);
  });

  it("a duplicated playerId in one tick's box scores persists cleanly, last line winning", async () => {
    // A player in two of a week's box scores (or an adapter emitting a team defense twice) used to
    // fail the whole transaction with Postgres 21000 — every tick, until upstream cleared it.
    await seedPlayers(["p1"]);
    const provider = fakeStatsProvider({
      games: {
        1: [
          { gameId: "g_dup_a", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 100 })] },
          { gameId: "g_dup_b", week: 1, status: "final", homeNflTeam: "SF", awayNflTeam: "LAR", lines: [statLine("p1", 1, { passingYards: 275 })] },
        ],
      },
    });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });

    const outcomes = await worker.tick();

    expect(outcomes.some((outcome) => outcome.week === 1 && outcome.applied)).toBe(true);
    const lines = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 1));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.passingYards).toBe(275);
  });

  it("clamps its week pointer to the real mock provider's own season, not a pipeline constant", async () => {
    // The shipping default provider's dataset is 17 weeks. A pipeline constant of 18 left the
    // pointer asking for a week the provider can never answer: `tickWeek` returns before writing a
    // row, so the pointer never advances, nothing is ever logged, and every tick pays for the same
    // empty listing forever. Driven by the REAL provider from a reachable state — every week of
    // its own season settled — rather than by a manufactured 18-row table.
    const provider = createMockStatsProvider();
    expect(provider.lastWeekOfSeason).toBe(17);
    await db.insert(statWeeks).values(
      Array.from({ length: provider.lastWeekOfSeason }, (_, i) => ({
        week: i + 1,
        status: "final" as const,
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      })),
    );
    const listGamesSpy = vi.spyOn(provider, "listGames");
    const onOutcome = vi.fn();
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, onOutcome });

    const outcomes = await worker.tick();

    expect(listGamesSpy).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ week: 0, applied: false, reason: "Nothing to examine — every week through the season's end is already final." }]);
    // A settled season is loud, not silent: the one thing worse than a stalled pointer is a
    // stalled pointer nobody can see.
    expect(onOutcome).toHaveBeenCalledTimes(1);
  });

  it("isolates a late settlement that fails, and keeps the rest of the tick", async () => {
    // Same per-league isolation the transition path has: one league's settlement blowing up must
    // not stop the tick, and it must be visible rather than swallowed.
    await seedPlayers(["p1", "p2"]);
    await seedLeagueShell("lg_late_fail", [{ teamId: "lf1", userId: "ulf1" }, { teamId: "lf2", userId: "ulf2" }], "scheduled", 2);
    const provider = fakeStatsProvider({
      games: {
        1: [{
          gameId: "g_late_fail", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
          lines: [statLine("p1", 1, { passingYards: 300 }), statLine("p2", 1, { passingYards: 100 })],
        }],
      },
    });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget });
    await worker.tick();

    await addRoster("lf1", "p1");
    await addRoster("lf2", "p2");
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, "lg_late_fail"));
    throwFinalizeForLeague = "lg_late_fail";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const outcomes = await worker.tick();
      expect(outcomes).toContainEqual({
        week: 1,
        leagueId: "lg_late_fail",
        applied: false,
        reason: "Couldn't settle this league's already-finished week.",
      });
      const [row] = await db.select().from(matchups).where(eq(matchups.leagueId, "lg_late_fail"));
      expect(row!.homeScore).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("skips the correction sweep rather than spending on it when Redis cannot say whether today's sweep already ran", async () => {
    // The sweep's marker is what makes it once-a-day. Without a readable marker the honest choice
    // is to skip: the conservative direction spends nothing, and a missed day's sweep is one more
    // day of a window that is three days wide.
    await seedPlayers(["p1"]);
    let ts = "2026-09-14T20:00:00.000Z";
    const movingClock = { now: () => ts };
    const provider = fakeStatsProvider({
      games: {
        1: [{ gameId: "g_sweep_blind", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 200 })] }],
      },
    });
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const sweepBlindRedis = new Proxy(redis, {
      get(target, prop, receiver: unknown) {
        if (prop === "exists") {
          return (...args: unknown[]) => {
            if (String(args[0]).startsWith("stats:correction:")) throw new Error("simulated redis outage on the sweep marker");
            return (Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const worker = createIngestionWorker({ db, provider, redis: sweepBlindRedis as Redis, publish: publishRecorder().fn, clock: movingClock, budget });

    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);

    ts = "2026-09-15T20:00:00.000Z"; // a sweep would be due, but its marker cannot be read
    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);
  });

  it("a lease it cannot release still expires on its own, and never fails the tick", async () => {
    await seedPlayers(["p1"]);
    const provider = fakeStatsProvider({
      games: {
        1: [{ gameId: "g_release_fail", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 40 })] }],
      },
    });
    const releaseBlindRedis = new Proxy(redis, {
      get(target, prop, receiver: unknown) {
        if (prop === "eval") {
          return (...args: unknown[]) => {
            if (args[2] === STATS_INGESTION_CONFIG.keys.tickLease) throw new Error("simulated redis outage on the release");
            return (Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const worker = createIngestionWorker({ db, provider, redis: releaseBlindRedis as Redis, publish: publishRecorder().fn, clock, budget });

    const outcomes = await worker.tick();

    expect(outcomes.some((outcome) => outcome.week === 1 && outcome.applied)).toBe(true);
    // The lease is still held — by this instance, harmlessly, until its own TTL runs out.
    expect(await redis.exists(STATS_INGESTION_CONFIG.keys.tickLease)).toBe(1);
    expect(await redis.pttl(STATS_INGESTION_CONFIG.keys.tickLease)).toBeGreaterThan(0);
  });

  it("warns about a wedged week ONCE per warn interval, however many passes it counts", async () => {
    // The count belongs in the message and never in the rate-limit key. Embedding it made every
    // tick mint a fresh key: `reportIfDue` found no prior entry, warned again, and inserted
    // another entry — a false "has not finished after N passes" line every thirty minutes for
    // days, plus an unbounded Map in a process designed to run for months.
    const provider = fakeStatsProvider({
      games: { 1: [{ gameId: "g_wedge_spam", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    });
    const onOutcome = vi.fn();
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, wedgedWeekTicks: 1, onOutcome });

    for (let i = 0; i < 6; i++) await worker.tick();

    const wedgeWarnings = onOutcome.mock.calls.filter(([outcome]) => /has not finished after/.test(String(outcome.reason)));
    expect(wedgeWarnings).toHaveLength(1);
    // The count is still there for whoever reads the log — it is just not what keys the limiter.
    expect(String(wedgeWarnings[0]![0].reason)).toMatch(/after \d+ ingestion passes/);
  });

  it("forgets a wedge once the week finally settles, and warns afresh if a later week wedges", async () => {
    // The counter has to reset, or a season that recovers from one stuck week carries the wedge
    // forever and keeps paying for a widened window.
    let ts = "2026-09-14T20:00:00.000Z";
    const movingClock = { now: () => ts };
    const script: FakeStatsProviderScript = {
      games: { 1: [{ gameId: "g_recover", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    };
    const provider = fakeStatsProvider(script);
    const onOutcome = vi.fn();
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: movingClock, budget, wedgedWeekTicks: 1, onOutcome });

    await worker.tick();
    await worker.tick();
    await worker.tick(); // wedged: one warning for week 1
    expect(onOutcome.mock.calls.filter(([o]) => /Week 1 has not finished/.test(String(o.reason)))).toHaveLength(1);

    // Week 1 settles. The window moves on and the counter starts over on the new week.
    script.games[1] = [{ gameId: "g_recover", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }];
    script.games[2] = [{ gameId: "g_recover_2", week: 2, status: "in_progress", homeNflTeam: "SF", awayNflTeam: "LAR", lines: [] }];
    ts = "2026-09-15T20:00:00.000Z";
    await worker.tick();
    const [weekOne] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(weekOne).toMatchObject({ status: "final" });

    // Two more ticks on week 2 and it trips its own threshold — proving the counter restarted
    // rather than carrying week 1's total forward, which would have warned immediately.
    await worker.tick();
    expect(onOutcome.mock.calls.filter(([o]) => /Week 2 has not finished/.test(String(o.reason)))).toHaveLength(0);
    await worker.tick();
    await worker.tick();
    expect(onOutcome.mock.calls.filter(([o]) => /Week 2 has not finished/.test(String(o.reason)))).toHaveLength(1);
  });

  it("a permanently wedged week does not cap the season at one more week: later weeks keep settling", async () => {
    // Widening to `[wedged, wedged + 1]` buys the season exactly one week and then stalls again at
    // `wedged + 1`. The window is the wedged week PLUS a full window opening at the first non-final
    // week after it, so the season walks on for as long as the wedge holds.
    await seedPlayers(["p1"]);
    const script: FakeStatsProviderScript = {
      games: {
        1: [{ gameId: "g_404", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }],
        2: [{ gameId: "g_w2", week: 2, status: "final", homeNflTeam: "SF", awayNflTeam: "LAR", lines: [statLine("p1", 2, { passingYards: 100 })] }],
        3: [{ gameId: "g_w3", week: 3, status: "final", homeNflTeam: "GB", awayNflTeam: "CHI", lines: [statLine("p1", 3, { passingYards: 110 })] }],
        4: [{ gameId: "g_w4", week: 4, status: "final", homeNflTeam: "NE", awayNflTeam: "NYJ", lines: [statLine("p1", 4, { passingYards: 120 })] }],
      },
    };
    const provider = fakeStatsProvider(script);
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, wedgedWeekTicks: 1 });

    // Tick 1 opens on a fresh table (weeks 1 and 2), tick 2 narrows to the stuck week, and from
    // tick 3 the wedge holds and the window carries the rest of the season with it.
    for (let i = 0; i < 4; i++) await worker.tick();

    const settled = await db.select().from(statWeeks).orderBy(asc(statWeeks.week));
    expect(settled.find((row) => row.week === 1)).toMatchObject({ status: "in_progress" });
    for (const week of [2, 3, 4]) {
      expect(settled.find((row) => row.week === week)).toMatchObject({ status: "final" });
    }
  });

  it("a correction sweep starved of game budget does not claim the day, and the next tick retries it", async () => {
    // `correctionWindowDays` gives a settled week three chances. A busy live week spending
    // `maxGamesPerTick` would otherwise let a sweep that examined nothing mark the day done and
    // burn a third of the correction coverage without reading a single box score.
    await seedPlayers(["p1", "p2"]);
    let ts = "2026-09-14T20:00:00.000Z";
    const movingClock = { now: () => ts };
    const settledGames: ScriptedGame[] = Array.from({ length: 4 }, (_, i) => ({
      gameId: `g_sweep_${i}`, week: 1, status: "final" as const, homeNflTeam: `H${i}`, awayNflTeam: `A${i}`,
      lines: [statLine(`p${(i % 2) + 1}`, 1, { passingYards: 100 + i })],
    }));
    const script: FakeStatsProviderScript = { games: { 1: settledGames } };
    const provider = fakeStatsProvider(script);
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: movingClock, budget });

    await worker.tick(); // week 1 settles; today counts as read
    const [afterSettle] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(afterSettle).toMatchObject({ status: "final" });

    // The next day, week 2 goes live with a full slate that eats the whole per-tick game budget,
    // so the sweep of week 1 gets nothing.
    ts = "2026-09-15T20:00:00.000Z";
    // One more game than the tick can fetch, and one of them still playing — so week 2 takes the
    // entire game budget and does NOT settle, which keeps week 1 the most recent settled week.
    script.games[2] = [
      ...Array.from({ length: STATS_INGESTION_CONFIG.maxGamesPerTick }, (_, i) => ({
        gameId: `g_live_${i}`, week: 2, status: "final" as const, homeNflTeam: `L${i}`, awayNflTeam: `V${i}`, lines: [],
      })),
      { gameId: "g_live_open", week: 2, status: "in_progress" as const, homeNflTeam: "OPN", awayNflTeam: "END", lines: [] },
    ];
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    await worker.tick();

    // Nothing from week 1 was re-read, and the day is NOT claimed.
    expect(getGameStatLinesSpy.mock.calls.every(([game]) => game.week === 2)).toBe(true);
    expect(await redis.exists(STATS_INGESTION_CONFIG.keys.correctionSweep(1, "2026-09-15"))).toBe(0);

    // Same calendar day, and now the live week is fully ingested: the sweep gets its turn.
    await worker.tick();
    expect(getGameStatLinesSpy.mock.calls.some(([game]) => game.week === 1)).toBe(true);
    expect(await redis.exists(STATS_INGESTION_CONFIG.keys.correctionSweep(1, "2026-09-15"))).toBe(1);
  });

  it("sweeps only what it can finish: a partial re-read leaves the day unclaimed", async () => {
    // The other starvation shape: the sweep gets SOME budget but not enough for the whole week.
    // It reads what it can — a correction in one of those games would still land — but it must not
    // claim the day, because the games it did not reach are the ones that might have moved.
    await seedPlayers(["p1", "p2", "p3"]);
    let ts = "2026-09-14T20:00:00.000Z";
    const movingClock = { now: () => ts };
    const script: FakeStatsProviderScript = {
      games: {
        1: Array.from({ length: 3 }, (_, i) => ({
          gameId: `g_partial_${i}`, week: 1, status: "final" as const, homeNflTeam: `H${i}`, awayNflTeam: `A${i}`,
          lines: [statLine(`p${i + 1}`, 1, { passingYards: 100 + i })],
        })),
      },
    };
    const provider = fakeStatsProvider(script);
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: movingClock, budget });

    await worker.tick(); // week 1 settles

    // A live week that leaves exactly one slot of the tick's game budget for the sweep.
    ts = "2026-09-15T20:00:00.000Z";
    script.games[2] = [
      ...Array.from({ length: STATS_INGESTION_CONFIG.maxGamesPerTick - 1 }, (_, i) => ({
        gameId: `g_partial_live_${i}`, week: 2, status: "final" as const, homeNflTeam: `L${i}`, awayNflTeam: `V${i}`, lines: [],
      })),
      { gameId: "g_partial_open", week: 2, status: "in_progress" as const, homeNflTeam: "OPN", awayNflTeam: "END", lines: [] },
    ];
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    await worker.tick();

    // It re-read part of week 1 — and found nothing changed, so it wrote nothing — but the day is
    // still open, because two of week 1's three games were never looked at.
    const weekOneReads = getGameStatLinesSpy.mock.calls.filter(([game]) => game.week === 1);
    expect(weekOneReads.length).toBeGreaterThan(0);
    expect(weekOneReads.length).toBeLessThan(script.games[1]!.length);
    expect(await redis.exists(STATS_INGESTION_CONFIG.keys.correctionSweep(1, "2026-09-15"))).toBe(0);
  });

  it("sweeps a settled season with no live week left to examine", async () => {
    // Every week through the provider's last is final, so there is no forward window at all — but a
    // week that settled yesterday is still inside its correction window, and the season being over
    // is not a reason to stop listening for a revision to its last week.
    await seedPlayers(["p1"]);
    let ts = "2026-09-14T20:00:00.000Z";
    const movingClock = { now: () => ts };
    const script: FakeStatsProviderScript = {
      lastWeekOfSeason: 1,
      games: {
        1: [{ gameId: "g_last", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 200 })] }],
      },
    };
    const provider = fakeStatsProvider(script);
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: movingClock, budget });

    await worker.tick();
    script.games[1] = [{ gameId: "g_last", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 275 })] }];

    ts = "2026-09-15T20:00:00.000Z";
    const outcomes = await worker.tick();

    expect(outcomes.some((outcome) => outcome.week === 1 && outcome.applied)).toBe(true);
    const [line] = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 1));
    expect(line!.passingYards).toBe(275);
  });

  it("reports a sweep the ledger will not pay for, distinctly from a denied live week", async () => {
    await seedPlayers(["p1"]);
    let ts = "2026-09-14T20:00:00.000Z";
    const movingClock = { now: () => ts };
    const provider = fakeStatsProvider({
      lastWeekOfSeason: 1,
      games: {
        1: [{ gameId: "g_sweep_denied", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [statLine("p1", 1, { passingYards: 200 })] }],
      },
    });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: movingClock, budget });
    await worker.tick();

    // The sweep's schedule call is reserved on its own, so it can be denied on its own.
    ts = "2026-09-15T20:00:00.000Z";
    const brokeBudget: RequestBudget = {
      reserve: async () => ({ granted: false, denial: "budget-exhausted" }),
      reserveBackfill: async () => ({ granted: false, denial: "budget-exhausted" }),
      remaining: async () => 0,
    };
    const onOutcome = vi.fn();
    const brokeWorker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock: movingClock, budget: brokeBudget, onOutcome });
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");

    await brokeWorker.tick();

    expect(getGameStatLinesSpy).not.toHaveBeenCalled();
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ week: 1, reason: expect.stringMatching(/budget is spent/) }));
    expect(await redis.exists(STATS_INGESTION_CONFIG.keys.correctionSweep(1, "2026-09-15"))).toBe(0);
  });

  /**
   * Task 4's watch-item: the auto-set trigger, driven off the worker's own transition rather than
   * exercised through `autoSetLineupsForWeek`'s own suite (`@/league-service/auto-lineup.test.ts`)
   * — this file's job is proving WHEN it fires, not what it does once it does.
   */
  describe("the auto-set lineup trigger", () => {
    function recordingAutoSet() {
      const calls: { readonly weekNumber: number; readonly occurredAt: string }[] = [];
      const fn: typeof import("@/league-service/auto-lineup").autoSetLineupsForWeek = async (_db, input) => {
        calls.push({ weekNumber: input.weekNumber, occurredAt: input.occurredAt });
        return { week: input.weekNumber, teamsSet: 0, leaguesFailed: [] };
      };
      return { fn, calls };
    }

    it("fires on EVERY tick the week is locked, not only the tick that locked it — the level-derived trigger", async () => {
      // Final review F2: the old edge condition (`priorStatus === "scheduled" && status !==
      // "scheduled"`) fired exactly once and could never refire, so a league whose own transaction
      // rolled back never got a second attempt. The re-fire is what makes the auto-set
      // self-healing; `autoSetLineupsForWeek`'s own candidate query is what makes the re-fire free
      // once every league is done.
      const script: FakeStatsProviderScript = {
        games: { 1: [{ gameId: "g_trigger", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
      };
      const provider = fakeStatsProvider(script);
      const { fn: autoSet, calls } = recordingAutoSet();
      const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, autoSet });

      await worker.tick(); // week 1 flips scheduled -> in_progress
      await worker.tick(); // and stays there

      expect(calls).toEqual([
        { weekNumber: 1, occurredAt: now },
        { weekNumber: 1, occurredAt: now },
      ]);
    });

    it("reports the leagues whose own transaction rolled back, through the same operator surface every other tick failure uses", async () => {
      // The second half of F2: `leaguesFailed` does not throw, so a caller that ignores the return
      // value drops it silently — which is exactly what the sole production call site did.
      const script: FakeStatsProviderScript = {
        games: { 1: [{ gameId: "g_rollback", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
      };
      const provider = fakeStatsProvider(script);
      const autoSet: typeof import("@/league-service/auto-lineup").autoSetLineupsForWeek = async (_db, input) => ({
        week: input.weekNumber,
        teamsSet: 0,
        leaguesFailed: [{ leagueId: "lg_rolled_back", reason: "deadlock detected" }],
      });
      const onOutcome = vi.fn();
      const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
      const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, autoSet, onOutcome });

      const outcomes = await worker.tick();

      // The week's own outcome is untouched — a rolled-back league is not a failed tick.
      expect(outcomes.some((outcome) => outcome.week === 1 && outcome.applied === true)).toBe(true);
      expect(onOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ week: 1, applied: false, reason: expect.stringContaining("1 league(s)") }),
      );
      expect(spyError).toHaveBeenCalledWith("[stats-pipeline] auto-set lineup rolled back for week", 1, [
        { leagueId: "lg_rolled_back", reason: "deadlock detected" },
      ]);
      spyError.mockRestore();
    });

    it("never fires while a week's games stay scheduled — there is no transition to observe", async () => {
      const script: FakeStatsProviderScript = {
        games: { 1: [{ gameId: "g_still_scheduled", week: 1, status: "scheduled", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
      };
      const provider = fakeStatsProvider(script);
      const { fn: autoSet, calls } = recordingAutoSet();
      const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, autoSet });

      await worker.tick();
      await worker.tick();

      expect(calls).toEqual([]);
    });

    it("never fails the tick when the auto-set trigger itself throws, and reports it rather than losing the week's own outcome", async () => {
      const script: FakeStatsProviderScript = {
        games: { 1: [{ gameId: "g_autoset_throws", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
      };
      const provider = fakeStatsProvider(script);
      const autoSet = vi.fn(async () => {
        throw new Error("simulated auto-set failure");
      });
      const onOutcome = vi.fn();
      const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, autoSet, onOutcome });

      const outcomes = await worker.tick();

      expect(autoSet).toHaveBeenCalledTimes(1);
      // The week's OWN outcome still reports applied — a broken auto-set must never fail the tick
      // that just settled real scores.
      expect(outcomes.some((outcome) => outcome.week === 1 && outcome.applied === true)).toBe(true);
      const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
      expect(week).toMatchObject({ status: "in_progress" });
      expect(onOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ week: 1, applied: false, reason: expect.stringContaining("auto-set") }),
      );
    });
  });
});

describe("examinationWindow", () => {
  const settled = (week: number) => ({ week, status: "final" as const });
  const live = (week: number) => ({ week, status: "in_progress" as const });
  const options = { lastWeek: 18, maxWeeks: 2, widen: false };

  it("examines one week in steady state, and two when it resumes at a week with no row", () => {
    expect(examinationWindow([settled(1), live(2)], options).weeks).toEqual([2]);
    expect(examinationWindow([settled(1), settled(2)], options).weeks).toEqual([3, 4]);
    expect(examinationWindow([], options).weeks).toEqual([1, 2]);
  });

  it("carries the rest of the season alongside a wedged week, resuming after it", () => {
    const widen = { ...options, widen: true };
    // Everything after the wedge has settled: resume past the newest row.
    expect(examinationWindow([live(3), settled(4)], widen).weeks).toEqual([3, 5, 6]);
    // A later week is still open: resume THERE, not past the end — otherwise the wedge would
    // carry the window past a week that has not finished and abandon it.
    expect(examinationWindow([live(3), settled(4), live(5), settled(6)], widen).weeks).toEqual([3, 5, 6]);
    expect(examinationWindow([live(3), live(4)], widen).weeks).toEqual([3, 4, 5]);
  });

  it("never asks for a week past the provider's own season, wedged or not", () => {
    expect(examinationWindow([settled(17)], { lastWeek: 17, maxWeeks: 2, widen: false }).weeks).toEqual([]);
    expect(examinationWindow([live(17)], { lastWeek: 17, maxWeeks: 2, widen: true }).weeks).toEqual([17]);
  });
});

/**
 * Task 4b. The capture pass is the projection engine's, but it runs on THIS worker's tick, so the
 * properties that make that safe — it runs even when the scoring half has nothing to do, one
 * feed's failure never breaks the tick — belong to the worker and are asserted here.
 */
describe("the ephemeral-feed capture rides on the tick", () => {
  const noFeeds = { feeds: [] as const };

  it("runs the capture on every tick", async () => {
    const capture = vi.fn(async () => noFeeds);
    const provider = fakeStatsProvider({ games: {} });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, capture });

    await worker.tick();

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("still runs it on a tick the scoring half gives up on — the preseason is when it matters most", async () => {
    // Every week final: `runScoringTick` returns early with "nothing to examine". The capture must
    // not be behind that return, because ADP drift and injuries are exactly what a dead scoring
    // week still needs recording.
    await db.insert(statWeeks).values(
      Array.from({ length: 18 }, (_, index) => ({ week: index + 1, status: "final" as const })),
    );
    const capture = vi.fn(async () => noFeeds);
    const provider = fakeStatsProvider({ games: {} });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, capture });

    const outcomes = await worker.tick();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(outcomes.some((outcome) => outcome.reason?.includes("Nothing to examine"))).toBe(true);
  });

  it("reports a failed feed and carries on ingesting", async () => {
    const capture = vi.fn(async () => ({
      feeds: [
        { source: "tank01_depth_charts", status: "failed" as const, requests: 1, reason: "HTTP 404" },
        { source: "tank01_news", status: "captured" as const, requests: 1 },
      ],
    }));
    const provider = fakeStatsProvider({ games: {} });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, capture });

    const outcomes = await worker.tick();

    expect(outcomes.some((outcome) => outcome.reason?.includes("tank01_depth_charts") === true)).toBe(true);
    expect(outcomes.some((outcome) => outcome.reason?.includes("tank01_news") === true)).toBe(false);
  });

  it("a capture that throws never takes the ingestion tick down with it", async () => {
    const capture = vi.fn(async () => {
      throw new Error("redis is gone");
    });
    const provider = fakeStatsProvider({ games: {} });
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, capture });

    await expect(worker.tick()).resolves.toBeDefined();
  });
});
