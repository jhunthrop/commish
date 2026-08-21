import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, drafts, leagues, matchups, memberNotices, players, playerStatLines, rosterSlots, statWeeks, teams, users } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import { writeSchedule } from "@/league-service/schedule";
import { copyViolations } from "@/integrity/copy-rules";
import type { RequestBudget } from "./budget";
import { correctSettledWeek, correctionOutcome, matchupResultFor } from "./correction";
import { finalizeWeek } from "./finalize";
import { fakeStatsProvider } from "./test-support";

/**
 * `correctSettledWeek`'s `provider`/`budget` default to `getStatsProvider()`/`getIngestionBudget()`
 * (`./index`) — the SAME process-wide singletons the worker uses. Mocked here, rather than left to
 * resolve for real, because the real ones reach Redis (`getSharedRedis()`), which throws outright
 * when `REDIS_URL` is unset — exactly the case under plain `vitest run`, which never loads
 * `.env.local`. `vi.hoisted` is what lets the factory below reference these without a temporal-dead-
 * zone error; every other test in this file passes its own `provider`/`budget` explicitly and so
 * never reaches this mock at all.
 */
const { defaultMockProvider, defaultMockBudget } = vi.hoisted(() => ({
  defaultMockProvider: {
    requestCost: "free" as const,
    lastWeekOfSeason: 18,
    listPlayers: async () => [],
    listGames: async () => [],
    getGameStatLines: async () => [],
    getWeeklyStatLines: async () => [],
  },
  defaultMockBudget: {
    reserve: async () => ({ granted: true as const }),
    reserveBackfill: async () => ({ granted: true as const }),
    remaining: async () => 1000,
  },
}));
vi.mock("./index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./index")>();
  return { ...actual, getStatsProvider: () => defaultMockProvider, getIngestionBudget: () => defaultMockBudget };
});

const db = createTestDb();
const NOW = "2026-09-14T20:00:00.000Z";
const WEEK = 3;

const SLOTS = [{ slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] }];

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/** Mirrors `worker.test.ts`'s own fixture builders exactly — a full `StatLine` for a provider
 *  script, zero-filled except for what a case actually cares about. */
function statLine(playerId: string, week: number, over: Partial<StatLine> = {}): StatLine {
  return {
    playerId, week, passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0,
    rushingTouchdowns: 0, receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
    fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
    ...over,
  };
}

/** A league shell: users, the league row, its teams, its draft and (for 2+ teams) a schedule —
 *  the same low-level seed `worker.test.ts` uses for exactly this kind of scenario, rather than
 *  going through `createLeague`, which this suite has no need of. */
async function seedLeagueShell(
  leagueId: string,
  teamSpecs: readonly { readonly teamId: string; readonly userId: string }[],
  draftStatus: "scheduled" | "complete",
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
    await db.transaction((tx) => writeSchedule(tx, { leagueId, teamIds: teamSpecs.map((t) => t.teamId), weeks: WEEK }));
  }
}

async function addRoster(teamId: string, playerId: string): Promise<void> {
  await db.insert(rosterSlots).values({ teamId, slot: "QB", slotIndex: 0, playerId });
}

async function markWeekSettled(week: number, updatedAt: string, gamesTotal = 1, gamesFinal = 1): Promise<void> {
  await db.insert(statWeeks).values({ week, status: "final", version: 1, gamesTotal, gamesFinal, updatedAt: new Date(updatedAt) });
}

async function settledWeeksThrough(throughWeek: number, options: { readonly updatedDaysAgo: number }): Promise<void> {
  const updatedAt = new Date(Date.parse(NOW) - options.updatedDaysAgo * 24 * 60 * 60 * 1000);
  await db.insert(statWeeks).values(
    Array.from({ length: throughWeek }, (_, index) => ({
      week: index + 1, status: "final" as const, version: 1, gamesTotal: 1, gamesFinal: 1, updatedAt,
    })),
  );
}

async function auditEventsOn(leagueId: string): Promise<readonly unknown[]> {
  return db.select().from(auditEvents).where(and(eq(auditEvents.chainScope, leagueId), eq(auditEvents.eventType, "system_action")));
}

