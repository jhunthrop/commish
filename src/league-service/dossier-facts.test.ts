import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research/db/client";
import { nflGames, nflPlayers, playerCrosswalk, players, preseasonProjections } from "@research/db/schema";
import { LEAGUE_CONFIG } from "@/league";
import { statMetricName, STAT_LINE_SOURCE } from "@research/projections/lines";
import { NFLVERSE_SOURCE, PARTICIPATION_METRICS } from "@research/projections/nflverse/map";
import { BOARD_SOURCE } from "@research/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "@research/projections/store";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { dossierFactsFor } from "./dossier-facts";

/** SF plays every regular-season week except `byeWeek`; DAL plays every one — the same
 *  "one hole in the schedule" shape `nfl-schedule.test.ts` seeds `byeWeeksByTeam` with. */
async function seedByeWeek(db: Db, team: string, opponent: string, byeWeek: number): Promise<void> {
  const games = Array.from({ length: LEAGUE_CONFIG.regularSeasonWeeks }, (_, index) => index + 1)
    .filter((week) => week !== byeWeek)
    .map((week) => ({ gameId: `w${week}_${team}@${opponent}`, week, homeNflTeam: team, awayNflTeam: opponent, status: "scheduled" as const }));
  await db.insert(nflGames).values(games);
}

const PRIOR_SEASON = PRODUCT_SEASON - 1;
const BOARD_ASOF = new Date("2026-08-01T00:00:00Z");

async function seedPlayer(db: Db, input: { readonly id: string; readonly nflId: string; readonly name: string; readonly position: "RB" | "WR" | "QB"; readonly team: string; readonly points: number; readonly expectedGames: number; readonly rank: number; readonly adp: number | null }): Promise<void> {
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
    expectedGames: input.expectedGames,
    floorPoints: input.points - 20,
    medianPoints: input.points,
    ceilingPoints: input.points + 20,
    tier: 0,
    asOf: BOARD_ASOF,
    momentKind: "live",
  });
}

function priorSeasonWeek(gsisId: string, weekNumber: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(PRIOR_SEASON, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season: PRIOR_SEASON, week: weekNumber, playerId: gsisId, source: STAT_LINE_SOURCE, metric: statMetricName(field), value, asOf,
  }));
}

function participationRow(gsisId: string, weekNumber: number, source: string, metric: string, value: number): PlayerWeekObservation {
  return { season: PRIOR_SEASON, week: weekNumber, playerId: gsisId, source, metric, value, asOf: new Date(Date.UTC(PRIOR_SEASON, 10, 1)) };
}

