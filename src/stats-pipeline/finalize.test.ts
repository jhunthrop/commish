import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, lineupSlots, matchups, players, playerStatLines, rosterSlots, statWeeks, teams, users, weeks } from "@/db/schema";
import type { ScoringPresetName } from "@/domain/scoring";
import { HALF_PPR_SCORING, PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring";
import { leagueMedian } from "@/league/median";
import { createLeague } from "@/league-service/creation";
import { writeSchedule } from "@/league-service/schedule";
import { correctSettledWeek } from "./correction";
import { finalizeWeek, requireScore, scoreTeamsForWeek } from "./finalize";
import { fakeStatsProvider } from "./test-support";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

// A WR slot rides along unused by the existing finalizeWeek assertions below (an empty starting
// slot just scores nothing — `scoreTeam` doesn't validate legality, it only sums whatever
// starters exist) so the non-PPR regression test can field a receiver without a second fixture.
const SLOTS = [
  { slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] },
  { slot: "WR" as const, count: 1, eligiblePositions: ["WR" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["QB" as const] },
];

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * Two teams, one QB slot each, one bench each, and a week-1 stat line per quarterback. The
 * draft is marked `complete` by default — `finalizeWeek`'s guard refuses anything less, and
 * every case below except the guard's own test needs a league finalizeWeek will actually score.
 * `scoringPreset` defaults to `"ppr"` for the plain scoring assertions below; the non-PPR
 * regression test passes its own preset so `finalizeWeek` is proven to read the league's own
 * `scoring_settings` row rather than a hardcoded fallback.
 */
async function twoTeamLeague(
  scoringPreset: ScoringPresetName = "ppr",
  draftStatus: "scheduled" | "complete" = "complete",
  medianGame = false,
) {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Duel", format: "snake", teamCount: 2, scoringPreset, auctionBudget: null,
    rosterSlots: SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false, medianGame,
  });
  if (!created.ok) throw new Error(created.reason);
  const teamId = created.teamId;
  if (teamId === null) throw new Error("expected a team id");
  await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });
  if (draftStatus === "complete") {
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));
  }

  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "SF" },
    { id: "qb3", name: "QB Three", position: "QB", nflTeam: "NYJ" },
  ]);
  await db.insert(playerStatLines).values([
    { playerId: "qb1", week: 1, passingYards: 300, passingTouchdowns: 3 },
    { playerId: "qb2", week: 1, passingYards: 100, passingTouchdowns: 0 },
    { playerId: "qb3", week: 1, passingYards: 400, passingTouchdowns: 4 },
  ]);
  await db.insert(rosterSlots).values([
    { teamId, slot: "QB", slotIndex: 0, playerId: "qb1" },
    { teamId, slot: "BENCH", slotIndex: 0, playerId: "qb3" },
    { teamId: "team_2", slot: "QB", slotIndex: 0, playerId: "qb2" },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [teamId, "team_2"], weeks: 2 }));
  return { ...created, teamId, teamIds: [teamId, "team_2"] };
}

describe("finalizeWeek — draft guard", () => {
  it("refuses a league that hasn't finished its draft, leaving its matchups' scores null", async () => {
    const league = await twoTeamLeague("ppr", "scheduled");
    const result = await finalizeWeek(db, league.leagueId, 1);
    expect(result).toEqual({ ok: false, status: 409, reason: "That league hasn't finished its draft yet." });

    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    expect(row!.homeScore).toBeNull();
    expect(row!.awayScore).toBeNull();
  });

  it("stamps a drafted league's week", async () => {
    const league = await twoTeamLeague("ppr", "complete");
    const result = await finalizeWeek(db, league.leagueId, 1);
    expect(result).toEqual({ ok: true, weekNumber: 1, matchupsScored: 1 });
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    expect(row!.homeScore).not.toBeNull();
    expect(row!.awayScore).not.toBeNull();
  });

  it("running it twice produces byte-identical scores", async () => {
    const league = await twoTeamLeague();
    await finalizeWeek(db, league.leagueId, 1);
    const [first] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    await finalizeWeek(db, league.leagueId, 1);
    const [second] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    expect(second).toEqual(first);
  });
});

