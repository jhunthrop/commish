import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DbTx } from "@research-ts/db/client";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players, playerStatLines, statWeeks } from "@research-ts/db/schema";
import { auditEvents, drafts, leagues, matchups, memberNotices, rosterSlots, teams, users, weeks } from "@/db/schema";
import type { AuditEvent, AuditEventInput } from "@/domain/audit";
import type { StatLine } from "@research-ts/domain/player";
import { leagueMedian } from "@/league/median";
import { writeSchedule } from "@/league-service/schedule";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { copyViolations } from "@/integrity/copy-rules";
import type { RequestBudget } from "./budget";
import { correctSettledWeek, correctionOutcome, matchupResultFor, resolveCorrectionOutcome, type CorrectionResult } from "./correction";
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
    listAdp: async () => [],
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
  medianGame = false,
): Promise<void> {
  await db.insert(users).values(teamSpecs.map((t) => ({ id: t.userId, email: `${t.userId}@test.local`, displayName: t.userId })));
  await db.insert(leagues).values({
    id: leagueId, name: leagueId, format: "snake", teamCount: teamSpecs.length,
    commissionerUserId: teamSpecs[0]!.userId, rosterSlots: SLOTS, medianGame,
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

async function medianOf(leagueId: string, weekNumber: number): Promise<number | null> {
  const [row] = await db.select({ medianScore: weeks.medianScore }).from(weeks).where(and(eq(weeks.leagueId, leagueId), eq(weeks.weekNumber, weekNumber)));
  return row?.medianScore ?? null;
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

/** Narrows a `CorrectionResult` to its `ok: true` arm, or fails the test with the refusal reason —
 *  every fix-round-2 test needs `leaguesFailed`, which only exists on that arm. */
function expectOk(result: CorrectionResult): Extract<CorrectionResult, { readonly ok: true }> {
  if (!result.ok) throw new Error(`expected ok:true, got refusal: ${result.reason}`);
  return result;
}

/** A real `AuditLogger` (`getAuditLogger()`) that throws for exactly one league's own append,
 *  simulating a mid-loop failure — the fix-round-2 (F2) failure-injection case. Every OTHER
 *  league's append goes through the real logger untouched. */
function auditThrowingForLeague(leagueId: string): AuditLogger {
  const real = getAuditLogger();
  return {
    record: async (tx: DbTx, input: AuditEventInput): Promise<AuditEvent> => {
      if (input.leagueId === leagueId) throw new Error(`simulated audit failure for ${leagueId}`);
      return real.record(tx, input);
    },
    recordAll: async (tx: DbTx, inputs: readonly AuditEventInput[]): Promise<readonly AuditEvent[]> => {
      if (inputs.some((entry) => entry.leagueId === leagueId)) throw new Error(`simulated audit failure for ${leagueId}`);
      return real.recordAll(tx, inputs);
    },
  };
}

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

  it("re-settles two leagues that both actually changed, each in its own transaction and its own chain", async () => {
    // Both lg_a's qb_a and lg_b's qb_c are revised, so both leagues genuinely have something to
    // record — Plan A ruling 3's proof that a transaction appends to exactly one chain needs two
    // REAL leagues, not one real and one that only re-settles to the same numbers (that scenario
    // is the next test, and after fix round 1's F1 it would prove the opposite property).
    await seedTwoLeagueFixture();
    const provider = fakeStatsProvider({
      games: {
        [WEEK]: [
          {
            gameId: "g_correct", week: WEEK, status: "final", homeNflTeam: "KC", awayNflTeam: "SF",
            lines: [statLine("qb_a", WEEK, { passingYards: 350, passingTouchdowns: 4 }), statLine("qb_c", WEEK, { passingYards: 300, passingTouchdowns: 3 })],
          },
        ],
      },
    });
    const result = expectOk(await correctSettledWeek(db, { week: WEEK, by: "u_op", provider, budget: grantedBudget }));
    expect(result).toMatchObject({ leaguesResettled: 2, leaguesChanged: 2, leaguesFailed: [] });
    expect(await auditEventsOn("lg_a")).toHaveLength(1);
    expect(await auditEventsOn("lg_b")).toHaveLength(1);
  });

  it("recomputes the median when a stat correction re-settles the week", async () => {
    // `correctSettledWeek` re-runs settlement inside the three-day correction window and
    // OVERWRITES scores. A median left at its first value would describe a week that no longer
    // exists, so the write is an overwrite, not a one-way stamp — see `weeks.median_score`'s own
    // docblock in `@research-ts/db/schema` for why that is the opposite of `leagues.season_completed_at`.
    await db.insert(players).values([
      { id: "qb_a", name: "QB A", position: "QB", nflTeam: "KC" },
      { id: "qb_b", name: "QB B", position: "QB", nflTeam: "SF" },
    ]);
    await seedLeagueShell("lg_median", [{ teamId: "team_a", userId: "u_manager" }, { teamId: "team_b", userId: "u_rival" }], "complete", true);
    await addRoster("team_a", "qb_a");
    await addRoster("team_b", "qb_b");
    await db.insert(playerStatLines).values([
      { playerId: "qb_a", week: WEEK, passingYards: 300, passingTouchdowns: 3 },
      { playerId: "qb_b", week: WEEK, passingYards: 200, passingTouchdowns: 1 },
    ]);
    await finalizeWeek(db, "lg_median", WEEK);
    await markWeekSettled(WEEK, NOW);

    const before = await medianOf("lg_median", WEEK);
    expect(before).not.toBeNull();

    const provider = fakeStatsProvider({
      games: {
        [WEEK]: [
          {
            gameId: "g_median", week: WEEK, status: "final", homeNflTeam: "KC", awayNflTeam: "SF",
            lines: [statLine("qb_a", WEEK, { passingYards: 500, passingTouchdowns: 6 })],
          },
        ],
      },
    });
    const result = expectOk(await correctSettledWeek(db, { week: WEEK, by: "u_op", provider, budget: grantedBudget }));
    expect(result.leaguesChanged).toBe(1);

    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_median"), eq(matchups.weekNumber, WEEK)));
    const recomputed = leagueMedian([row!.homeScore!, row!.awayScore!]);
    expect(recomputed).not.toBe(before);
    expect(await medianOf("lg_median", WEEK)).toBe(recomputed);
  });

  it("reports a median-only flip's own outcome truthfully — fix round 1 (F1)'s honesty gap", async () => {
    // Four teams, so the median is a real number distinct from any one team's own score. The
    // pairing is pinned by hand (a-vs-b, c-vs-d) rather than trusted from the generated schedule,
    // so team_b's own matchup opponent is GUARANTEED never to be team_c — the team whose own
    // correction is what pulls the league median down across team_b's score.
    await db.insert(players).values([
      { id: "mf_a", name: "MF A", position: "QB", nflTeam: "KC" },
      { id: "mf_b", name: "MF B", position: "QB", nflTeam: "SF" },
      { id: "mf_c", name: "MF C", position: "QB", nflTeam: "DAL" },
      { id: "mf_d", name: "MF D", position: "QB", nflTeam: "NYJ" },
    ]);
    await seedLeagueShell(
      "lg_median_flip",
      [
        { teamId: "mf_team_a", userId: "u_mf_a" },
        { teamId: "mf_team_b", userId: "u_mf_b" },
        { teamId: "mf_team_c", userId: "u_mf_c" },
        { teamId: "mf_team_d", userId: "u_mf_d" },
      ],
      "complete",
      true,
    );
    await addRoster("mf_team_a", "mf_a");
    await addRoster("mf_team_b", "mf_b");
    await addRoster("mf_team_c", "mf_c");
    await addRoster("mf_team_d", "mf_d");

    await db.delete(matchups).where(and(eq(matchups.leagueId, "lg_median_flip"), eq(matchups.weekNumber, WEEK)));
    await db.insert(matchups).values([
      { leagueId: "lg_median_flip", weekNumber: WEEK, homeTeamId: "mf_team_a", awayTeamId: "mf_team_b", homeScore: null, awayScore: null },
      { leagueId: "lg_median_flip", weekNumber: WEEK, homeTeamId: "mf_team_c", awayTeamId: "mf_team_d", homeScore: null, awayScore: null },
    ]);

    // passingYards * 0.04 (PPR_SCORING's rate — the fallback this shell-seeded league gets with
    // no scoring_settings row): a=50, b=40, c=45, d=20. Median = avg(40,45) = 42.5. team_b (40)
    // loses to team_a (50) head to head, AND loses to the median.
    await db.insert(playerStatLines).values([
      { playerId: "mf_a", week: WEEK, passingYards: 1250 },
      { playerId: "mf_b", week: WEEK, passingYards: 1000 },
      { playerId: "mf_c", week: WEEK, passingYards: 1125 },
      { playerId: "mf_d", week: WEEK, passingYards: 500 },
    ]);
    await finalizeWeek(db, "lg_median_flip", WEEK);
    await markWeekSettled(WEEK, NOW);

    // The correction nudges team_b's OWN score up slightly (40->41 — a real movement, so it
    // enters the "moved" notify gate at all) and drops team_c's score hard (45->30). team_a and
    // team_d are untouched, so team_b's own matchup (vs team_a, 50) stays a loss both times. But
    // the LEAGUE median drops from 42.5 to avg(30,41)=35.5 — team_b's median result flips from a
    // loss to a win, even though team_b never played team_c and its own matchup never moved.
    const provider = fakeStatsProvider({
      games: {
        [WEEK]: [
          {
            gameId: "g_mf_1", week: WEEK, status: "final", homeNflTeam: "KC", awayNflTeam: "SF",
            lines: [statLine("mf_b", WEEK, { passingYards: 1025 })],
          },
          {
            gameId: "g_mf_2", week: WEEK, status: "final", homeNflTeam: "DAL", awayNflTeam: "NYJ",
            lines: [statLine("mf_c", WEEK, { passingYards: 750 })],
          },
        ],
      },
    });

    const result = expectOk(await correctSettledWeek(db, { week: WEEK, by: "u_op", provider, budget: grantedBudget }));
    expect(result.leaguesChanged).toBe(1);

    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_median_flip"), eq(matchups.weekNumber, WEEK), eq(matchups.homeTeamId, "mf_team_a")));
    expect(row!.homeScore).toBe(50);
    expect(row!.awayScore).toBe(41); // team_b: still loses the matchup...
    expect(await medianOf("lg_median_flip", WEEK)).toBe(35.5); // ...but the median it now beats moved under it.

    // The old matchup-only clause would say "your matchup result stays the same" here — true
    // about the matchup, and silent about the median swing that just changed team_b's real
    // record. The fix names both games.
    const notices = await noticesFor("u_mf_b");
    expect(notices).toHaveLength(1);
    expect(notices[0]!.body).toContain("your matchup result stays the same, but that turns your median result into a win");
    expect(notices[0]!.body).not.toMatch(/points, and your matchup result stays the same\.$/);
    expect(copyViolations(`${notices[0]!.title} ${notices[0]!.body}`)).toEqual([]);
  });

  it("finds no stored 'before' median for a median league reaching settlement for the first time through a correction", async () => {
    // `weeks` rows exist from `writeSchedule` for every league regardless of scoring, but
    // `median_score` stays null until something actually calls `finalizeWeekInTx` — a league
    // whose week has NEVER been scored (never through the worker, never through a prior
    // correction) has a `weeks` row with a null median, not a missing row. `medianScoreFor`
    // must read that as "no median yet" rather than crash on it, exactly like `weeks.median_
    // score`'s own nullable column claims for exactly this case.
    await db.insert(players).values({ id: "nb_qb", name: "No Before QB", position: "QB", nflTeam: "KC" });
    await seedLeagueShell("lg_no_before", [{ teamId: "nb_team_a", userId: "u_nb_a" }, { teamId: "nb_team_b", userId: "u_nb_b" }], "complete", true);
    await addRoster("nb_team_a", "nb_qb");
    await db.insert(playerStatLines).values({ playerId: "nb_qb", week: WEEK, passingYards: 1000 });
    // Deliberately no `finalizeWeek` call here — this league's matchups still hold null scores,
    // and its `weeks` row for WEEK still holds a null median, both for the very first time.
    await markWeekSettled(WEEK, NOW);

    // The provider's own line must genuinely differ from what's stored, or `persistTick` reports
    // no change at all and `correctLeagueInTx` (and therefore `medianScoreFor`) is never reached.
    const provider = fakeStatsProvider({
      games: { [WEEK]: [{ gameId: "g_no_before", week: WEEK, status: "final", homeNflTeam: "KC", awayNflTeam: "SF", lines: [statLine("nb_qb", WEEK, { passingYards: 1200 })] }] },
    });
    const result = expectOk(await correctSettledWeek(db, { week: WEEK, by: "u_op", provider, budget: grantedBudget }));
    // The league genuinely resettles (its matchups now have real scores for the first time), but
    // nothing is reported as "moved": every team's own `before` state was `undefined` (never
    // previously scored), which `correctLeagueInTx`'s own moved-loop already treats as nothing to
    // compare against — this test's point is that reaching that state never throws, not that it
    // notifies anyone.
    expect(result.leaguesResettled).toBe(1);
    expect(result.leaguesChanged).toBe(0);
  });

  /**
   * Fix round 1, F1 (HIGH, adjudicated): a league that re-settles to BYTE-IDENTICAL numbers used
   * to get a `system_action` anyway, because the write happened unconditionally. Ruled: gate the
   * anchor (and every notice) on that league's OWN before/after diff, exactly as the notices
   * already were — "always re-settling" (founder decision 11) is a claim about the write, not
   * about the record. lg_b fields the week but none of its rostered players are in the provider's
   * script, so it re-settles to the SAME numbers it already had and must write nothing about it.
   */
  it("does not record a system_action for a league whose recomputed results are byte-identical, even though it still re-settles", async () => {
    await seedTwoLeagueFixture();
    const result = expectOk(await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: grantedBudget }));
    expect(result).toMatchObject({ leaguesResettled: 2, leaguesChanged: 1, leaguesFailed: [] });
    expect(await auditEventsOn("lg_a")).toHaveLength(1);
    expect(await auditEventsOn("lg_b")).toHaveLength(0);
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

    const result = expectOk(await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: grantedBudget }));
    expect(result).toMatchObject({ changed: true, leaguesResettled: 1, leaguesChanged: 1, leaguesFailed: [] });
    expect(await auditEventsOn("lg_a")).toHaveLength(1);
    expect(await auditEventsOn("lg_undrafted")).toHaveLength(0);
    const [undraftedRow] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_undrafted"), eq(matchups.weekNumber, WEEK)));
    expect(undraftedRow!.homeScore).toBeNull();
  });

  /**
   * A league whose week was never previously scored has no baseline to diff against — every team
   * reads `beforeState === undefined` and is skipped from `moved`, so this ALSO exercises F1's
   * gate: the league genuinely re-settles (its null scores become real ones) but records nothing,
   * because "moved from nothing to something" is not a comparison this notice can make honestly.
   */
  it("compares against nothing, records nothing, and sends no notice, for a league whose week was never previously scored", async () => {
    await db.insert(players).values({ id: "qb_a", name: "QB A", position: "QB", nflTeam: "KC" });
    await seedLeagueShell("lg_a", [{ teamId: "team_a", userId: "u_manager" }, { teamId: "team_b", userId: "u_rival" }], "complete");
    await addRoster("team_a", "qb_a");
    await db.insert(playerStatLines).values({ playerId: "qb_a", week: WEEK, passingYards: 300, passingTouchdowns: 3 });
    // Deliberately no `finalizeWeek` call here — the matchup row's scores start out null, unlike
    // every other test's fixture.
    await markWeekSettled(WEEK, NOW);

    const result = expectOk(await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: grantedBudget }));
    expect(result).toMatchObject({ changed: true, leaguesResettled: 1, leaguesChanged: 0, leaguesFailed: [] });
    expect(await auditEventsOn("lg_a")).toHaveLength(0);
    expect(await noticesFor("u_manager")).toHaveLength(0);
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_a"), eq(matchups.weekNumber, WEEK)));
    expect(row!.homeScore).not.toBeNull();
  });

  /**
   * Fix round 1, F2 (HIGH/MEDIUM): the per-league loop had no try/catch, so a mid-loop transaction
   * failure propagated as an unhandled rejection and lost every OTHER league's result along with
   * it. Ruled: wrap each league's own transaction, collect failures by name and reason, and keep
   * attempting the rest — each league's correction is independent, so attempting every one is more
   * operator-friendly than stopping at the first failure. Three leagues, all three genuinely
   * revised; the audit logger throws for the MIDDLE one only.
   */
  it("wraps each league's own transaction: one failure does not stop the others, and is reported by name and reason", async () => {
    await db.insert(players).values([
      { id: "qb_x", name: "QB X", position: "QB", nflTeam: "KC" },
      { id: "qb_y", name: "QB Y", position: "QB", nflTeam: "SF" },
      { id: "qb_z", name: "QB Z", position: "QB", nflTeam: "DAL" },
    ]);
    for (const [leagueId, teamId, userId, playerId] of [
      ["lg_1", "team_x", "u_x", "qb_x"],
      ["lg_2", "team_y", "u_y", "qb_y"],
      ["lg_3", "team_z", "u_z", "qb_z"],
    ] as const) {
      await seedLeagueShell(leagueId, [{ teamId, userId }, { teamId: `${teamId}_rival`, userId: `${userId}_rival` }], "complete");
      await addRoster(teamId, playerId);
      await db.insert(playerStatLines).values({ playerId, week: WEEK, passingYards: 200, passingTouchdowns: 1 });
      await finalizeWeek(db, leagueId, WEEK);
    }
    await markWeekSettled(WEEK, NOW);

    const provider = fakeStatsProvider({
      games: {
        [WEEK]: [
          {
            gameId: "g_all", week: WEEK, status: "final", homeNflTeam: "KC", awayNflTeam: "SF",
            lines: [
              statLine("qb_x", WEEK, { passingYards: 300, passingTouchdowns: 3 }),
              statLine("qb_y", WEEK, { passingYards: 300, passingTouchdowns: 3 }),
              statLine("qb_z", WEEK, { passingYards: 300, passingTouchdowns: 3 }),
            ],
          },
        ],
      },
    });

    const result = expectOk(
      await correctSettledWeek(db, { week: WEEK, by: "u_op", provider, budget: grantedBudget, audit: auditThrowingForLeague("lg_2") }),
    );
    expect(result).toMatchObject({ changed: true, leaguesResettled: 2, leaguesChanged: 2 });
    expect(result.leaguesFailed).toEqual([{ leagueId: "lg_2", reason: expect.stringContaining("simulated audit failure for lg_2") }]);

    expect(await auditEventsOn("lg_1")).toHaveLength(1);
    expect(await auditEventsOn("lg_2")).toHaveLength(0);
    expect(await auditEventsOn("lg_3")).toHaveLength(1);

    // lg_2's own transaction rolled back entirely — no notice for its manager either.
    expect(await noticesFor("u_y")).toHaveLength(0);
    expect(await noticesFor("u_x")).toHaveLength(1);
    expect(await noticesFor("u_z")).toHaveLength(1);

    // What rolled back is scoped to lg_2's OWN transaction: `player_stat_lines` committed in the
    // earlier, separate `persistTick` transaction regardless, but lg_2's `matchups` row — written
    // inside the failed transaction — kept its ORIGINAL score (200 * 0.04 + 1 * 4 = 12), not the
    // corrected one (300 * 0.04 + 3 * 4 = 24).
    const [qbYLine] = await db.select().from(playerStatLines).where(eq(playerStatLines.playerId, "qb_y"));
    expect(qbYLine!.passingYards).toBe(300);
    const [lg2Row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, "lg_2"), eq(matchups.weekNumber, WEEK)));
    const teamYScore = lg2Row!.homeTeamId === "team_y" ? lg2Row!.homeScore : lg2Row!.awayScore;
    expect(teamYScore).toBe(12);
  });

  it("stringifies a thrown non-Error value the same way, rather than assuming every failure is an Error", async () => {
    await seedTwoLeagueFixture();
    // `notify` throws a bare string — not every rejection in JS is an `Error` instance, and the
    // failure report has to name it either way.
    const throwingNotify: typeof import("@/integrity-service/notify").notifyAffectedMember = async () => {
      throw "not an Error instance";
    };
    const result = expectOk(
      await correctSettledWeek(db, { week: WEEK, by: "u_op", provider: correctionProvider(), budget: grantedBudget, notify: throwingNotify }),
    );
    expect(result.leaguesFailed).toEqual([{ leagueId: "lg_a", reason: "not an Error instance" }]);
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

describe("resolveCorrectionOutcome", () => {
  it("falls back to correctionOutcome's own matchup-only clause when no median is in play", () => {
    // Either side missing (toggle off, or a week reaching finalizeWeekInTx for the first time
    // through a correction) — the exact fallback that keeps a plain league's notices unchanged.
    expect(resolveCorrectionOutcome({ matchupBefore: "loss", matchupAfter: "win", medianBefore: null, medianAfter: null })).toBe(
      correctionOutcome("loss", "win"),
    );
    expect(resolveCorrectionOutcome({ matchupBefore: "tie", matchupAfter: "tie", medianBefore: "win", medianAfter: null })).toBe(
      correctionOutcome("tie", "tie"),
    );
    expect(resolveCorrectionOutcome({ matchupBefore: "tie", matchupAfter: "tie", medianBefore: null, medianAfter: "win" })).toBe(
      correctionOutcome("tie", "tie"),
    );
  });

  // Fix round 1 (F1), the honesty gap this test set exists to close: a median-only flip while the
  // matchup holds used to be reported as "your matchup result stays the same" — true and
  // misleading, since the team's real record DID move. Every one of the full 3x3 grid's nine
  // combinations is driven here, not just the one the review named.
  type Result = "win" | "loss" | "tie";
  const CASES: readonly [Result, Result, Result, Result, string][] = [
    ["tie", "tie", "tie", "tie", "your matchup result stays the same, and so does your median result"],
    ["tie", "tie", "loss", "win", "your matchup result stays the same, but that turns your median result into a win"],
    ["tie", "tie", "win", "loss", "your matchup result stays the same, but that turns your median result into a loss"],
    ["loss", "win", "tie", "tie", "that turns your matchup into a win, but your median result stays the same"],
    ["loss", "win", "loss", "win", "that turns your matchup into a win, and that also turns your median result into a win"],
    ["loss", "win", "win", "loss", "that turns your matchup into a win, but that turns your median result into a loss"],
    ["win", "loss", "tie", "tie", "that turns your matchup into a loss, but your median result stays the same"],
    ["win", "loss", "loss", "win", "that turns your matchup into a loss, but that turns your median result into a win"],
    ["win", "loss", "win", "loss", "that turns your matchup into a loss, and that also turns your median result into a loss"],
  ];

  it.each(CASES)(
    "matchup %s->%s, median %s->%s reports %j",
    (matchupBefore, matchupAfter, medianBefore, medianAfter, expected) => {
      expect(resolveCorrectionOutcome({ matchupBefore, matchupAfter, medianBefore, medianAfter })).toBe(expected);
    },
  );

  it("reports the median-only flip specifically — the exact scenario that used to lie", () => {
    // The matchup holds a tie both times (no head-to-head movement at all); the median moves from
    // a loss to a win. The old matchup-only clause would have said "stays the same" here, silently
    // dropping the median swing that just changed this team's real record.
    const outcome = resolveCorrectionOutcome({ matchupBefore: "tie", matchupAfter: "tie", medianBefore: "loss", medianAfter: "win" });
    expect(outcome).toBe("your matchup result stays the same, but that turns your median result into a win");
    expect(outcome).not.toBe("your matchup result stays the same");
  });
});
