import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { captureSnapshots, nflPlayers, playerCrosswalk, players, playerStatLines, preseasonProjections, statWeeks } from "@research-ts/db/schema";
import { statMetricName, STAT_LINE_SOURCE } from "@research-ts/projections/lines";
import { DERIVED_STAT_LINE_SOURCE } from "@research-ts/projections/nflverse/derived-stat-lines";
import { PARTICIPATION_METRICS, NFLVERSE_SOURCE } from "@research-ts/projections/nflverse/map";
import { PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "@research-ts/projections/nflverse/pbp-players";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "@research-ts/projections/nflverse/schedule";
import { recordPropPlayerMap } from "@research-ts/projections/odds/player-map";
import { recordPropObservations } from "@research-ts/projections/odds/props-store";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "@research-ts/projections/store";
import { recordTeamObservations, type TeamWeekObservation } from "@research-ts/projections/team-store";
import { VEGAS_METRICS, VEGAS_SOURCE } from "@research-ts/projections/vegas/ingest";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { collectAllPlayerFacts } from "./collect";

const PRIOR_SEASON = PRODUCT_SEASON - 1;

async function seedPlayer(db: Db, input: { readonly id: string; readonly nflId: string; readonly name: string; readonly position: "RB" | "WR" | "QB"; readonly team: string; readonly points: number; readonly rank: number; readonly adp: number | null }): Promise<void> {
  await db.insert(nflPlayers).values({ id: input.nflId, name: input.name, position: input.position });
  await db.insert(players).values({ id: input.id, name: input.name, position: input.position, nflTeam: input.team, adp: input.adp });
  await db.insert(playerCrosswalk).values({ playerId: input.id, nflPlayerId: input.nflId, method: "espn_id", resolvedAt: new Date() });
  await db.insert(preseasonProjections).values({
    season: PRODUCT_SEASON,
    source: BOARD_SOURCE,
    playerId: input.nflId,
    rank: input.rank,
    positionRank: 1,
    projectedPoints: input.points,
    valueOverReplacement: input.points,
    valueRank: input.rank,
    expectedGames: 17,
    floorPoints: input.points - 20,
    medianPoints: input.points,
    ceilingPoints: input.points + 20,
    tier: 0,
    asOf: new Date("2026-08-01T00:00:00Z"),
    momentKind: "live",
  });
}

describe("collectAllPlayerFacts", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("returns no facts when the board is empty", async () => {
    expect(await collectAllPlayerFacts(db)).toEqual([]);
  });

  it("builds one honest fact sheet per board-ranked player, with no season summary before any week is played", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });

    const facts = await collectAllPlayerFacts(db);
    expect(facts).toHaveLength(1);
    const rashad = facts[0]!;
    expect(rashad.identity).toEqual({ id: "p1", name: "Rashad Long", position: "RB", team: "SF" });
    expect(rashad.market.adp).toBe(12.5);
    expect(rashad.projection.projectedPoints).toBe(248);
    expect(rashad.season).toBeNull();
    // THE TRI-STATE (fix round 1, CRITICAL 2): no injury snapshot has ever been captured in this
    // test's own database, so the honest read is "unknown" — NEVER a healthy claim, which would
    // be indistinguishable from a real snapshot that actually checked and found nothing.
    expect(rashad.injury).toEqual({ state: "unknown" });
    expect(rashad.news).toEqual([]);
  });

  it("attaches a designated player's status and capture instant, and a genuinely clean read for a player the feed checked and did not name", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await seedPlayer(db, { id: "p2", nflId: "00-0000002", name: "Healthy Back", position: "RB", team: "DAL", points: 200, rank: 2, adp: 20 });
    const capturedAt = new Date("2026-09-01T12:00:00Z");
    await db.insert(captureSnapshots).values({ source: "tank01_injuries_by_date", capturedAt, digest: "d1", payload: { injDate: "20260901", injList: [{ playerID: "p1", designation: "Q" }] } });

    const facts = await collectAllPlayerFacts(db);
    const rashad = facts.find((f) => f.identity.id === "p1")!;
    const healthy = facts.find((f) => f.identity.id === "p2")!;
    expect(rashad.injury).toEqual({ state: "designated", designation: "Q", asOf: capturedAt.toISOString() });
    // A snapshot DID run and did not name him — a genuine, dated "clean" read, distinct from
    // "unknown" (see the previous test): the snapshot's own presence is what licenses this.
    expect(healthy.injury).toEqual({ state: "clean", asOf: capturedAt.toISOString() });
  });

  it("attaches up to three recent headlines by name, from one shared snapshot read", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await db.insert(captureSnapshots).values({
      source: "tank01_news",
      capturedAt: new Date(),
      digest: "d1",
      payload: [{ title: "Rashad Long: limited in practice", link: "https://example.com/1", date: "2026-09-02" }],
    });

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.news).toEqual([{ title: "Rashad Long: limited in practice", link: "https://example.com/1", publishedAt: "2026-09-02" }]);
  });

  it("builds a real season summary once a week has been played, under standard PPR scoring", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await db.insert(statWeeks).values({ week: 1, status: "final" });
    await db.insert(playerStatLines).values({ playerId: "p1", week: 1, rushingYards: 100, rushingTouchdowns: 1, receptions: 3, receivingYards: 20, carries: 18, targets: 4 });

    const facts = await collectAllPlayerFacts(db);
    const rashad = facts[0]!;
    expect(rashad.season).not.toBeNull();
    expect(rashad.season?.gamesPlayed).toBe(1);
    expect(rashad.season?.totals.carries).toBe(18);
    expect(rashad.season?.totals.touchdowns).toBe(1);
  });

  it("never lets a scheduled (not-yet-played) week's stat line count toward the season summary", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await db.insert(statWeeks).values({ week: 1, status: "scheduled" });
    await db.insert(playerStatLines).values({ playerId: "p1", week: 1, rushingYards: 100, rushingTouchdowns: 1 });

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.season).toBeNull();
  });
});

