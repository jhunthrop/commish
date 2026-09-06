import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { upsertCapsule } from "@/capsules/store";
import { createTestDb, truncateAll } from "@/db/test-db";
import { matchups, players, playerStatLines, scoringSettings, statWeeks, teams, users } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import { crosswalkRows, recordCrosswalk, resolveCrosswalk } from "@/projections/crosswalk";
import { statMetricName, STAT_LINE_SOURCE } from "@/projections/lines";
import { BENCHMARK_SOURCES } from "@/projections/preseason/benchmarks";
import { BOARD_SOURCE, recordPreseasonProjections } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { recordPreseasonRankings } from "@/projections/preseason/store";
import { recordObservations, type PlayerWeekObservation } from "@/projections/store";
import { recordNflPlayers } from "@/projections/universe";
import { createLeague } from "./creation";
import { parseSeasonParam, playerSeason } from "./player";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const SLOTS = [
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const] },
];

const EMPTY_LINE: Omit<StatLine, "playerId" | "week"> = {
  passingYards: 0,
  passingTouchdowns: 0,
  interceptions: 0,
  rushingYards: 0,
  rushingTouchdowns: 0,
  receivingYards: 0,
  receivingTouchdowns: 0,
  receptions: 0,
  fumblesLost: 0,
  fieldGoalsMade: 0,
  extraPointsMade: 0,
  sacks: 0,
  defensiveInterceptions: 0,
  defensiveTouchdowns: 0,
};

/** A rushing week worth exactly `yards / 10` points under every preset this test uses. */
const rushingWeek = (playerId: string, week: number, yards: number) => ({ ...EMPTY_LINE, playerId, week, rushingYards: yards });

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * One league with a three-week schedule, three running backs, and stat lines in weeks 1 through
 * 3 — but only weeks 1 and 2 marked played (weeks 1 and 2 `final`). Week 3's rows exist ON
 * PURPOSE: the product's own dataset carries stat lines for weeks nobody has played yet, and the
 * whole point of the `stat_weeks` gate is that those rows are not results.
 *
 * `played: false` (the current-season-empty widening, 2026-09-04) marks EVERY week `scheduled`
 * instead — the preseason state a card must show prior-year data for — while leaving every other
 * row (the stat lines, the rosters) exactly as `played: true` does, since `stat_weeks` alone is
 * what `playerSeason` gates the current season's availability on.
 */
async function league({ played = true, isMock = false }: { readonly played?: boolean; readonly isMock?: boolean } = {}) {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Duel", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false, medianGame: false, isMock,
  });
  if (!created.ok) throw new Error(created.reason);
  const leagueId = created.leagueId;

  const homeTeamId = created.teamId;
  if (homeTeamId === null) throw new Error("expected a team id");
  await db.insert(teams).values({ id: "team_2", leagueId, userId: "u2", name: "Team Two" });
  // Three fixtures, so the league's own season is three weeks long — which is what caps the
  // chart's week list independently of how many NFL weeks have been played.
  await db.insert(matchups).values([1, 2, 3].map((weekNumber) => ({ leagueId, weekNumber, homeTeamId, awayTeamId: "team_2" })));
  await db.insert(statWeeks).values([
    { week: 1, status: played ? ("final" as const) : ("scheduled" as const) },
    { week: 2, status: played ? ("final" as const) : ("scheduled" as const) },
    { week: 3, status: "scheduled" as const },
  ]);
  await db.insert(players).values([
    { id: "rb1", name: "Rashad Long", position: "RB" as const, nflTeam: "SF", headshotUrl: null, adp: 2.5 },
    { id: "rb2", name: "Second Back", position: "RB" as const, nflTeam: "NYG", headshotUrl: null, adp: 9.5 },
    { id: "rb3", name: "Unranked Back", position: "RB" as const, nflTeam: "LV", headshotUrl: null, adp: null },
    { id: "wr1", name: "A Receiver", position: "WR" as const, nflTeam: "CIN", headshotUrl: null, adp: 1.5 },
  ]);
  await db.insert(playerStatLines).values([
    rushingWeek("rb1", 1, 200),
    // Week 2 happened WITHOUT rb1 — no row at all.
    rushingWeek("rb1", 3, 999),
    rushingWeek("rb2", 1, 50),
    rushingWeek("rb2", 2, 60),
  ]);
  return leagueId;
}