describe("finalizeWeek", () => {
  it("scores both sides from the stored stat lines and writes the result", async () => {
    const league = await twoTeamLeague();
    const result = await finalizeWeek(db, league.leagueId, 1);
    expect(result).toEqual({ ok: true, weekNumber: 1, matchupsScored: 1 });

    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    // 300 * 0.04 + 3 * 4 = 24; 100 * 0.04 + 0 = 4. The bench QB never counts.
    const scores = [row!.homeScore, row!.awayScore].sort((a, b) => (b ?? 0) - (a ?? 0));
    expect(scores).toEqual([24, 4]);
  });

  it("uses a manager's saved lineup over the drafted default", async () => {
    const league = await twoTeamLeague();
    // Start the bench QB instead: 400 * 0.04 + 4 * 4 = 32.
    await db.insert(lineupSlots).values([
      { teamId: league.teamId, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "qb3" },
      { teamId: league.teamId, weekNumber: 1, slot: "BENCH", slotIndex: 0, playerId: "qb1" },
    ]);
    await finalizeWeek(db, league.leagueId, 1);
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    expect([row!.homeScore, row!.awayScore]).toContain(32);
  });

  it("scores around a starter whose player row is gone, rather than throwing", async () => {
    // lineup_slots.player_id carries no foreign key to players (unlike player_stat_lines, which
    // does) — the fallback half of getLineup exists precisely because a stored slot can outlive
    // its player. scoreTeam's positionById lookup is the guard: a starter with no known position
    // scores as though the slot were empty instead of crashing the whole week's settlement.
    const league = await twoTeamLeague();
    await db.insert(lineupSlots).values([
      { teamId: league.teamId, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "ghost_player" },
      { teamId: league.teamId, weekNumber: 1, slot: "BENCH", slotIndex: 0, playerId: null },
    ]);
    const result = await finalizeWeek(db, league.leagueId, 1);
    expect(result).toEqual({ ok: true, weekNumber: 1, matchupsScored: 1 });
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    const ourScore = row!.homeTeamId === league.teamId ? row!.homeScore : row!.awayScore;
    expect(ourScore).toBe(0); // the ghost starter contributes nothing, same as an empty slot
  });

  it("scores a week with no stat lines as zero rather than failing", async () => {
    const league = await twoTeamLeague();
    const result = await finalizeWeek(db, league.leagueId, 2);
    expect(result).toEqual({ ok: true, weekNumber: 2, matchupsScored: 1 });
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 2)));
    expect([row!.homeScore, row!.awayScore]).toEqual([0, 0]);
  });

  it("is idempotent — re-scoring a week produces the same numbers", async () => {
    const league = await twoTeamLeague();
    await finalizeWeek(db, league.leagueId, 1);
    const [first] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    await finalizeWeek(db, league.leagueId, 1);
    const [second] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    expect(second).toEqual(first);
  });

  it("refuses a week the league does not have", async () => {
    const league = await twoTeamLeague();
    expect(await finalizeWeek(db, league.leagueId, 9)).toEqual({
      ok: false, status: 404, reason: "That week is not part of this league's season.",
    });
  });

  it("drops the week's cached live scores once the settled numbers are the ones that stand", async () => {
    // The cached value was computed from a week in progress. After settlement `matchups` holds the
    // numbers that count, and a surviving cache entry at the same version would keep serving the
    // mid-game total on the cross-league home.
    const { leagueId } = await twoTeamLeague();
    const cache = { invalidate: vi.fn(async () => {}) };

    const result = await finalizeWeek(db, leagueId, 1, cache);

    expect(result.ok).toBe(true);
    expect(cache.invalidate).toHaveBeenCalledWith(leagueId, 1);
  });

  it("does not drop a cached score for a week it refused to settle", async () => {
    const { leagueId } = await twoTeamLeague("ppr", "scheduled");
    const cache = { invalidate: vi.fn(async () => {}) };

    expect((await finalizeWeek(db, leagueId, 1, cache)).ok).toBe(false);
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it("answers 404 for a week the league doesn't have even when its draft is unfinished", async () => {
    // Guard order: "does this exist" before "is this allowed". An undrafted league asked about a
    // week outside its season is two problems at once, and the one that names a thing that does
    // not exist is the more useful answer — the other tells a caller to finish a draft that would
    // not help.
    const { leagueId } = await twoTeamLeague("ppr", "scheduled");
    expect(await finalizeWeek(db, leagueId, 99)).toEqual({
      ok: false,
      status: 404,
      reason: "That week is not part of this league's season.",
    });
  });

  it("refuses a league that doesn't exist", async () => {
    expect(await finalizeWeek(db, "nope", 1)).toEqual({
      ok: false, status: 404, reason: "That league does not exist.",
    });
  });

  it("scores by the league's own (non-PPR) preset, not the fallback PPR rules", async () => {
    const league = await twoTeamLeague("half_ppr");
    await db.insert(players).values({ id: "wr1", name: "WR One", position: "WR", nflTeam: "MIA" });
    await db.insert(rosterSlots).values({ teamId: league.teamId, slot: "WR", slotIndex: 0, playerId: "wr1" });
    await db.insert(playerStatLines).values({ playerId: "wr1", week: 1, receivingYards: 50, receptions: 5 });

    await finalizeWeek(db, league.leagueId, 1);
    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    const ourScore = row!.homeTeamId === league.teamId ? row!.homeScore : row!.awayScore;

    const [qb1Line] = await db.select().from(playerStatLines).where(eq(playerStatLines.playerId, "qb1"));
    const [wr1Line] = await db.select().from(playerStatLines).where(eq(playerStatLines.playerId, "wr1"));
    const halfPprExpected =
      computeFantasyPoints(qb1Line!, "QB", HALF_PPR_SCORING) + computeFantasyPoints(wr1Line!, "WR", HALF_PPR_SCORING);
    const pprExpected =
      computeFantasyPoints(qb1Line!, "QB", PPR_SCORING) + computeFantasyPoints(wr1Line!, "WR", PPR_SCORING);

    // 5 receptions is worth 2.5 points under half-PPR and 5 under full PPR — the two rule
    // sets must disagree, or this test would prove nothing about which one `finalizeWeek` used.
    expect(halfPprExpected).not.toBe(pprExpected);
    expect(ourScore).toBe(halfPprExpected);
    expect(ourScore).not.toBe(pprExpected);
  });
});

