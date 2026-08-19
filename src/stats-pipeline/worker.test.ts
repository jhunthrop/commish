import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import Redis from "ioredis";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, matchups, playerStatLines, players, rosterSlots, statWeeks, teams, users } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import { writeSchedule } from "@/league-service/schedule";
import type { PublishFn } from "@/lib/realtime/publish";
import { createRequestBudget, type RequestBudget } from "./budget";
import type { ScoreUpdatePayload } from "./contract";
import { fakeStatsProvider, type FakeStatsProviderScript } from "./test-support";
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

  it("live mode fetches every non-final game every tick, the same script producing three fetches", async () => {
    await seedPlayers(["p1"]);
    const script: FakeStatsProviderScript = {
      games: { 1: [{ gameId: "g_live", week: 1, status: "in_progress", homeNflTeam: "KC", awayNflTeam: "DEN", lines: [] }] },
    };
    const provider = fakeStatsProvider(script);
    const getGameStatLinesSpy = vi.spyOn(provider, "getGameStatLines");
    const worker = createIngestionWorker({ db, provider, redis, publish: publishRecorder().fn, clock, budget, mode: "live" });

    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(1);

    script.games[1] = [{
      gameId: "g_live", week: 1, status: "final", homeNflTeam: "KC", awayNflTeam: "DEN",
      lines: [statLine("p1", 1, { passingYards: 200, passingTouchdowns: 2 })],
    }];
    await worker.tick();
    expect(getGameStatLinesSpy).toHaveBeenCalledTimes(2);

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
});