describe("playerSeason", () => {
  it("draws only weeks the season has actually played, never weeks that merely have rows", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1"))!;
    // Week 3 has a 999-yard stat line and is `scheduled`. It is not a result and does not appear.
    expect(body.weeks.map((week) => week.week)).toEqual([1, 2]);
  });

  it("keeps 'did not play' and 'played and scored nothing' apart", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1"))!;
    expect(body.weeks[0]!.points).toBe(20);
    // No stat line in week 2. Never coalesced to zero.
    expect(body.weeks[1]!.points).toBeNull();
    expect(body.weeks[1]!.percentile).toBeNull();
  });

  it("averages only the weeks he played, so a bye never drags his average down", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1"))!;
    expect(body.pointsPerGame).toBe(20);
  });

  it("ranks him among his own position by market draft position, lower being earlier", async () => {
    const leagueId = await league();
    // A receiver drafted ahead of him does not move his RB rank; an unranked back is not counted.
    expect((await playerSeason(db, leagueId, "rb1"))!.positionRank).toBe(1);
    expect((await playerSeason(db, leagueId, "rb2"))!.positionRank).toBe(2);
  });

  it("gives an unranked player no rank and no percentile, rather than a last place he never earned", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb3"))!;
    expect(body.positionRank).toBeNull();
    expect(body.adpPercentile).toBeNull();
  });

  it("judges a week against every week played at his position, not against his own season", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1"))!;
    // The population is rb1's 20.0 and rb2's 5.0 and 6.0 — his week is the best of the three.
    expect(body.weeks[0]!.percentile).toBe(1);
  });

  it("answers null for a player the feed does not carry at all", async () => {
    const leagueId = await league();
    expect(await playerSeason(db, leagueId, "nobody")).toBeNull();
  });

  it("carries isMockLeague false for a real league", async () => {
    const leagueId = await league();
    expect((await playerSeason(db, leagueId, "rb1"))!.isMockLeague).toBe(false);
  });

  it("carries isMockLeague true for a mock/practice league (Task 4, context honesty)", async () => {
    const leagueId = await league({ isMock: true });
    expect((await playerSeason(db, leagueId, "rb1"))!.isMockLeague).toBe(true);
  });
});

/**
 * THE TWO CELLS THE SOURCE STRIP PRINTED A DASH IN FOR AS LONG AS IT EXISTED.
 *
 * Both readings sit behind the same crosswalk, so the cases worth pinning are the ones where the
 * join or the store legitimately has nothing: an unplaced player, a placed player nobody ranked, a
 * player whose only number belongs to a season that has finished. Every one of those must be a
 * dash, and none of them may be filled from the nearest available number.
 */