/** One player's one prior-season week, spelled the way the nflverse weekly file writes it into
 *  the point-in-time store — the identical shape `league-service/player.test.ts`'s own `week`
 *  helper uses for the same read (`STAT_LINE_SOURCE`/`statMetricName`). `PRIOR_SEASON` throughout:
 *  the color facts describe LAST season, never the current one. */
function priorSeasonWeek(gsisId: string, weekNumber: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(PRIOR_SEASON, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season: PRIOR_SEASON, week: weekNumber, playerId: gsisId, source: STAT_LINE_SOURCE, metric: statMetricName(field), value, asOf,
  }));
}

/** A raw participation observation not carried by `StatLine` itself (a team total, a snap count) —
 *  written directly rather than through `priorSeasonWeek`'s stats dict, which only knows a
 *  player's OWN box-score fields. */
function participationRow(gsisId: string, weekNumber: number, source: string, metric: string, value: number): PlayerWeekObservation {
  return { season: PRIOR_SEASON, week: weekNumber, playerId: gsisId, source, metric, value, asOf: new Date(Date.UTC(PRIOR_SEASON, 10, 1)) };
}

describe("collectAllPlayerFacts — last season's story", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("ranks by total points among peers who played, and states ppg, games, best week and consistency", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await seedPlayer(db, { id: "p2", nflId: "00-1000002", name: "Peer Back", position: "RB", team: "DAL", points: 150, rank: 2, adp: 40 });
    await recordObservations(db, [
      // RB1: 20, 10, 30 points across three weeks — total 60, best week 3.
      ...priorSeasonWeek("00-1000001", 1, { rushingYards: 200 }),
      ...priorSeasonWeek("00-1000001", 2, { rushingYards: 100 }),
      ...priorSeasonWeek("00-1000001", 3, { rushingYards: 300 }),
      // RB2: 5 points across one week — total 5.
      ...priorSeasonWeek("00-1000002", 1, { rushingYards: 50 }),
    ]);

    const facts = await collectAllPlayerFacts(db);
    const rb1 = facts.find((f) => f.identity.id === "p1")!;
    const rb2 = facts.find((f) => f.identity.id === "p2")!;

    // Pooled RB weeks: [20, 10, 30, 5] -> median 15. RB1 clears it twice (20, 30); RB2 never does.
    // Neither player's own weeks carried a `receivingYards` reading, so receiving yards is an
    // honest zero for each of them, tied at rank one. Neither carried a real PARTICIPATION
    // reading either (no snap-count/pbp rows at all), so `touches` has no evidence and its rank
    // is honestly `null`, never a fabricated zero-touches tie.
    const zeroReceivingYards = { value: 0, positionRank: 1, qualifierCount: 2, namedNeighbor: null };
    expect(rb1.lastSeasonStory).toEqual({
      season: PRIOR_SEASON,
      pointsRank: { value: 60, positionRank: 1, qualifierCount: 2, namedNeighbor: null },
      pointsPerGame: 20,
      gamesPlayed: 3,
      bestWeek: { week: 3, points: 30 },
      weeksAboveMedian: 2,
      touchesRank: null,
      receivingYardsRank: zeroReceivingYards,
    });
    expect(rb2.lastSeasonStory).toEqual({
      season: PRIOR_SEASON,
      pointsRank: { value: 5, positionRank: 2, qualifierCount: 2, namedNeighbor: "Rashad Long" },
      pointsPerGame: 5,
      gamesPlayed: 1,
      bestWeek: { week: 1, points: 5 },
      weeksAboveMedian: 0,
      touchesRank: null,
      receivingYardsRank: zeroReceivingYards,
    });
  });

  it("ranks touches and receiving yards, and names the peer one rank above for a top-three finish", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1000010", name: "Volume Back", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await seedPlayer(db, { id: "p2", nflId: "00-1000011", name: "Middle Back", position: "RB", team: "DAL", points: 200, rank: 2, adp: 20 });
    await seedPlayer(db, { id: "p3", nflId: "00-1000012", name: "Third Back", position: "RB", team: "NYJ", points: 150, rank: 3, adp: 40 });
    await recordObservations(db, [
      // Volume Back: 20 carries + 5 receptions = 25 touches, 80 receiving yards.
      ...priorSeasonWeek("00-1000010", 1, { rushingYards: 100, carries: 20, receptions: 5, receivingYards: 80 }),
      // Middle Back: 10 carries + 2 receptions = 12 touches, 40 receiving yards.
      ...priorSeasonWeek("00-1000011", 1, { rushingYards: 50, carries: 10, receptions: 2, receivingYards: 40 }),
      // Third Back: 2 carries + 1 reception = 3 touches, 10 receiving yards.
      ...priorSeasonWeek("00-1000012", 1, { rushingYards: 10, carries: 2, receptions: 1, receivingYards: 10 }),
    ]);

    const facts = await collectAllPlayerFacts(db);
    const volume = facts.find((f) => f.identity.id === "p1")!.lastSeasonStory!;
    const middle = facts.find((f) => f.identity.id === "p2")!.lastSeasonStory!;
    const third = facts.find((f) => f.identity.id === "p3")!.lastSeasonStory!;

    expect(volume.touchesRank).toEqual({ value: 25, positionRank: 1, qualifierCount: 3, namedNeighbor: null });
    expect(middle.touchesRank).toEqual({ value: 12, positionRank: 2, qualifierCount: 3, namedNeighbor: "Volume Back" });
    expect(third.touchesRank).toEqual({ value: 3, positionRank: 3, qualifierCount: 3, namedNeighbor: "Middle Back" });

    expect(volume.receivingYardsRank).toEqual({ value: 80, positionRank: 1, qualifierCount: 3, namedNeighbor: null });
    expect(middle.receivingYardsRank).toEqual({ value: 40, positionRank: 2, qualifierCount: 3, namedNeighbor: "Volume Back" });
    expect(third.receivingYardsRank).toEqual({ value: 10, positionRank: 3, qualifierCount: 3, namedNeighbor: "Middle Back" });
  });

  it("is null for a player the prior-season store carries no played week for (a rookie, most often)", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1000003", name: "Rookie Runner", position: "RB", team: "SF", points: 200, rank: 1, adp: 20 });

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.lastSeasonStory).toBeNull();
  });
});

