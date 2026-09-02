import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { recordNflPlayers } from "../universe";
import type { NflPlayerRow } from "../nflverse/players";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { recordTeamObservations } from "../team-store";
import { BOARD_SOURCE, projectionRows, recordPreseasonProjections } from "../preseason/board-store";
import type { BoardEntry } from "../preseason/board";
import { BENCHMARK_SOURCES } from "../preseason/benchmarks";
import { recordPreseasonRankings } from "../preseason/store";
import { recordPropObservations, type PlayerPropObservation } from "../odds/props-store";
import { recordPropPlayerMap } from "../odds/player-map";
import { takeFreeze } from "./freeze";
import { freezeInstantsFor, freezeRowsAt, latestFreezeFor } from "./store";

/**
 * THE FREEZE IS THE WHOLE POINT OF THE REGISTER, so these tests are about the two properties that
 * make a frozen row evidence rather than a note: it was taken STRICTLY BEFORE the week could reveal
 * anything, and it was never touched again afterwards.
 */

const db = createTestDb();

const SEASON = 2026;
const WEEK_1_KICKOFF = new Date("2026-09-10T00:20:00.000Z");
const WEEK_2_KICKOFF = new Date("2026-09-18T00:15:00.000Z");
const BOARD_AS_OF = new Date("2026-09-02T03:20:39.210Z");

const CHASE = "00-0036900";
const LAMB = "00-0036322";
const HURTS = "00-0036389";

function clockAt(iso: string): Clock {
  return { now: () => iso };
}

function player(id: string, name: string, position: string): NflPlayerRow {
  return {
    id,
    pfrId: null,
    espnId: null,
    name,
    position,
    latestTeam: "CIN",
    rookieSeason: 2020,
    lastSeason: 2026,
  };
}

function entry(playerId: string, points: number, rank: number): BoardEntry {
  return {
    playerId,
    position: "WR",
    projectedPoints: points,
    valueOverReplacement: points - 100,
    positionRank: rank,
    replacementLevel: 100,
    rank,
    valueRank: rank,
    team: "CIN",
    expectedGames: 16.2,
    seasonLine: { playerId, week: 0 } as BoardEntry["seasonLine"],
    outlook: { floor: points - 40, median: points, ceiling: points + 40 },
    tier: 0,
    playersLeftInTier: 4,
    dropToNextTier: 18.3,
    reasons: [],
  };
}

async function seedUniverse(): Promise<void> {
  await recordNflPlayers(db, [
    player(CHASE, "Ja'Marr Chase", "WR"),
    player(LAMB, "CeeDee Lamb", "WR"),
    player(HURTS, "Jalen Hurts", "QB"),
  ]);
}

async function seedKickoffs(): Promise<void> {
  await recordTeamObservations(db, [
    {
      season: SEASON,
      week: 1,
      team: "CIN",
      source: SCHEDULE_SOURCE.kickoff,
      metric: SCHEDULE_METRICS.kickoffInstant,
      value: WEEK_1_KICKOFF.getTime(),
      asOf: WEEK_1_KICKOFF,
    },
    {
      season: SEASON,
      week: 2,
      team: "CIN",
      source: SCHEDULE_SOURCE.kickoff,
      metric: SCHEDULE_METRICS.kickoffInstant,
      value: WEEK_2_KICKOFF.getTime(),
      asOf: WEEK_2_KICKOFF,
    },
  ]);
}

async function seedBoard(): Promise<void> {
  await recordPreseasonProjections(
    db,
    projectionRows([entry(CHASE, 326.4, 1), entry(LAMB, 301.2, 2), entry(HURTS, 288.0, 3)], {
      season: SEASON,
      source: BOARD_SOURCE,
      asOf: BOARD_AS_OF,
      momentKind: "live",
    }),
  );
}

async function seedBenchmarks(): Promise<void> {
  const asOf = new Date("2026-09-01T00:00:00.000Z");
  await recordPreseasonRankings(db, [
    { season: SEASON, source: BENCHMARK_SOURCES.adp, playerId: CHASE, rank: 1.4, asOf },
    { season: SEASON, source: BENCHMARK_SOURCES.adp, playerId: LAMB, rank: 3.2, asOf },
    // HURTS has no ADP row at all — the tri-state's null arm.
    { season: SEASON, source: BENCHMARK_SOURCES.ecr, playerId: CHASE, rank: 2, asOf },
    { season: SEASON, source: BENCHMARK_SOURCES.ecr, playerId: HURTS, rank: 21, asOf },
  ]);
}

function prop(overrides: Partial<PlayerPropObservation>): PlayerPropObservation {
  return {
    eventId: "evt-week-1",
    commenceTime: new Date("2026-09-14T00:20:00.000Z"),
    bookmaker: "draftkings",
    market: "player_reception_yds",
    playerName: "Ja'Marr Chase",
    point: 70.5,
    overPrice: -115,
    underPrice: -105,
    fetchedAt: new Date("2026-09-08T09:00:00.000Z"),
    ...overrides,
  };
}