describe("playerSeason's preseason readings", () => {
  const CHASE = "00-0036900";
  const NOW = new Date(clock.now());
  const LAST_WEEK = new Date(Date.parse(clock.now()) - 7 * 86_400_000);

  async function crossOver(leagueId: string): Promise<string> {
    await recordNflPlayers(db, [
      { id: CHASE, pfrId: "LongRa00", espnId: "rb1", name: "Rashad Long", position: "RB", latestTeam: "SF", rookieSeason: 2021, lastSeason: 2026 },
    ]);
    await recordCrosswalk(db, crosswalkRows(resolveCrosswalk(
      [{ id: "rb1", name: "Rashad Long", position: "RB" }],
      [{ id: CHASE, espnId: "rb1", name: "Rashad Long" }],
    ), NOW));
    return leagueId;
  }

  it("carries both numbers for a player the crosswalk placed and both stores rank", async () => {
    const leagueId = await crossOver(await league());
    await recordPreseasonRankings(db, [
      { season: PRODUCT_SEASON, source: BENCHMARK_SOURCES.ecr, playerId: CHASE, rank: 14, asOf: LAST_WEEK },
    ]);
    await recordPreseasonProjections(db, [
      { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: CHASE, rank: 9, positionRank: 4, projectedPoints: 288.1,
        valueOverReplacement: 96.4, valueRank: 12, expectedGames: 16.1, floorPoints: 230.5, medianPoints: 288.1,
        ceilingPoints: 316.9, tier: 1, asOf: LAST_WEEK, momentKind: "replay" },
    ]);
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.expertRank).toBe(14);
    expect(body.modelRank).toBe(9);
  });

  /** The failure mode this whole track exists to remove, and the one it must not replace with a
   *  guess: a player nobody placed gets a dash, never the number of somebody with his name. */
  it("gives a player the crosswalk could not place two dashes", async () => {
    const leagueId = await league();
    await recordNflPlayers(db, [
      { id: CHASE, pfrId: "LongRa00", espnId: "someone-else", name: "Rashad Long", position: "RB", latestTeam: "SF", rookieSeason: 2021, lastSeason: 2026 },
    ]);
    await recordPreseasonRankings(db, [
      { season: PRODUCT_SEASON, source: BENCHMARK_SOURCES.ecr, playerId: CHASE, rank: 14, asOf: LAST_WEEK },
    ]);
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.expertRank).toBeNull();
    expect(body.modelRank).toBeNull();
  });

  it("gives a placed player nobody has ranked two dashes rather than a last place", async () => {
    const leagueId = await crossOver(await league());
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.expertRank).toBeNull();
    expect(body.modelRank).toBeNull();
  });

  /**
   * THE MOST PLAUSIBLE-LOOKING LIE AVAILABLE, refused. A board for a finished season would render
   * as a number and read as this year's opinion, with nothing in a bare row of figures to say
   * otherwise.
   */
  it("refuses to fill this season's cell from a season that has ended", async () => {
    const leagueId = await crossOver(await league());
    await recordPreseasonProjections(db, [
      { season: PRODUCT_SEASON - 2, source: BOARD_SOURCE, playerId: CHASE, rank: 9, positionRank: 4, projectedPoints: 288.1,
        valueOverReplacement: 96.4, valueRank: 12, expectedGames: 16.1, floorPoints: 230.5, medianPoints: 288.1,
        ceilingPoints: 316.9, tier: 1, asOf: LAST_WEEK, momentKind: "replay" },
    ]);
    expect((await playerSeason(db, leagueId, "rb1", clock))!.modelRank).toBeNull();
  });

  /** The gate, in the product rather than in a backtest: a consensus stamped tomorrow is not one
   *  we hold today, whatever the row says. */
  it("does not show a ranking stamped after the moment it is being read at", async () => {
    const leagueId = await crossOver(await league());
    await recordPreseasonRankings(db, [
      { season: PRODUCT_SEASON, source: BENCHMARK_SOURCES.ecr, playerId: CHASE, rank: 14,
        asOf: new Date(Date.parse(clock.now()) + 86_400_000) },
    ]);
    expect((await playerSeason(db, leagueId, "rb1", clock))!.expertRank).toBeNull();
  });

  /**
   * THE LOUD READ (Round D, Task 3). `preseasonProjectionsFor` resolves one row PER PLAYER, so a
   * BOARD_SOURCE live retire that failed partway — two generations coexisting under the same
   * (season, source) — would still hand this player a number, silently possibly from the stale
   * generation. Seeded directly (bypassing `writePreseasonBoard`, which the freeze on `BOARD_SOURCE`
   * would refuse anyway): the throw must be loud rather than a quietly wrong rank.
   */
  it("throws rather than serve a player page whose board carries more than one live generation", async () => {
    const leagueId = await crossOver(await league());
    await recordPreseasonProjections(db, [
      { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: CHASE, rank: 9, positionRank: 4, projectedPoints: 288.1,
        valueOverReplacement: 96.4, valueRank: 12, expectedGames: 16.1, floorPoints: 230.5, medianPoints: 288.1,
        ceilingPoints: 316.9, tier: 1, asOf: LAST_WEEK, momentKind: "live" },
      { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: CHASE, rank: 8, positionRank: 3, projectedPoints: 292.0,
        valueOverReplacement: 100.0, valueRank: 10, expectedGames: 16.1, floorPoints: 233.0, medianPoints: 292.0,
        ceilingPoints: 320.0, tier: 1, asOf: NOW, momentKind: "live" },
    ]);
    await expect(playerSeason(db, leagueId, "rb1", clock)).rejects.toThrow(/distinct as_of generations/);
  });
});

