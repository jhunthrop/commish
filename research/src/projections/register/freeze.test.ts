import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research/db/test-db";
import type { Clock } from "@research/domain/timing";
import { recordNflPlayers } from "../universe";
import type { NflPlayerRow } from "../nflverse/players";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { recordTeamObservations } from "../team-store";
import { BOARD_SOURCE, BOARD_SOURCE_V7_SHADOW, projectionRows, recordPreseasonProjections, writePreseasonBoard } from "../preseason/board-store";
import type { BoardEntry } from "../preseason/board";
import { BENCHMARK_SOURCES } from "../preseason/benchmarks";
import { recordPreseasonRankings } from "../preseason/store";
import { recordPropObservations, type PlayerPropObservation } from "../odds/props-store";
import { recordPropPlayerMap } from "../odds/player-map";
import { takeFreeze } from "./freeze";
import { REGISTER_BOARD_SOURCES } from "./sources";
import { freezeBoardSourcesAt, freezeInstantsFor, freezeRowsAt, latestFreezeFor } from "./store";

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
const SHADOW_AS_OF = new Date("2026-09-01T11:00:00.000Z");

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

/** The shadow board: the same three players, priced DIFFERENTLY and stamped EARLIER, because those
 *  are the two ways a shadow actually differs from the served board in the store. */