async function seedProps(): Promise<void> {
  await recordPropObservations(db, [
    // Three books on Chase's receiving yards: median is the middle one, 70.5.
    prop({ bookmaker: "draftkings", point: 60.5 }),
    prop({ bookmaker: "fanduel", point: 70.5 }),
    prop({ bookmaker: "betmgm", point: 80.5 }),
    // One book on Chase's receptions.
    prop({ bookmaker: "draftkings", market: "player_receptions", point: 5.5 }),
    // A WEEK 2 event, which a week 1 freeze must never see.
    prop({ eventId: "evt-week-2", commenceTime: new Date("2026-09-21T00:20:00.000Z"), playerName: "CeeDee Lamb", point: 88.5 }),
  ]);
  await recordPropPlayerMap(db, [
    { propName: "Ja'Marr Chase", season: SEASON, playerId: CHASE, method: "exact" },
    { propName: "CeeDee Lamb", season: SEASON, playerId: LAMB, method: "exact" },
  ]);
}

async function seedAll(): Promise<void> {
  await seedUniverse();
  await seedKickoffs();
  await seedBoard();
  await seedBenchmarks();
  await seedProps();
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("takeFreeze — the kickoff refusal", () => {
  it("refuses a freeze taken AT the week's first kickoff, to the millisecond", async () => {
    await seedAll();
    await expect(takeFreeze(db, { season: SEASON, week: 1 }, clockAt(WEEK_1_KICKOFF.toISOString()))).rejects.toThrow(
      /first kickoff/i,
    );
  });

  it("refuses a freeze taken after the week's first kickoff", async () => {
    await seedAll();
    await expect(
      takeFreeze(db, { season: SEASON, week: 1 }, clockAt(new Date(WEEK_1_KICKOFF.getTime() + 1).toISOString())),
    ).rejects.toThrow(/first kickoff/i);
  });

  it("accepts a freeze one millisecond before kickoff — strictly-before is the whole rule", async () => {
    await seedAll();
    const result = await takeFreeze(
      db,
      { season: SEASON, week: 1 },
      clockAt(new Date(WEEK_1_KICKOFF.getTime() - 1).toISOString()),
    );
    expect(result.frozenAt.getTime()).toBe(WEEK_1_KICKOFF.getTime() - 1);
    expect(result.rows).toHaveLength(3);
  });

  it("keys the refusal to THIS week's kickoff, not week one's — a week 2 freeze is fine after week 1 kicked off", async () => {
    await seedAll();
    const result = await takeFreeze(db, { season: SEASON, week: 2 }, clockAt("2026-09-15T12:00:00.000Z"));
    expect(result.kickoff.toISOString()).toBe(WEEK_2_KICKOFF.toISOString());
  });

  it("refuses when the store holds no kickoff for the week at all, rather than freezing blind", async () => {
    await seedUniverse();
    await seedBoard();
    await expect(takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"))).rejects.toThrow(
      /no ingested kickoff/i,
    );
  });

  it("refuses when the served board is empty, rather than writing an empty freeze", async () => {
    await seedUniverse();
    await seedKickoffs();
    await expect(takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"))).rejects.toThrow(
      /served board/i,
    );
  });
});

describe("takeFreeze — the board column reads what the product serves", () => {
  it("carries the served board's own points, ranks, source and stamp onto every row", async () => {
    await seedAll();
    const { rows, boardAsOf } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    expect(boardAsOf.toISOString()).toBe(BOARD_AS_OF.toISOString());
    const chase = rows.find((row) => row.playerId === CHASE);
    expect(chase?.boardSource).toBe(BOARD_SOURCE);
    expect(chase?.boardPoints).toBeCloseTo(326.4, 6);
    expect(chase?.boardRank).toBe(1);
    expect(chase?.boardAsOf.toISOString()).toBe(BOARD_AS_OF.toISOString());
  });

  it("writes no row under any board source but the served one", async () => {
    await seedAll();
    const { rows } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    expect(new Set(rows.map((row) => row.boardSource))).toEqual(new Set([BOARD_SOURCE]));
  });
});

describe("takeFreeze — the tri-state benchmark columns", () => {
  it("carries an ADP rank where the market has one and null where it does not, never zero", async () => {
    await seedAll();
    const { rows } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const byPlayer = new Map(rows.map((row) => [row.playerId, row]));
    expect(byPlayer.get(CHASE)?.adpRank).toBeCloseTo(1.4, 6);
    expect(byPlayer.get(LAMB)?.adpRank).toBeCloseTo(3.2, 6);
    expect(byPlayer.get(HURTS)?.adpRank).toBeNull();
  });

  it("carries an ECR rank where the panel has one and null where it does not, never zero", async () => {
    await seedAll();
    const { rows } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const byPlayer = new Map(rows.map((row) => [row.playerId, row]));
    expect(byPlayer.get(CHASE)?.ecrRank).toBe(2);
    expect(byPlayer.get(LAMB)?.ecrRank).toBeNull();
    expect(byPlayer.get(HURTS)?.ecrRank).toBe(21);
  });

  it("takes the week's props consensus as the MEDIAN line across books and prices it into points", async () => {
    await seedAll();
    const { rows } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const chase = rows.find((row) => row.playerId === CHASE);
    expect(chase?.propsMarkets).toEqual({ player_reception_yds: 70.5, player_receptions: 5.5 });
    // 70.5 receiving yards at 0.1 plus 5.5 receptions at 1.0 (PPR).
    expect(chase?.propsPoints).toBeCloseTo(12.55, 6);
  });

  it("leaves a player with no props THAT WEEK null rather than zero, even when he has props another week", async () => {
    await seedAll();
    const { rows } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const byPlayer = new Map(rows.map((row) => [row.playerId, row]));
    // Lamb's only archived line is a WEEK 2 event.
    expect(byPlayer.get(LAMB)?.propsPoints).toBeNull();
    expect(byPlayer.get(LAMB)?.propsMarkets).toBeNull();
    expect(byPlayer.get(HURTS)?.propsPoints).toBeNull();
  });

  it("cannot see a line fetched AFTER the freeze instant", async () => {
    await seedAll();
    await recordPropObservations(db, [
      prop({ bookmaker: "draftkings", point: 999.5, fetchedAt: new Date("2026-09-09T23:00:00.000Z") }),
    ]);
    const { rows } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const chase = rows.find((row) => row.playerId === CHASE);
    expect(chase?.propsMarkets).toEqual({ player_reception_yds: 70.5, player_receptions: 5.5 });
  });

  it("reports coverage counts per column so a freeze with a dead feed is visible, not silent", async () => {
    await seedAll();
    const { coverage } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    expect(coverage).toEqual({ board: 3, adp: 2, ecr: 2, props: 1 });
  });
});

describe("takeFreeze — the archive is immutable and append-only", () => {
  it("a second freeze in the same week is a NEW instant and leaves the first one's rows untouched", async () => {
    await seedAll();
    const first = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const second = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-09T12:00:00.000Z"));
    expect(second.frozenAt.getTime()).toBeGreaterThan(first.frozenAt.getTime());

    const instants = await freezeInstantsFor(db, SEASON, 1);
    expect(instants.map((instant) => instant.toISOString())).toEqual([
      first.frozenAt.toISOString(),
      second.frozenAt.toISOString(),
    ]);

    const firstRows = await freezeRowsAt(db, { season: SEASON, week: 1, frozenAt: first.frozenAt });
    expect(firstRows).toHaveLength(3);
    expect(firstRows.map((row) => row.playerId).sort()).toEqual([CHASE, LAMB, HURTS].sort());
  });

  it("a re-freeze after the board moved leaves the OLD freeze reading the old board", async () => {
    await seedAll();
    const first = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));

    // The served board is re-persisted at a later stamp with different points.
    const later = new Date("2026-09-08T18:00:00.000Z");
    await recordPreseasonProjections(
      db,
      projectionRows([entry(CHASE, 111.1, 3), entry(LAMB, 222.2, 1), entry(HURTS, 200.0, 2)], {
        season: SEASON,
        source: BOARD_SOURCE,
        asOf: later,
        momentKind: "live",
      }),
    );

    const second = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-09T12:00:00.000Z"));
    expect(second.rows.find((row) => row.playerId === CHASE)?.boardPoints).toBeCloseTo(111.1, 6);

    const firstRows = await freezeRowsAt(db, { season: SEASON, week: 1, frozenAt: first.frozenAt });
    expect(firstRows.find((row) => row.playerId === CHASE)?.boardPoints).toBeCloseTo(326.4, 6);
  });

  it("names the latest freeze for a week, which is what grading reaches for", async () => {
    await seedAll();
    await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const second = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-09T12:00:00.000Z"));
    const latest = await latestFreezeFor(db, SEASON, 1);
    expect(latest?.toISOString()).toBe(second.frozenAt.toISOString());
  });

  it("refuses a second freeze at the IDENTICAL instant rather than silently writing a second copy", async () => {
    await seedAll();
    const at = clockAt("2026-09-08T12:00:00.000Z");
    await takeFreeze(db, { season: SEASON, week: 1 }, at);
    await expect(takeFreeze(db, { season: SEASON, week: 1 }, at)).rejects.toThrow();
    const rows = await freezeRowsAt(db, { season: SEASON, week: 1, frozenAt: new Date("2026-09-08T12:00:00.000Z") });
    expect(rows).toHaveLength(3);
  });
});