describe("collectAllPlayerFacts — usage, plain", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("states last season's snap share, target share and red-zone share straight off the observation store", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-2000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await recordObservations(db, [
      // A played week, so `discoveryFactsForSeason` has a points-per-game entry to build off.
      ...priorSeasonWeek("00-2000001", 1, { rushingYards: 100, targets: 5 }),
      participationRow("00-2000001", 1, STAT_LINE_SOURCE, PARTICIPATION_METRICS.teamTargets, 20),
      participationRow("00-2000001", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.offensiveSnaps, 50),
      participationRow("00-2000001", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.teamOffensiveSnaps, 60),
      participationRow("00-2000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.carries, 8),
      participationRow("00-2000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.targets, 5),
      participationRow("00-2000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.redZoneCarries, 2),
      participationRow("00-2000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.redZoneTargets, 1),
      participationRow("00-2000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.insideTenCarries, 1),
      participationRow("00-2000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.insideTenTargets, 0),
      participationRow("00-2000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.airYards, 40),
      participationRow("00-2000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.airYardTargets, 5),
    ]);

    const facts = await collectAllPlayerFacts(db);
    const usage = facts[0]!.usage!;
    expect(usage.season).toBe(PRIOR_SEASON);
    expect(usage.snapShare).toBeCloseTo(50 / 60, 10);
    expect(usage.targetShare).toBeCloseTo(5 / 20, 10);
    // Red-zone share of his OWN touches: (2 red-zone carries + 1 red-zone target) / (8 pbp carries + 5 pbp targets).
    expect(usage.redZoneShare).toBeCloseTo(3 / 13, 10);
    // The lone RB with a real snap-share reading in this test's own database: rank one, of one.
    expect(usage.snapShareRank).toEqual({ value: usage.snapShare, positionRank: 1, qualifierCount: 1, namedNeighbor: null });
  });

  it("ranks a usage share against the peers with a real reading of that SAME share, and names the leader for a second-place finish", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-2000010", name: "Heavy Snaps", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await seedPlayer(db, { id: "p2", nflId: "00-2000011", name: "Light Snaps", position: "RB", team: "DAL", points: 150, rank: 2, adp: 40 });
    await recordObservations(db, [
      ...priorSeasonWeek("00-2000010", 1, { rushingYards: 100 }),
      participationRow("00-2000010", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.offensiveSnaps, 55),
      participationRow("00-2000010", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.teamOffensiveSnaps, 60),
      ...priorSeasonWeek("00-2000011", 1, { rushingYards: 50 }),
      participationRow("00-2000011", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.offensiveSnaps, 15),
      participationRow("00-2000011", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.teamOffensiveSnaps, 60),
    ]);

    const facts = await collectAllPlayerFacts(db);
    const heavy = facts.find((f) => f.identity.id === "p1")!.usage!;
    const light = facts.find((f) => f.identity.id === "p2")!.usage!;
    expect(heavy.snapShareRank).toEqual({ value: 55 / 60, positionRank: 1, qualifierCount: 2, namedNeighbor: null });
    expect(light.snapShareRank).toEqual({ value: 15 / 60, positionRank: 2, qualifierCount: 2, namedNeighbor: "Heavy Snaps" });
  });

  it("is null when the store carries no prior season for him at all", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-2000002", name: "Rookie Runner", position: "RB", team: "SF", points: 200, rank: 1, adp: 20 });

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.usage).toBeNull();
  });
});

/** One player's one week of a named season — `priorSeasonWeek`'s own shape, parameterized by
 *  season (color v2, Task 2's own trend needs TWO prior seasons on record, not just the one every
 *  other color-facts describe block above tests against). */
function seasonWeek(gsisId: string, season: number, weekNumber: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(season, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season, week: weekNumber, playerId: gsisId, source: STAT_LINE_SOURCE, metric: statMetricName(field), value, asOf,
  }));
}

describe("collectAllPlayerFacts — the year-over-year trend", () => {
  let db: Db;
  const OLDER_SEASON = PRIOR_SEASON - 1;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("states a material trend from his own prior two seasons where both exist, and an honest non-material one for a flat peer", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-4000001", name: "Trend Back", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await seedPlayer(db, { id: "p2", nflId: "00-4000002", name: "Steady Back", position: "RB", team: "DAL", points: 150, rank: 2, adp: 40 });

    await recordObservations(db, [
      // Trend Back: 10 points per game (100 rushing yards, 20 carries) two seasons ago, 30 points
      // per game (300 rushing yards, same 20 carries) last season — a real jump in both ppg and
      // yards per touch (5.0 -> 15.0).
      ...seasonWeek("00-4000001", OLDER_SEASON, 1, { rushingYards: 100, carries: 20 }),
      ...seasonWeek("00-4000001", PRIOR_SEASON, 1, { rushingYards: 300, carries: 20 }),
      // Steady Back: identical both seasons — the honest zero-delta, non-material case, and the
      // second population member that gives the pooled stddev real spread to measure against.
      ...seasonWeek("00-4000002", OLDER_SEASON, 1, { rushingYards: 100, carries: 20 }),
      ...seasonWeek("00-4000002", PRIOR_SEASON, 1, { rushingYards: 100, carries: 20 }),
    ]);

    const facts = await collectAllPlayerFacts(db);
    const trendBack = facts.find((f) => f.identity.id === "p1")!.trend!;
    expect(trendBack.pointsPerGame).toEqual({ priorSeason: OLDER_SEASON, priorValue: 10, recentSeason: PRIOR_SEASON, recentValue: 30, delta: 20, material: true });
    expect(trendBack.yardsPerOpportunity).toEqual({ priorSeason: OLDER_SEASON, priorValue: 5, recentSeason: PRIOR_SEASON, recentValue: 15, delta: 10, material: true });
    // No target/team-target observations were ever recorded, so target share has no evidence in
    // either season — absent seasons (of evidence) means an absent fact, never a fabricated share.
    expect(trendBack.targetShare).toBeNull();

    const steadyBack = facts.find((f) => f.identity.id === "p2")!.trend!;
    expect(steadyBack.pointsPerGame!.delta).toBe(0);
    expect(steadyBack.pointsPerGame!.material).toBe(false);
    expect(steadyBack.yardsPerOpportunity!.delta).toBe(0);
    expect(steadyBack.yardsPerOpportunity!.material).toBe(false);
  });

  it("is null when only one of his own prior two seasons exists on the store", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-4000003", name: "Sophomore Back", position: "RB", team: "SF", points: 200, rank: 1, adp: 20 });
    await recordObservations(db, seasonWeek("00-4000003", PRIOR_SEASON, 1, { rushingYards: 100, carries: 20 }));

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.trend).toBeNull();
  });
});