async function noticesFor(userId: string): Promise<readonly (typeof memberNotices.$inferSelect)[]> {
  return db.select().from(memberNotices).where(and(eq(memberNotices.userId, userId), eq(memberNotices.noticeType, "stat_week_corrected")));
}

/** Grants every reservation without touching Redis at all. */
const grantedBudget: RequestBudget = {
  reserve: async () => ({ granted: true }),
  reserveBackfill: async () => ({ granted: true }),
  remaining: async () => 1000,
};

/** Fails closed on the very first reservation — the schedule call. */
const ledgerUnavailableBudget: RequestBudget = {
  reserve: async () => ({ granted: false, denial: "ledger-unavailable" }),
  reserveBackfill: async () => ({ granted: false, denial: "ledger-unavailable" }),
  remaining: async () => 0,
};

/** Grants the schedule reservation (the first `reserve` call) and denies the box-score
 *  reservation (the second) — the OTHER half of the two-phase reservation's fail-closed path. */
function budgetDenyingBoxScores(): RequestBudget {
  let calls = 0;
  return {
    reserve: async () => {
      calls += 1;
      return calls === 1 ? { granted: true } : { granted: false, denial: "budget-exhausted" };
    },
    reserveBackfill: async () => ({ granted: true }),
    remaining: async () => 0,
  };
}

const emptyProvider = fakeStatsProvider({ games: {} });

/** Two leagues, two teams each, one QB rostered per team, week `WEEK` already settled once —
 *  exactly the state the ingestion worker would have left it in, before any correction runs. */
async function seedTwoLeagueFixture(): Promise<void> {
  await db.insert(players).values([
    { id: "qb_a", name: "QB A", position: "QB", nflTeam: "KC" },
    { id: "qb_b", name: "QB B", position: "QB", nflTeam: "SF" },
    { id: "qb_c", name: "QB C", position: "QB", nflTeam: "DAL" },
    { id: "qb_d", name: "QB D", position: "QB", nflTeam: "NYJ" },
  ]);
  await seedLeagueShell("lg_a", [{ teamId: "team_a", userId: "u_manager" }, { teamId: "team_b", userId: "u_rival" }], "complete");
  await seedLeagueShell("lg_b", [{ teamId: "team_c", userId: "u_carol" }, { teamId: "team_d", userId: "u_dave" }], "complete");
  await addRoster("team_a", "qb_a");
  await addRoster("team_b", "qb_b");
  await addRoster("team_c", "qb_c");
  await addRoster("team_d", "qb_d");
  await db.insert(playerStatLines).values([
    { playerId: "qb_a", week: WEEK, passingYards: 300, passingTouchdowns: 3 },
    { playerId: "qb_b", week: WEEK, passingYards: 200, passingTouchdowns: 1 },
    { playerId: "qb_c", week: WEEK, passingYards: 250, passingTouchdowns: 2 },
    { playerId: "qb_d", week: WEEK, passingYards: 220, passingTouchdowns: 2 },
  ]);
  await finalizeWeek(db, "lg_a", WEEK);
  await finalizeWeek(db, "lg_b", WEEK);
  await markWeekSettled(WEEK, NOW);
}

/** The provider's revised numbers for `qb_a` only — every other rostered player's line is left
 *  untouched by the provider script, so `persistTick` never rewrites it. */
function correctionProvider(over: Partial<StatLine> = { passingYards: 350, passingTouchdowns: 4 }) {
  return fakeStatsProvider({
    games: { [WEEK]: [{ gameId: "g_correct", week: WEEK, status: "final", homeNflTeam: "KC", awayNflTeam: "SF", lines: [statLine("qb_a", WEEK, over)] }] },
  });
}