describe("dossierFactsFor", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("returns null for a player the board never ranked", async () => {
    expect(await dossierFactsFor(db, "nobody")).toBeNull();
  });

  it("returns null for a product player the crosswalk never placed", async () => {
    await db.insert(players).values({ id: "p-ghost", name: "Ghost Player", position: "RB", nflTeam: "SF" });
    expect(await dossierFactsFor(db, "p-ghost")).toBeNull();
  });

  it("derives per-game points and ranks it among his position's board peers, with an honest qualifier count", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-8000001", name: "Heavy Volume", position: "RB", team: "SF", points: 240, expectedGames: 16, rank: 1, adp: 5 });
    await seedPlayer(db, { id: "p2", nflId: "00-8000002", name: "Light Volume", position: "RB", team: "DAL", points: 160, expectedGames: 16, rank: 2, adp: 20 });
    // A different position, present so a scoping bug that let cross-position rows leak into the
    // ranking population would be caught by a wrong qualifier count.
    await seedPlayer(db, { id: "p3", nflId: "00-8000003", name: "Other Position", position: "WR", team: "NYJ", points: 200, expectedGames: 16, rank: 3, adp: 15 });

    const facts = await dossierFactsFor(db, "p1");
    expect(facts).not.toBeNull();
    expect(facts!.projection.perGamePoints).toBe(15);
    expect(facts!.projection.perGamePositionRank).toEqual({ value: 15, positionRank: 1, qualifierCount: 2 });

    const peer = await dossierFactsFor(db, "p2");
    expect(peer!.projection.perGamePoints).toBe(10);
    expect(peer!.projection.perGamePositionRank).toEqual({ value: 10, positionRank: 2, qualifierCount: 2 });
  });

  it("states the honest scoring label", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-8100001", name: "Rashad Long", position: "RB", team: "SF", points: 200, expectedGames: 16, rank: 1, adp: 10 });
    const facts = await dossierFactsFor(db, "p1");
    expect(facts!.basis.scoringLabel).toBe("PPR");
  });

  it("states his team's real bye week, and null when the schedule store carries no hole for his team", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-8150001", name: "Rashad Long", position: "RB", team: "SF", points: 200, expectedGames: 16, rank: 1, adp: 10 });
    await seedByeWeek(db, "SF", "DAL", 9);
    expect((await dossierFactsFor(db, "p1"))!.byeWeek).toBe(9);

    await seedPlayer(db, { id: "p2", nflId: "00-8150002", name: "No Bye Yet", position: "RB", team: "NYG", points: 180, expectedGames: 16, rank: 2, adp: 20 });
    expect((await dossierFactsFor(db, "p2"))!.byeWeek).toBeNull();
  });

  it("carries a newsCount, not the headlines themselves", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-8200001", name: "Rashad Long", position: "RB", team: "SF", points: 200, expectedGames: 16, rank: 1, adp: 10 });
    const facts = await dossierFactsFor(db, "p1");
    expect(facts!.newsCount).toBe(0);
    expect((facts as unknown as { news?: unknown }).news).toBeUndefined();
  });

  it("carries a qualifier count on every color-fact rank it surfaces", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-8300001", name: "Volume Back", position: "RB", team: "SF", points: 240, expectedGames: 16, rank: 1, adp: 5 });
    await seedPlayer(db, { id: "p2", nflId: "00-8300002", name: "Middle Back", position: "RB", team: "DAL", points: 160, expectedGames: 16, rank: 2, adp: 20 });
    await recordObservations(db, [
      ...priorSeasonWeek("00-8300001", 1, { rushingYards: 200, carries: 20, receptions: 3, receivingYards: 30 }),
      participationRow("00-8300001", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.offensiveSnaps, 50),
      participationRow("00-8300001", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.teamOffensiveSnaps, 60),
      ...priorSeasonWeek("00-8300002", 1, { rushingYards: 50, carries: 10, receptions: 1, receivingYards: 5 }),
      participationRow("00-8300002", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.offensiveSnaps, 15),
      participationRow("00-8300002", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.teamOffensiveSnaps, 60),
    ]);

    const facts = (await dossierFactsFor(db, "p1"))!;
    expect(facts.lastSeasonStory).not.toBeNull();
    expect(facts.lastSeasonStory!.pointsRank.qualifierCount).toBe(2);
    expect(facts.lastSeasonStory!.receivingYardsRank.qualifierCount).toBe(2);
    expect(facts.usage).not.toBeNull();
    expect(facts.usage!.snapShareRank!.qualifierCount).toBe(2);
    expect(facts.projection.perGamePositionRank!.qualifierCount).toBe(2);
  });

  it("round-trips through JSON with no loss — a plain, serialization-safe shape", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-8400001", name: "Volume Back", position: "RB", team: "SF", points: 240, expectedGames: 16, rank: 1, adp: 5 });
    await seedPlayer(db, { id: "p2", nflId: "00-8400002", name: "Middle Back", position: "RB", team: "DAL", points: 160, expectedGames: 16, rank: 2, adp: 20 });
    await recordObservations(db, [
      ...priorSeasonWeek("00-8400001", 1, { rushingYards: 200, carries: 20, receptions: 3, receivingYards: 30 }),
      participationRow("00-8400001", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.offensiveSnaps, 50),
      participationRow("00-8400001", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.teamOffensiveSnaps, 60),
    ]);

    const facts = await dossierFactsFor(db, "p1");
    expect(facts).not.toBeNull();
    const roundTripped = JSON.parse(JSON.stringify(facts));
    expect(roundTripped).toEqual(facts);
  });
});