async function seedShadowBoard(): Promise<void> {
  await recordPreseasonProjections(
    db,
    projectionRows([entry(CHASE, 300.1, 2), entry(LAMB, 310.9, 1), entry(HURTS, 250.0, 3)], {
      season: SEASON,
      source: BOARD_SOURCE_V7_SHADOW,
      asOf: SHADOW_AS_OF,
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
    const { rows, served } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    expect(served.boardAsOf?.toISOString()).toBe(BOARD_AS_OF.toISOString());
    const chase = rows.find((row) => row.playerId === CHASE);
    expect(chase?.boardSource).toBe(BOARD_SOURCE);
    expect(chase?.boardPoints).toBeCloseTo(326.4, 6);
    expect(chase?.boardRank).toBe(1);
    expect(chase?.boardAsOf.toISOString()).toBe(BOARD_AS_OF.toISOString());
  });

  it("writes no row under a board source the register does not track", async () => {
    await seedAll();
    await recordPreseasonProjections(
      db,
      projectionRows([entry(CHASE, 1.0, 1)], { season: SEASON, source: "some_untracked_board_ppr_12", asOf: BOARD_AS_OF, momentKind: "live" }),
    );
    const { rows } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    // Only the served board has rows in this fixture; the shadow is empty, and the untracked board
    // is not consulted at all.
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
    const { served } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    expect(served.coverage).toEqual({ board: 3, adp: 2, ecr: 2, props: 1 });
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

    // The served board moves the way it does in production: `writePreseasonBoard`'s live arm
    // retires the stored generation and writes the new one in one transaction. (A raw
    // `recordPreseasonProjections` here would leave two live generations, which the freeze's
    // `assertSingleGeneration` loud read now refuses by design.)
    const later = new Date("2026-09-08T18:00:00.000Z");
    await writePreseasonBoard(
      db,
      { season: SEASON, source: BOARD_SOURCE, asOf: later, momentKind: "live" },
      [entry(CHASE, 111.1, 3), entry(LAMB, 222.2, 1), entry(HURTS, 200.0, 2)],
    );

    const second = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-09T12:00:00.000Z"));
    expect(second.rows.find((row) => row.playerId === CHASE)?.boardPoints).toBeCloseTo(111.1, 6);

    const firstRows = await freezeRowsAt(db, { season: SEASON, week: 1, frozenAt: first.frozenAt });
    expect(firstRows.find((row) => row.playerId === CHASE)?.boardPoints).toBeCloseTo(326.4, 6);
  });

  it("refuses to freeze a stitched board: two live generations under one source fail loud", async () => {
    await seedAll();
    // A raw append that never retired its predecessor: the shape a partial-retire regression
    // would leave behind. The freeze must refuse to bake it into immutable history.
    await recordPreseasonProjections(
      db,
      projectionRows([entry(CHASE, 111.1, 3)], {
        season: SEASON,
        source: BOARD_SOURCE,
        asOf: new Date("2026-09-08T18:00:00.000Z"),
        momentKind: "live",
      }),
    );
    await expect(takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-09T12:00:00.000Z"))).rejects.toThrow(
      /distinct as_of generations/,
    );
    expect(await freezeInstantsFor(db, SEASON, 1)).toEqual([]);
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

/**
 * THE DUAL TRACK (Round D). The register records the SERVED board and every SHADOW at one instant,
 * so 2026 answers head-to-head a comparison the fit round could not make without spending its
 * held-out season. These tests are about the three properties that make the comparison mean
 * anything: both boards are read at the SAME moment, each keeps its OWN stamp and numbers, and the
 * served board is load-bearing in a way a shadow is not.
 */
describe("takeFreeze — the dual track", () => {
  it("records EVERY tracked board at one instant, the served one and the shadow alike", async () => {
    await seedAll();
    await seedShadowBoard();
    const result = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));

    expect(result.boards.map((board) => board.source)).toEqual(REGISTER_BOARD_SOURCES.map((tracked) => tracked.source));
    expect(result.boards.map((board) => board.role)).toEqual(["served", "shadow"]);
    expect(result.rows).toHaveLength(6);
    expect(new Set(result.rows.map((row) => row.frozenAt.toISOString()))).toEqual(
      new Set(["2026-09-08T12:00:00.000Z"]),
    );
    expect(await freezeBoardSourcesAt(db, { season: SEASON, week: 1, frozenAt: result.frozenAt })).toEqual(
      [BOARD_SOURCE_V7_SHADOW, BOARD_SOURCE].sort(),
    );
  });

  it("keeps each board's OWN points, ranks and stamp — a shadow is read, never recomputed", async () => {
    await seedAll();
    await seedShadowBoard();
    const { boards } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const [servedBoard, shadow] = boards;

    expect(servedBoard!.boardAsOf?.toISOString()).toBe(BOARD_AS_OF.toISOString());
    expect(shadow!.boardAsOf?.toISOString()).toBe(SHADOW_AS_OF.toISOString());

    const servedChase = servedBoard!.rows.find((row) => row.playerId === CHASE);
    const shadowChase = shadow!.rows.find((row) => row.playerId === CHASE);
    expect(servedChase?.boardPoints).toBeCloseTo(326.4, 6);
    expect(servedChase?.boardRank).toBe(1);
    expect(shadowChase?.boardPoints).toBeCloseTo(300.1, 6);
    expect(shadowChase?.boardRank).toBe(2);
  });

  it("gives both boards the SAME three benchmarks, because they are the same three opinions", async () => {
    await seedAll();
    await seedShadowBoard();
    const { boards } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    for (const board of boards) {
      const chase = board.rows.find((row) => row.playerId === CHASE);
      expect(chase?.adpRank).toBeCloseTo(1.4, 6);
      expect(chase?.ecrRank).toBe(2);
      expect(chase?.propsPoints).toBeCloseTo(12.55, 6);
      expect(board.coverage).toEqual({ board: 3, adp: 2, ecr: 2, props: 1 });
    }
  });

  it("stores one player TWICE at one instant, which only board_source tells apart", async () => {
    await seedAll();
    await seedShadowBoard();
    const result = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const key = { season: SEASON, week: 1, frozenAt: result.frozenAt };

    const chaseRows = (await freezeRowsAt(db, key)).filter((row) => row.playerId === CHASE);
    expect(chaseRows).toHaveLength(2);
    expect(chaseRows.map((row) => row.boardSource).sort()).toEqual([BOARD_SOURCE_V7_SHADOW, BOARD_SOURCE].sort());

    // And a reader that means ONE board says so, rather than getting both and hoping.
    expect(await freezeRowsAt(db, key, BOARD_SOURCE)).toHaveLength(3);
    expect(await freezeRowsAt(db, key, BOARD_SOURCE_V7_SHADOW)).toHaveLength(3);
  });

  it("an EMPTY SHADOW is reported and the freeze proceeds — a diagnostic track cannot cost the week", async () => {
    await seedAll();
    const result = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    const shadow = result.boards.find((board) => board.role === "shadow");
    expect(shadow?.rows).toHaveLength(0);
    expect(shadow?.boardAsOf).toBeNull();
    expect(shadow?.coverage).toEqual({ board: 0, adp: 0, ecr: 0, props: 0 });
    expect(result.rows).toHaveLength(3);
  });

  it("an EMPTY SERVED BOARD still refuses, even when the shadow is full", async () => {
    await seedUniverse();
    await seedKickoffs();
    await seedBenchmarks();
    await seedShadowBoard();
    await expect(takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"))).rejects.toThrow(
      /served board/i,
    );
    // And it refuses BEFORE writing: the shadow's rows must not survive a refused freeze.
    expect(await freezeInstantsFor(db, SEASON, 1)).toEqual([]);
  });

  it("cannot see a shadow generation persisted AFTER the freeze instant", async () => {
    await seedAll();
    await recordPreseasonProjections(
      db,
      projectionRows([entry(CHASE, 999.9, 1)], {
        season: SEASON,
        source: BOARD_SOURCE_V7_SHADOW,
        asOf: new Date("2026-09-09T00:00:00.000Z"),
        momentKind: "live",
      }),
    );
    const { boards } = await takeFreeze(db, { season: SEASON, week: 1 }, clockAt("2026-09-08T12:00:00.000Z"));
    expect(boards.find((board) => board.role === "shadow")?.rows).toHaveLength(0);
  });
});