describe("collectAllPlayerFacts — the books' own numbers", () => {
  let db: Db;
  const FIRST_KICKOFF = new Date(`${PRODUCT_SEASON}-09-07T20:20:00.000Z`);
  const WEEK_ONE_GAME = new Date(`${PRODUCT_SEASON}-09-10T17:00:00.000Z`);
  const BEFORE_KICKOFF = new Date(`${PRODUCT_SEASON}-09-05T12:00:00.000Z`);
  const AFTER_KICKOFF = new Date(`${PRODUCT_SEASON}-09-08T12:00:00.000Z`);

  function kickoffFact(overrides: Partial<TeamWeekObservation> = {}): TeamWeekObservation {
    return { season: PRODUCT_SEASON, week: 1, team: "SF", source: SCHEDULE_SOURCE.kickoff, metric: SCHEDULE_METRICS.kickoffInstant, value: 1, asOf: FIRST_KICKOFF, ...overrides };
  }

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("states the median pre-kickoff props line per market and his team's Vegas win total", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-3000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await recordTeamObservations(db, [kickoffFact(), { season: PRODUCT_SEASON, week: 1, team: "SF", source: VEGAS_SOURCE, metric: VEGAS_METRICS.winTotal, value: 9.5, asOf: BEFORE_KICKOFF }]);
    await recordPropPlayerMap(db, [{ propName: "Rashad Long", season: PRODUCT_SEASON, playerId: "00-3000001", method: "exact" }]);
    await recordPropObservations(db, [
      { eventId: "e1", commenceTime: WEEK_ONE_GAME, bookmaker: "draftkings", market: "player_rush_yds", playerName: "Rashad Long", point: 70.5, overPrice: -110, underPrice: -110, fetchedAt: BEFORE_KICKOFF },
      { eventId: "e1", commenceTime: WEEK_ONE_GAME, bookmaker: "fanduel", market: "player_rush_yds", playerName: "Rashad Long", point: 68.5, overPrice: -110, underPrice: -110, fetchedAt: BEFORE_KICKOFF },
    ]);

    const facts = await collectAllPlayerFacts(db);
    const books = facts[0]!.booksNumbers;
    expect(books.propsLines).toEqual([{ market: "player_rush_yds", medianLine: 69.5 }]);
    expect(books.teamVegasWinTotal).toBe(9.5);
  });

  /**
   * THE TWO FRANCHISES THE TWO FEEDS SPELL DIFFERENTLY (`nflverse/team-codes.ts`). The product
   * spells the Rams `LAR` and Washington `WSH`; `team_week_observations` spells them `LA` and
   * `WAS`. Looking the win total up by the board's own code returned nothing for exactly those two,
   * which read on the sheet as the books having posted no line for the Rams rather than as the bug
   * it was.
   */
  it("finds a Rams win total the store keyed under LA from a board row that says LAR", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-3000009", name: "Rashad Long", position: "RB", team: "LAR", points: 248, rank: 1, adp: 12.5 });
    await recordTeamObservations(db, [
      kickoffFact({ team: "LA" }),
      { season: PRODUCT_SEASON, week: 1, team: "LA", source: VEGAS_SOURCE, metric: VEGAS_METRICS.winTotal, value: 11.5, asOf: BEFORE_KICKOFF },
    ]);

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.booksNumbers.teamVegasWinTotal).toBe(11.5);
  });

  it("never admits a props line fetched at or after kickoff — the leakage gate holds in the collector too", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-3000002", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await recordTeamObservations(db, [kickoffFact()]);
    await recordPropPlayerMap(db, [{ propName: "Rashad Long", season: PRODUCT_SEASON, playerId: "00-3000002", method: "exact" }]);
    await recordPropObservations(db, [
      { eventId: "e1", commenceTime: WEEK_ONE_GAME, bookmaker: "draftkings", market: "player_rush_yds", playerName: "Rashad Long", point: 999, overPrice: -110, underPrice: -110, fetchedAt: AFTER_KICKOFF },
    ]);

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.booksNumbers.propsLines).toEqual([]);
  });

  it("is honestly empty/null when the archive holds no line and the win-totals store holds no row", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-3000003", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.booksNumbers).toEqual({ propsLines: [], teamVegasWinTotal: null });
  });
});