/**
 * Player Dossier plan, Task 2 fix round — the review's one Important finding: nothing pinned the
 * `Promise.all` wiring itself, so a future refactor could silently drop `dossier` from the
 * returned body and no test would notice. `dossierFactsFor`'s own logic is fully covered in
 * `dossier-facts.test.ts`; this only pins that `playerSeason` actually calls it and actually
 * returns what it hands back.
 */
describe("playerSeason's dossier", () => {
  const CHASE = "00-0037900";
  const PEER = "00-0037901";
  const NOW = new Date(clock.now());
  const LAST_WEEK = new Date(NOW.getTime() - 7 * 86_400_000);

  async function crossOverBoth(leagueId: string): Promise<string> {
    await recordNflPlayers(db, [
      { id: CHASE, pfrId: "LongRa01", espnId: "rb1", name: "Rashad Long", position: "RB", latestTeam: "SF", rookieSeason: 2021, lastSeason: PRODUCT_SEASON },
      { id: PEER, pfrId: "PeerBa01", espnId: "rb2", name: "Second Back", position: "RB", latestTeam: "NYG", rookieSeason: 2020, lastSeason: PRODUCT_SEASON },
    ]);
    await recordCrosswalk(db, crosswalkRows(resolveCrosswalk(
      [{ id: "rb1", name: "Rashad Long", position: "RB" }, { id: "rb2", name: "Second Back", position: "RB" }],
      [{ id: CHASE, espnId: "rb1", name: "Rashad Long" }, { id: PEER, espnId: "rb2", name: "Second Back" }],
    ), NOW));
    return leagueId;
  }

  it("wires a non-null dossier onto the body for a board-ranked player, per-game rank carrying its qualifier count", async () => {
    const leagueId = await crossOverBoth(await league());
    await recordPreseasonProjections(db, [
      { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: CHASE, rank: 1, positionRank: 1, projectedPoints: 240,
        valueOverReplacement: 96.4, valueRank: 1, expectedGames: 16, floorPoints: 200, medianPoints: 240, ceilingPoints: 280,
        tier: 0, asOf: LAST_WEEK, momentKind: "live" },
      { season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: PEER, rank: 2, positionRank: 2, projectedPoints: 160,
        valueOverReplacement: 60.0, valueRank: 2, expectedGames: 16, floorPoints: 120, medianPoints: 160, ceilingPoints: 200,
        tier: 0, asOf: LAST_WEEK, momentKind: "live" },
    ]);

    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.dossier).not.toBeNull();
    expect(body.dossier!.projection.perGamePositionRank).toEqual({ value: 15, positionRank: 1, qualifierCount: 2 });
  });

  it("answers a null dossier for a player the board never ranked, exactly as collectPlayerFacts does", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.dossier).toBeNull();
  });
});

/**
 * THE SEASON WIDENING (2026-09-04, founder: "make sure our player cards show prior year data
 * when the season hasn't started"). `player_stat_lines`/`stat_weeks` are single-season; these
 * tests pin the seam that lets `playerSeason` answer for a season that store cannot even name —
 * a prior one, read through the crosswalk from the projection engine's point-in-time store and
 * scored under THIS league's own rules, never a different league's or a default's.
 */