describe("correctSettledWeek", () => {
  it("defaults to the process-wide provider and budget when the caller supplies neither", async () => {
    await markWeekSettled(WEEK, NOW);
    // The mocked default provider answers no games at all for the week, so nothing changed —
    // this test's whole point is that the default wiring runs at all, not the settlement math.
    const result = await correctSettledWeek(db, { week: WEEK, by: "u_op" });
    expect(result).toMatchObject({ ok: true, changed: false, leaguesResettled: 0 });
  });

  it("refuses a week that has not settled, because that week is the worker's job", async () => {
    expect(await correctSettledWeek(db, { week: 5, by: "u_op", provider: emptyProvider, budget: grantedBudget })).toEqual({
      ok: false,
      reason: "Week 5 has not settled yet. The ingestion worker still owns it.",
    });
  });

  it("refuses a week that has a row but has not reached final, the same as no row at all", async () => {
    await db.insert(statWeeks).values({ week: 4, status: "in_progress", version: 1, gamesTotal: 2, gamesFinal: 1, updatedAt: new Date(NOW) });
    expect(await correctSettledWeek(db, { week: 4, by: "u_op", provider: emptyProvider, budget: grantedBudget })).toEqual({
      ok: false,
      reason: "Week 4 has not settled yet. The ingestion worker still owns it.",
    });
  });

  it("reaches back past the three-day sweep window and past the newest settled week", async () => {
    await settledWeeksThrough(9, { updatedDaysAgo: 40 });
    const result = await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: emptyProvider, budget: grantedBudget });
    expect(result.ok).toBe(true);
  });

  it("writes nothing at all when the provider's numbers have not moved", async () => {
    await seedTwoLeagueFixture();
    // The exact same line already stored for qb_a — every other field defaults to zero on both
    // sides, so persistTick's own conflict resolution sees no real change.
    const provider = correctionProvider({ passingYards: 300, passingTouchdowns: 3 });

    const result = await correctSettledWeek(db, { week: WEEK, by: "u_op", provider, budget: grantedBudget });
    expect(result).toMatchObject({ ok: true, changed: false, leaguesResettled: 0 });
    expect(await auditEventsOn("lg_a")).toHaveLength(0);
    expect(await auditEventsOn("lg_b")).toHaveLength(0);
  });

  it("fails closed when the request ledger is unreachable, and writes nothing", async () => {
    await markWeekSettled(WEEK, NOW);
    expect(await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: emptyProvider, budget: ledgerUnavailableBudget })).toEqual({
      ok: false,
      reason: "The request ledger is unreachable, so nothing has been read or written. Try again once Redis is back.",
    });
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(playerStatLines)).toHaveLength(0);
  });

  it("fails closed when the ledger denies the box-score reservation, the second phase, and writes nothing", async () => {
    await seedTwoLeagueFixture();
    const result = await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: budgetDenyingBoxScores() });
    expect(result).toEqual({ ok: false, reason: "This month's upstream request budget is spent, so nothing has been read or written." });
    // The initial settlement's own audit trail (there is none — finalizeWeek writes no audit
    // event) aside, the point is that nothing NEW landed: no player line changed.
    const [qbA] = await db.select().from(playerStatLines).where(eq(playerStatLines.playerId, "qb_a"));
    expect(qbA!.passingYards).toBe(300);
  });

  it("re-settles each affected league in its own transaction, because a transaction appends to one chain", async () => {
    await seedTwoLeagueFixture();
    await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: grantedBudget });
    expect(await auditEventsOn("lg_a")).toHaveLength(1);
    expect(await auditEventsOn("lg_b")).toHaveLength(1);
  });

  it("tells every manager whose points moved, and says whether the result moved with them", async () => {
    await seedTwoLeagueFixture();
    await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: grantedBudget });

    const notices = await noticesFor("u_manager");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.body).toContain("your matchup");
    expect(copyViolations(`${notices[0]!.title} ${notices[0]!.body}`)).toEqual([]);
  });

  it("tells nobody whose points did not move", async () => {
    await seedTwoLeagueFixture();
    await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: grantedBudget });

    // team_a's own opponent (team_b, u_rival) and both of lg_b's managers all field players the
    // provider script never mentions, so their stored scores never move.
    expect(await noticesFor("u_rival")).toHaveLength(0);
    expect(await noticesFor("u_carol")).toHaveLength(0);
    expect(await noticesFor("u_dave")).toHaveLength(0);
  });

  it("skips a league finalizeWeekInTx itself refuses, rather than failing every other league in the week", async () => {
    await db.insert(players).values([
      { id: "qb_a", name: "QB A", position: "QB", nflTeam: "KC" },
      { id: "qb_e", name: "QB E", position: "QB", nflTeam: "MIA" },
    ]);
    await seedLeagueShell("lg_a", [{ teamId: "team_a", userId: "u_manager" }, { teamId: "team_b", userId: "u_rival" }], "complete");
    // Matchups exist for this league (writeSchedule does not check draft status) but its draft
    // never finished — the exact shape worker.test.ts's own undrafted-league case uses.
    await seedLeagueShell("lg_undrafted", [{ teamId: "team_e", userId: "u_erin" }, { teamId: "team_f", userId: "u_frank" }], "scheduled");
    await addRoster("team_a", "qb_a");
    await db.insert(playerStatLines).values({ playerId: "qb_a", week: WEEK, passingYards: 300, passingTouchdowns: 3 });
    await finalizeWeek(db, "lg_a", WEEK);
    await markWeekSettled(WEEK, NOW);

    const result = await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: grantedBudget });
    expect(result).toMatchObject({ ok: true, changed: true, leaguesResettled: 1 });
    expect(await auditEventsOn("lg_a")).toHaveLength(1);
    expect(await auditEventsOn("lg_undrafted")).toHaveLength(0);
    const [undraftedRow] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_undrafted"), eq(matchups.weekNumber, WEEK)));
    expect(undraftedRow!.homeScore).toBeNull();
  });

  it("compares against nothing, and sends no notice, for a league whose week was never previously scored", async () => {
    await db.insert(players).values({ id: "qb_a", name: "QB A", position: "QB", nflTeam: "KC" });
    await seedLeagueShell("lg_a", [{ teamId: "team_a", userId: "u_manager" }, { teamId: "team_b", userId: "u_rival" }], "complete");
    await addRoster("team_a", "qb_a");
    await db.insert(playerStatLines).values({ playerId: "qb_a", week: WEEK, passingYards: 300, passingTouchdowns: 3 });
    // Deliberately no `finalizeWeek` call here — the matchup row's scores start out null, unlike
    // every other test's fixture.
    await markWeekSettled(WEEK, NOW);

    const result = await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: grantedBudget });
    expect(result).toMatchObject({ ok: true, changed: true, leaguesResettled: 1 });
    expect(await auditEventsOn("lg_a")).toHaveLength(1);
    expect(await noticesFor("u_manager")).toHaveLength(0);
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_a"), eq(matchups.weekNumber, WEEK)));
    expect(row!.homeScore).not.toBeNull();
  });
});