/**
 * THE GAP SEASON (peek-facts round, 2026-09-07). Every other test in this file seeds the published
 * weekly feed (`STAT_LINE_SOURCE`) for the prior season. PRODUCTION HAS NO SUCH FEED for it:
 * nflverse never published a weekly stats file for 2025, so `player_week_observations` holds zero
 * `nflverse_player_week` rows there and the store answers from the play-by-play pair instead
 * (`nflverse_pbp_derived` for the scoring line, `nflverse_pbp_player` for the participation counts).
 * These tests seed exactly that shape, which is the shape that made the touches rank come back
 * empty on production while usage and trend came back populated.
 */
function derivedWeek(gsisId: string, weekNumber: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(PRIOR_SEASON, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season: PRIOR_SEASON, week: weekNumber, playerId: gsisId, source: DERIVED_STAT_LINE_SOURCE, metric: statMetricName(field), value, asOf,
  }));
}

describe("collectAllPlayerFacts — a gap season the published weekly feed never covered", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("ranks touches from the play-by-play participation feed when no published week exists", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-4000001", name: "Volume Back", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await seedPlayer(db, { id: "p2", nflId: "00-4000002", name: "Committee Back", position: "RB", team: "DAL", points: 150, rank: 2, adp: 40 });
    await recordObservations(db, [
      ...derivedWeek("00-4000001", 1, { rushingYards: 100, receptions: 5, receivingYards: 40 }),
      ...derivedWeek("00-4000002", 1, { rushingYards: 30, receptions: 1, receivingYards: 10 }),
      participationRow("00-4000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.carries, 20),
      participationRow("00-4000001", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.targets, 6),
      participationRow("00-4000002", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.carries, 6),
      participationRow("00-4000002", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.targets, 2),
    ]);

    const facts = await collectAllPlayerFacts(db);
    const volume = facts.find((f) => f.identity.id === "p1")!.lastSeasonStory!;
    const committee = facts.find((f) => f.identity.id === "p2")!.lastSeasonStory!;

    // Touches are the play-by-play carries plus the derived line's own receptions: 20 + 5, and 6 + 1.
    expect(volume.touchesRank).toEqual({ value: 25, positionRank: 1, qualifierCount: 2, namedNeighbor: null });
    expect(committee.touchesRank).toEqual({ value: 7, positionRank: 2, qualifierCount: 2, namedNeighbor: "Volume Back" });
  });

  it("still refuses a target share it has no team denominator for", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-4000003", name: "Volume Back", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await recordObservations(db, [
      ...derivedWeek("00-4000003", 1, { rushingYards: 100, receptions: 5 }),
      participationRow("00-4000003", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.carries, 20),
      participationRow("00-4000003", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.targets, 6),
    ]);

    // The play-by-play carries no team-target total, so a share of it would be a number with no
    // denominator. Absence, never an invented one.
    expect((await collectAllPlayerFacts(db))[0]!.usage!.targetShare).toBeNull();
  });

  it("lets a published week win over the play-by-play count for the same player", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-4000004", name: "Published Back", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await recordObservations(db, [
      ...priorSeasonWeek("00-4000004", 1, { rushingYards: 100, carries: 11, receptions: 4 }),
      participationRow("00-4000004", 1, PBP_PLAYER_SOURCE, PBP_PLAYER_METRICS.carries, 99),
    ]);

    // Eleven published carries plus four receptions, never the play-by-play's ninety-nine.
    expect((await collectAllPlayerFacts(db))[0]!.lastSeasonStory!.touchesRank?.value).toBe(15);
  });
});
