import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, lineupSlots, matchups, players, playerStatLines, rosterSlots, teams, users } from "@/db/schema";
import type { ScoringPresetName } from "@/domain/scoring";
import { HALF_PPR_SCORING, PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring";
import { createLeague } from "@/league-service/creation";
import { writeSchedule } from "@/league-service/schedule";
import { finalizeWeek, requireScore, scoreTeamsForWeek } from "./finalize";

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
async function twoTeamLeague(scoringPreset: ScoringPresetName = "ppr", draftStatus: "scheduled" | "complete" = "complete") {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Duel", format: "snake", teamCount: 2, scoringPreset, auctionBudget: null,
    rosterSlots: SLOTS, commissionerUserId: "u1", teamName: "Team One",
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
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
    { teamId: created.teamId, slot: "QB", slotIndex: 0, playerId: "qb1" },
    { teamId: created.teamId, slot: "BENCH", slotIndex: 0, playerId: "qb3" },
    { teamId: "team_2", slot: "QB", slotIndex: 0, playerId: "qb2" },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [created.teamId, "team_2"], weeks: 2 }));
  return { ...created, teamIds: [created.teamId, "team_2"] };
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
      ok: false, status: 404, reason: "That week isn't part of this league's season.",
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

  it("refuses a league that doesn't exist", async () => {
    expect(await finalizeWeek(db, "nope", 1)).toEqual({
      ok: false, status: 404, reason: "That league doesn't exist.",
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

describe("scoreTeamsForWeek", () => {
  it("answers an empty map for a league that doesn't exist, rather than throwing", async () => {
    // The ingestion worker calls this for whatever leagues `affectedTeams` names — a defensive
    // guard against a league vanishing between that lookup and this one, exercised directly
    // since no current caller can otherwise reach it through a real league that's gone missing.
    expect(await scoreTeamsForWeek(db, "does-not-exist", 1, ["some-team"])).toEqual(new Map());
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