describe("matchupResultFor", () => {
  it("is a win when the team's own score is higher", () => {
    expect(matchupResultFor(100, 90)).toBe("win");
  });

  it("is a loss when the team's own score is lower", () => {
    expect(matchupResultFor(80, 90)).toBe("loss");
  });

  it("is a tie when the scores match exactly", () => {
    expect(matchupResultFor(90, 90)).toBe("tie");
  });
});

describe("correctionOutcome", () => {
  it("says the result stays the same when a win is still a win", () => {
    expect(correctionOutcome("win", "win")).toBe("your matchup result stays the same");
  });

  it("says the result stays the same when a loss is still a loss", () => {
    expect(correctionOutcome("loss", "loss")).toBe("your matchup result stays the same");
  });

  it("says it turns into a win when a loss (or a tie) becomes one", () => {
    expect(correctionOutcome("loss", "win")).toBe("that turns your matchup into a win");
    expect(correctionOutcome("tie", "win")).toBe("that turns your matchup into a win");
  });

  it("says it turns into a loss when a win (or a tie) becomes one", () => {
    expect(correctionOutcome("win", "loss")).toBe("that turns your matchup into a loss");
    expect(correctionOutcome("tie", "loss")).toBe("that turns your matchup into a loss");
  });

  it("falls back to 'stays the same' for the rare transition through a tie, rather than a fourth string", () => {
    // Only three clauses exist. A win downgraded to a tie has lost its win (read as the loss
    // clause's direction) and a loss upgraded to a tie has lost its loss (the win clause's
    // direction) would both be defensible; this function picks neither and states "stays the
    // same" instead, since it is the one clause that is never actively wrong.
    expect(correctionOutcome("win", "tie")).toBe("your matchup result stays the same");
    expect(correctionOutcome("loss", "tie")).toBe("your matchup result stays the same");
  });
});