describe("playerSeason's season history", () => {
  const CHASE = "00-0036900";
  const PEER = "00-0036950";
  const NOW = new Date(clock.now());
  const LAST = PRODUCT_SEASON - 1;
  const PRIOR = PRODUCT_SEASON - 2;
  const TOO_FAR_BACK = PRODUCT_SEASON - 4;

  /** rb1 -> `CHASE` through the real crosswalk mechanism, plus one historical peer (`PEER`) who
   *  never drafted in this league — present only so a prior season has a population to judge a
   *  week against. */
  async function crossOverRb1({ rookieSeason = 2018 }: { readonly rookieSeason?: number } = {}): Promise<void> {
    await recordNflPlayers(db, [
      { id: CHASE, pfrId: "LongRa00", espnId: "rb1", name: "Rashad Long", position: "RB", latestTeam: "SF", rookieSeason, lastSeason: PRODUCT_SEASON },
      { id: PEER, pfrId: "PeerBa00", espnId: "peer-x", name: "Peer Back", position: "RB", latestTeam: "GB", rookieSeason: 2018, lastSeason: PRODUCT_SEASON },
    ]);
    await recordCrosswalk(db, crosswalkRows(resolveCrosswalk(
      [{ id: "rb1", name: "Rashad Long", position: "RB" }],
      [{ id: CHASE, espnId: "rb1", name: "Rashad Long" }],
    ), NOW));
  }

  /** One player's one recorded week, spelled the way the nflverse weekly file writes it into the
   *  point-in-time store — the same helper shape `player-history-route.test.ts` uses for the
   *  identical read. */
  function week(gsisId: string, season: number, weekNumber: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
    const asOf = new Date(Date.UTC(season, 10, 1));
    return Object.entries(stats).map(([field, value]) => ({
      season, week: weekNumber, playerId: gsisId, source: STAT_LINE_SOURCE, metric: statMetricName(field), value, asOf,
    }));
  }

  it("lists a prior season only once THIS player has a recorded week there, capped at three seasons back, newest first", async () => {
    const leagueId = await league();
    await crossOverRb1();
    await recordObservations(db, [
      ...week(CHASE, LAST, 1, { rushingYards: 100 }),
      ...week(CHASE, PRIOR, 5, { rushingYards: 80 }),
      // Four seasons back is on record but outside the three-season lookback — must not appear.
      ...week(CHASE, TOO_FAR_BACK, 1, { rushingYards: 500 }),
    ]);
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    // The current season is here too: `league()`'s own weeks 1-2 are `final`.
    expect(body.availableSeasons).toEqual([PRODUCT_SEASON, LAST, PRIOR]);
    expect(body.isRookie).toBe(false);
  });

  it("defaults to the current season once the league has played a week, even with prior seasons on record", async () => {
    const leagueId = await league();
    await crossOverRb1();
    await recordObservations(db, [...week(CHASE, LAST, 1, { rushingYards: 100 })]);
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.season).toBe(PRODUCT_SEASON);
    // The untouched current-season path: identical to the pre-widening assertion above.
    expect(body.pointsPerGame).toBe(20);
  });

  it("answers for a requested prior season, scored under THIS league's rules, from the engine's own store — never the single-season table", async () => {
    const leagueId = await league();
    await crossOverRb1();
    await recordObservations(db, [
      ...week(CHASE, LAST, 1, { rushingYards: 100, rushingTouchdowns: 1, receptions: 2 }),
      ...week(CHASE, LAST, 2, { rushingYards: 40 }),
      ...week(PEER, LAST, 1, { rushingYards: 200, rushingTouchdowns: 3 }),
    ]);
    const body = (await playerSeason(db, leagueId, "rb1", clock, LAST))!;
    expect(body.season).toBe(LAST);
    expect(body.availableSeasons[0]).toBe(PRODUCT_SEASON); // still offered, just not the one answered for
    // PPR (this league's own preset): 100*0.1 + 1*6 + 2*1 = 18; 40*0.1 = 4.
    expect(body.weeks[0]).toEqual({ week: 1, points: 18, percentile: 0.5 });
    expect(body.weeks[1]).toEqual({ week: 2, points: 4, percentile: 0 });
    expect(body.pointsPerGame).toBe(11);
    expect(body.pointsPerGamePercentile).toBe(0); // PEER's 38 PPG towers over CHASE's 11
    // Newest week first, and never a fabricated carry count — the store cannot honestly supply one.
    expect(body.log[0]).toMatchObject({ week: 2, points: 4, carries: null, rushingYards: 40, targets: null });
    expect(body.log[1]).toMatchObject({ week: 1, points: 18, carries: null, receptions: 2, touchdowns: 1 });
    expect(body.totals).toEqual({
      games: 2, carries: null, rushingYards: 140, targets: null, receptions: 2,
      receivingYards: 0, passingYards: 0, touchdowns: 1, fantasyPoints: 22,
    });
  });

  it("scores a prior season under a NON-default league setting, proving the read is not a hardcoded PPR assumption", async () => {
    const leagueId = await league();
    await db.update(scoringSettings).set({ pointsPerReception: 2 }).where(eq(scoringSettings.leagueId, leagueId));
    await crossOverRb1();
    await recordObservations(db, [...week(CHASE, LAST, 1, { rushingYards: 100, rushingTouchdowns: 1, receptions: 2 })]);
    const body = (await playerSeason(db, leagueId, "rb1", clock, LAST))!;
    // 100*0.1 + 1*6 + 2*2 (double-PPR) = 20, not the 18 the default PPR preset would have scored.
    expect(body.weeks[0]!.points).toBe(20);
  });

  it("draft-outlook cells (ADP-based) do not move with the requested season — they are a fact about the season he is drafted for, not the one on screen", async () => {
    const leagueId = await league();
    await crossOverRb1();
    await recordObservations(db, [...week(CHASE, LAST, 1, { rushingYards: 100 })]);
    const current = (await playerSeason(db, leagueId, "rb1", clock))!;
    const prior = (await playerSeason(db, leagueId, "rb1", clock, LAST))!;
    expect(prior.positionRank).toBe(current.positionRank);
    expect(prior.adpPercentile).toBe(current.adpPercentile);
  });

  it("falls back to the newest available season when the request names one with no data, rather than fabricating it", async () => {
    const leagueId = await league();
    await crossOverRb1();
    await recordObservations(db, [...week(CHASE, LAST, 1, { rushingYards: 100 })]);
    const body = (await playerSeason(db, leagueId, "rb1", clock, PRIOR))!; // PRIOR has no data
    expect(body.season).toBe(PRODUCT_SEASON);
  });

  it("defaults to the newest PRIOR season when the current season has not been played yet — no empty chrome, no dead end", async () => {
    const leagueId = await league({ played: false });
    await crossOverRb1();
    await recordObservations(db, [
      ...week(CHASE, LAST, 1, { rushingYards: 100, rushingTouchdowns: 1 }),
    ]);
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.availableSeasons).toEqual([LAST]);
    expect(body.isRookie).toBe(false);
    expect(body.season).toBe(LAST);
    expect(body.weeks[0]).toMatchObject({ week: 1, points: 16 }); // 100*0.1 + 6
    expect(body.pointsPerGame).toBe(16);
  });

  /**
   * FIX ROUND 1, CRITICAL — `isRookie` is a CONFIRMED rookie fact (`nfl_players.rookie_season`),
   * never inferred from `availableSeasons` being empty. The pre-fix version of this widening set
   * `isRookie` from data absence alone, which told a real veteran the crosswalk had not placed
   * "his first NFL season" — a biography claim built from nothing. These four tests pin the
   * three-state contract `PlayerSeasonBody`'s own docblock now describes.
   */
  it("a veteran the crosswalk could not place gets the honest 'no record' state, never the rookie one", async () => {
    const leagueId = await league({ played: false });
    // No crosswalk placement at all: the projection engine has nobody to look up, so it cannot
    // say EITHER way whether this is a rookie — the honest answer is "no record", not a guess.
    const unplaced = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(unplaced.availableSeasons).toEqual([]);
    expect(unplaced.isRookie).toBe(false);
    expect(unplaced.season).toBe(PRODUCT_SEASON); // still names a year, with nothing under it
    expect(unplaced.weeks).toEqual([]);
    expect(unplaced.log).toEqual([]);
    expect(unplaced.totals).toBeNull();
    expect(unplaced.pointsPerGame).toBeNull();
    expect(unplaced.pointsPerGamePercentile).toBeNull();
  });

  it("a placed VETERAN (rookieSeason in the past) with no recorded week anywhere also gets the honest 'no record' state, not the rookie one", async () => {
    const leagueId = await league({ played: false });
    await crossOverRb1({ rookieSeason: 2018 }); // placed, but no observations are ever recorded for him
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.availableSeasons).toEqual([]);
    expect(body.isRookie).toBe(false);
  });

  it("a true rookie (rookieSeason === PRODUCT_SEASON) with nothing recorded yet gets the honest rookie flag", async () => {
    const leagueId = await league({ played: false });
    await crossOverRb1({ rookieSeason: PRODUCT_SEASON });
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.availableSeasons).toEqual([]);
    expect(body.isRookie).toBe(true);
  });

  it("a true rookie fact BEHIND a crosswalk miss still resolves to the no-record state, by design", async () => {
    // Re-review round 1's note, pinned: `nfl_players` knows he is a rookie, but with no
    // crosswalk placement the product cannot CONNECT that fact to this player — and a rookie
    // status the product cannot confirm is the same honest position as not being one
    // (PlayerSeasonBody's docblock). "No prior seasons on record" stays literally true.
    const leagueId = await league({ played: false });
    await recordNflPlayers(db, [
      { id: CHASE, pfrId: "LongRa00", espnId: "rb1", name: "Rashad Long", position: "RB", latestTeam: "SF", rookieSeason: PRODUCT_SEASON, lastSeason: PRODUCT_SEASON },
    ]);
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.availableSeasons).toEqual([]);
    expect(body.isRookie).toBe(false);
  });

  it("a rookie's own confirmed status does not survive into a season he has actually played — normal chart, not a rookie sentence", async () => {
    // The league HAS played weeks, so the current season is available regardless of whether this
    // particular rookie has a stat line — `isRookie` only ever gates the "nothing to show" case.
    const leagueId = await league({ played: true });
    await crossOverRb1({ rookieSeason: PRODUCT_SEASON });
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.availableSeasons).toEqual([PRODUCT_SEASON]);
    expect(body.isRookie).toBe(false);
  });

  it("keeps the current season's carries/targets numeric — the widening changes nothing about what today's season already showed", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(body.season).toBe(PRODUCT_SEASON);
    expect(typeof body.totals!.carries).toBe("number");
    expect(typeof body.totals!.targets).toBe("number");
  });

  it("carries null for a player the capsule sweep has not reached yet, and the stored capsule once it has", async () => {
    const leagueId = await league();
    const untouched = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(untouched.capsule).toBeNull();

    await upsertCapsule(db, "rb1", "hash-1", {
      compact: { text: "Compact body.", source: "llm", usage: null, fallbackReason: null },
      full: { text: "Full body.", source: "llm", usage: null, fallbackReason: null },
      source: "llm",
      model: "zai/glm-5.3-flash",
    });
    const withCapsule = (await playerSeason(db, leagueId, "rb1", clock))!;
    expect(withCapsule.capsule).toEqual({ bodyCompact: "Compact body.", bodyFull: "Full body.", source: "llm" });
  });
});