describe("finalizeWeek — the league median", () => {
  async function medianOf(leagueId: string, weekNumber: number): Promise<number | null> {
    const [row] = await db.select({ medianScore: weeks.medianScore }).from(weeks).where(and(eq(weeks.leagueId, leagueId), eq(weeks.weekNumber, weekNumber)));
    return row?.medianScore ?? null;
  }

  it("writes the week's median beside the scores it was computed from", async () => {
    const league = await twoTeamLeague("ppr", "complete", true);
    await finalizeWeek(db, league.leagueId, 1);

    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    const scores = [row!.homeScore!, row!.awayScore!];
    expect(await medianOf(league.leagueId, 1)).toBe(leagueMedian(scores));
  });

  it("writes no median for a league that has the toggle off", async () => {
    const league = await twoTeamLeague("ppr", "complete", false);
    await finalizeWeek(db, league.leagueId, 1);
    expect(await medianOf(league.leagueId, 1)).toBeNull();
  });

  it("recomputes the median when a stat correction re-settles the week", async () => {
    const league = await twoTeamLeague("ppr", "complete", true);
    await finalizeWeek(db, league.leagueId, 1);
    const first = await medianOf(league.leagueId, 1);
    expect(first).not.toBeNull();

    // A revised stat line changes the home team's score, which must move the median too — an
    // un-refreshed median at this point would still be describing the week's original scores.
    await db.insert(playerStatLines).values({ playerId: "qb1", week: 1, passingYards: 500, passingTouchdowns: 6 }).onConflictDoUpdate({
      target: [playerStatLines.playerId, playerStatLines.week],
      set: { passingYards: 500, passingTouchdowns: 6 },
    });
    await finalizeWeek(db, league.leagueId, 1);

    const [row] = await db.select().from(matchups).where(and(eq(matchups.leagueId, league.leagueId), eq(matchups.weekNumber, 1)));
    const recomputed = leagueMedian([row!.homeScore!, row!.awayScore!]);
    expect(recomputed).not.toBe(first);
    expect(await medianOf(league.leagueId, 1)).toBe(recomputed);
  });
});

describe("scoreTeamsForWeek", () => {
  it("answers an empty map for a league that doesn't exist, rather than throwing", async () => {
    // The ingestion worker calls this for whatever leagues `affectedTeams` names — a defensive
    // guard against a league vanishing between that lookup and this one, exercised directly
    // since no current caller can otherwise reach it through a real league that's gone missing.
    expect(await scoreTeamsForWeek(db, "does-not-exist", 1, ["some-team"])).toEqual(new Map());
  });
});

describe("finalizeWeek — season completion stamp", () => {
  /** A minimal 2-team, N-week season shell — no players or rosters, since scoring itself is not
   *  what these tests are about (an empty roster scores 0, which finalizeWeek already handles).
   *  Mirrors `correction.test.ts`'s own `seedLeagueShell`, inlined here rather than shared since
   *  that helper is private to its own file. */
  async function leagueWithSeason(weeksCount: number): Promise<{ readonly id: string; readonly teamA: string; readonly teamB: string }> {
    const leagueId = newId();
    const teamA = newId();
    const teamB = newId();
    const userA = newId();
    const userB = newId();
    await db.insert(users).values([
      { id: userA, email: `${userA}@test.local`, displayName: "Manager A" },
      { id: userB, email: `${userB}@test.local`, displayName: "Manager B" },
    ]);
    await db.insert(leagues).values({ id: leagueId, name: leagueId, format: "snake", teamCount: 2, commissionerUserId: userA });
    await db.insert(teams).values([
      { id: teamA, leagueId, userId: userA, name: "Team A" },
      { id: teamB, leagueId, userId: userB, name: "Team B" },
    ]);
    await db.insert(drafts).values({
      id: `${leagueId}_draft`, leagueId, format: "snake", status: "complete",
      kickoffAt: new Date("2026-08-01T00:00:00.000Z"), auctionBudget: null,
    });
    await db.transaction((tx) => writeSchedule(tx, { leagueId, teamIds: [teamA, teamB], weeks: weeksCount }));
    return { id: leagueId, teamA, teamB };
  }

  async function seasonCompletedAt(leagueId: string): Promise<Date | null> {
    const [row] = await db.select({ seasonCompletedAt: leagues.seasonCompletedAt }).from(leagues).where(eq(leagues.id, leagueId));
    return row?.seasonCompletedAt ?? null;
  }

  it("stamps the league's season complete on the write that scores its last week", async () => {
    const league = await leagueWithSeason(3);
    await finalizeWeek(db, league.id, 1, undefined, clock);
    await finalizeWeek(db, league.id, 2, undefined, clock);
    expect(await seasonCompletedAt(league.id)).toBeNull();

    await finalizeWeek(db, league.id, 3, undefined, clock);
    expect((await seasonCompletedAt(league.id))?.toISOString()).toBe(clock.now());
  });

  it("does not stamp a league with an unscored week left, however many are done", async () => {
    const league = await leagueWithSeason(3);
    await finalizeWeek(db, league.id, 3, undefined, clock);
    await finalizeWeek(db, league.id, 1, undefined, clock);
    expect(await seasonCompletedAt(league.id)).toBeNull();
  });

  it("never re-stamps, so a correction to an already-settled week leaves the original date alone", async () => {
    // `correctSettledWeek` re-runs `finalizeWeekInTx` weeks later. A season ended when it ended,
    // and the guard is in the UPDATE's own WHERE, not in a prior read: the same one-way-stamp
    // discipline `reviews.removed_at` and `integrity_flags.resolved_at` already use twice.
    const league = await leagueWithSeason(3);
    await db.insert(players).values({ id: "corr_qb", name: "Corr QB", position: "QB", nflTeam: "KC" });
    await db.insert(rosterSlots).values({ teamId: league.teamA, slot: "QB", slotIndex: 0, playerId: "corr_qb" });
    await db.insert(playerStatLines).values({ playerId: "corr_qb", week: 2, passingYards: 100, passingTouchdowns: 1 });

    await finalizeWeek(db, league.id, 1, undefined, clock);
    await finalizeWeek(db, league.id, 2, undefined, clock);
    await finalizeWeek(db, league.id, 3, undefined, clock);
    const first = await seasonCompletedAt(league.id);
    expect(first).not.toBeNull();

    await db.insert(statWeeks).values({ week: 2, status: "final", version: 1, gamesTotal: 1, gamesFinal: 1, updatedAt: new Date(clock.now()) });
    await db.insert(users).values({ id: "u_admin", email: "admin@test.local", displayName: "Admin" });

    // The provider revises the QB's line, so `persistTick` reports a real change and
    // `correctLeagueInTx` genuinely re-runs `finalizeWeekInTx` for week 2.
    const provider = fakeStatsProvider({
      games: {
        2: [
          {
            gameId: "g_corr",
            week: 2,
            status: "final",
            homeNflTeam: "KC",
            awayNflTeam: "SF",
            lines: [
              {
                playerId: "corr_qb", week: 2, passingYards: 400, passingTouchdowns: 5, interceptions: 0,
                rushingYards: 0, rushingTouchdowns: 0, receivingYards: 0, receivingTouchdowns: 0, receptions: 0,
                fumblesLost: 0, fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
              },
            ],
          },
        ],
      },
    });
    const grantedBudget = {
      reserve: async () => ({ granted: true as const }),
      reserveBackfill: async () => ({ granted: true as const }),
      remaining: async () => 1000,
    };
    const result = await correctSettledWeek(db, { week: 2, by: "u_admin", clock, budget: grantedBudget, provider });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);

    expect((await seasonCompletedAt(league.id))?.toISOString()).toBe(first?.toISOString());
  });
});

describe("requireScore", () => {
  it("returns the score a team has", () => {
    expect(requireScore(new Map([["team_1", 12.5]]), "team_1")).toBe(12.5);
  });

  it("throws rather than silently defaulting when scoreTeamsForWeek and the matchup rows have drifted apart", () => {
    // finalizeWeek's own invariant: every teamId it asks requireScore about came from the exact
    // same matchup rows scoreTeamsForWeek was called with, so a missing entry here means the two
    // have disagreed — a bug worth failing loudly on, never a `?? 0` fallback that would quietly
    // write a wrong score to the season record. Exercised directly since finalizeWeek's own two
    // lookups can never actually disagree with each other in a single call.
    expect(() => requireScore(new Map(), "team_missing")).toThrow(
      'finalizeWeek: no computed score for team "team_missing" — scoreTeamsForWeek and the matchup rows have drifted apart.',
    );
  });
});