/**
 * FIX ROUND 1, MEDIUM/LOW — the one place a `season` query param becomes a number, shared by the
 * API route and the player page rather than duplicated inline in both.
 */
describe("parseSeasonParam", () => {
  it("treats absent, null and empty input as 'let the service pick'", () => {
    expect(parseSeasonParam(undefined)).toBeUndefined();
    expect(parseSeasonParam(null)).toBeUndefined();
    expect(parseSeasonParam("")).toBeUndefined();
  });

  it("parses a clean in-range year", () => {
    expect(parseSeasonParam(String(PRODUCT_SEASON - 1))).toBe(PRODUCT_SEASON - 1);
  });

  it("rejects a non-integer year", () => {
    expect(parseSeasonParam("2025.5")).toBeUndefined();
  });

  it("rejects exponential notation that Number() would otherwise accept", () => {
    // Number("2025e2") is 202500, a clean integer — only the upper bound catches it, and that is
    // exactly why the check has to run here rather than relying on `Number.isInteger` alone.
    expect(parseSeasonParam("2025e2")).toBeUndefined();
  });

  it("rejects garbage text", () => {
    expect(parseSeasonParam("abc")).toBeUndefined();
  });

  it("rejects a year before the earliest plausible season", () => {
    expect(parseSeasonParam("1999")).toBeUndefined();
  });

  it("rejects a year after the season being drafted for", () => {
    expect(parseSeasonParam(String(PRODUCT_SEASON + 1))).toBeUndefined();
  });

  it("accepts the boundary years", () => {
    expect(parseSeasonParam("2000")).toBe(2000);
    expect(parseSeasonParam(String(PRODUCT_SEASON))).toBe(PRODUCT_SEASON);
  });
});
