import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import { STAT_FIELDS, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { statLineObservations } from "../nflverse/stat-lines";
import type { SeasonStatLine } from "../lines";
import { NFLVERSE_SOURCE, PARTICIPATION_METRICS } from "../nflverse/map";
import { PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "../nflverse/pbp-players";
import { PBP_METRICS, PBP_SOURCE } from "../nflverse/pbp";
import { COACH_METRICS } from "../nflverse/coaches";
import { schedulePublishedAsOf, SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { recordObservations } from "../store";
import { recordPlayerTeams, recordTeamObservations } from "../team-store";
import { recordPreseasonRosters } from "../preseason/store";
import { VEGAS_METRICS, VEGAS_SOURCE } from "../vegas/ingest";
import { discoveryFactsForSeason } from "./discovery-facts";

/**
 * DB-BACKED FIXTURES FOR `discoveryFactsForSeason` — same style as `populations.test.ts`: one test
 * database, `truncateAll` between tests, hand-built rows stamped at the exact moments that matter.
 * Covers the quantities `factsForSeason` did not already surface (`snapShare`, `redZoneTouchShare`,
 * `targetDepth`, `incomingCoachTenureSeasons`, `experienceYear`, `teamPaceSecondsPerPlay`), plus the
 * `current`/`prior` two-season wiring the delta template needs. The quantities `factsForSeason`
 * already covers (`touches`, `age`, `targetShare`, `touchdownPointsShare`,
 * `incomingCoachPriorPassRateOverExpected`) are exercised there and are only spot-checked here.
 */

const db = createTestDb();

const N = 2023;
const N1 = 2024;
const GATE = schedulePublishedAsOf(N1);
const BEFORE_GATE = new Date("2023-09-01T00:00:00.000Z");
const AFTER_GATE = new Date("2024-06-01T00:00:00.000Z");
/** The moment season N+1's PRESEASON was knowable — the gate the win-total read alone runs through
 *  (`discoveryFactsForSeason`'s `incomingAsOf`). Late August of N+1 here, which is where a real
 *  preseason moment for that season lands and which is deliberately LATER than `GATE`. */
const INCOMING_GATE = new Date("2024-08-25T00:00:00.000Z");
const AFTER_INCOMING_GATE = new Date("2024-09-15T00:00:00.000Z");
/** Where a real win total lands: August of the season it prices, months after `GATE`. */
const VEGAS_STAMP = new Date("2024-08-15T00:00:00.000Z");

function line(season: number, week: number, playerId: string, over: Partial<StatLine>, asOf: Date): SeasonStatLine {
  return {
    season,
    asOf,
    line: {
      playerId,
      week,
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
      ...over,
    },
  };
}

async function storeLines(lines: readonly SeasonStatLine[]): Promise<void> {
  await recordObservations(db, statLineObservations(lines));
}

interface ObservationRow {
  readonly season: number;
  readonly week: number;
  readonly playerId: string;
  readonly metric: string;
  readonly value: number;
  readonly asOf: Date;
}

async function storeSnapCounts(rows: readonly ObservationRow[]): Promise<void> {
  await recordObservations(db, rows.map((row) => ({ ...row, source: NFLVERSE_SOURCE.snapCounts })));
}

async function storePbpPlayerFacts(rows: readonly ObservationRow[]): Promise<void> {
  await recordObservations(db, rows.map((row) => ({ ...row, source: PBP_PLAYER_SOURCE })));
}

interface TeamRow {
  readonly season: number;
  readonly week: number;
  readonly team: string;
  readonly metric: string;
  readonly value: number;
  readonly asOf: Date;
}

async function storeCoachFacts(rows: readonly TeamRow[]): Promise<void> {
  await recordTeamObservations(db, rows.map((row) => ({ ...row, source: SCHEDULE_SOURCE.schedule })));
}

async function storePbpTeamFacts(rows: readonly TeamRow[]): Promise<void> {
  await recordTeamObservations(db, rows.map((row) => ({ ...row, source: PBP_SOURCE })));
}

/** One team-season's published win total, at week one — the row shape `vegas/ingest.ts` writes. */
async function storeWinTotal(season: number, team: string, value: number, asOf: Date): Promise<void> {
  await recordTeamObservations(db, [{ season, week: 1, team, source: VEGAS_SOURCE, metric: VEGAS_METRICS.winTotal, value, asOf }]);
}

/** One team's season of game results, one row per week from week one — a win 1, a tie 0.5, a loss 0,
 *  stamped inside season N and under the kickoff (game-derived) source, exactly as
 *  `scheduleObservations` writes them. */
async function storeGameResults(team: string, results: readonly number[]): Promise<void> {
  await recordTeamObservations(
    db,
    results.map((value, index) => ({
      season: N,
      week: index + 1,
      team,
      source: SCHEDULE_SOURCE.kickoff,
      metric: SCHEDULE_METRICS.gameResult,
      value,
      asOf: BEFORE_GATE,
    })),
  );
}

async function insertPlayers(entries: readonly (readonly [string, string])[]): Promise<void> {
  await db.insert(nflPlayers).values(
    entries.map(([id, position]) => ({ id, pfrId: id, name: id, position, latestTeam: null, rookieSeason: 2015, lastSeason: 2026 })),
  );
}

async function positionsMap(entries: readonly (readonly [string, string])[]): Promise<Map<string, "QB" | "RB" | "WR" | "TE">> {
  return new Map(entries.map(([id, position]) => [id, position as "QB" | "RB" | "WR" | "TE"]));
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("discoveryFactsForSeason — new quantities, tri-state", () => {
  const players = [["hub", "RB"], ["quiet", "RB"]] as const;

  beforeEach(async () => {
    await insertPlayers(players);
    await storeLines([
      line(N, 1, "hub", { rushingYards: 800, receivingYards: 100, receptions: 20 }, BEFORE_GATE),
      line(N, 1, "quiet", { rushingYards: 300, receivingYards: 50, receptions: 10 }, BEFORE_GATE),
    ]);
  });

  it("snapShare is a ratio of season sums, not a mean of weekly shares", async () => {
    await storeSnapCounts([
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.offensiveSnaps, value: 60, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 65, asOf: BEFORE_GATE },
      { season: N, week: 2, playerId: "hub", metric: PARTICIPATION_METRICS.offensiveSnaps, value: 40, asOf: BEFORE_GATE },
      { season: N, week: 2, playerId: "hub", metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 60, asOf: BEFORE_GATE },
    ]);
    await storeLines([line(N, 2, "hub", {}, BEFORE_GATE)]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    // (60+40) / (65+60) = 100/125 = 0.8, NOT the mean of (60/65=0.923) and (40/60=0.667).
    expect(facts.get("hub")!.current.snapShare).toBeCloseTo(0.8, 5);
  });

  it("snapShare is null with no snap-count evidence at all", async () => {
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.snapShare).toBeNull();
  });

  it("redZoneTouchShare and targetDepth read the play-by-play's own counts, not the box score's", async () => {
    // `usageAsOf` (the shared reader underneath both `usage.ts` and this aggregate) emits a
    // player-week row only when the snap-count file has a team denominator for it — see
    // `usage.ts`'s own "a row without the snap denominator is not a usable week" comment. The
    // play-by-play touches group rides on that same row, so it needs this minimal snap-count fact
    // even though this test does not otherwise care about snapShare.
    await storeSnapCounts([
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.offensiveSnaps, value: 50, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 65, asOf: BEFORE_GATE },
    ]);
    await storePbpPlayerFacts([
      { season: N, week: 1, playerId: "hub", metric: PBP_PLAYER_METRICS.carries, value: 15, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PBP_PLAYER_METRICS.targets, value: 5, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PBP_PLAYER_METRICS.redZoneCarries, value: 4, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PBP_PLAYER_METRICS.redZoneTargets, value: 1, asOf: BEFORE_GATE },
      // The inside-ten pair is written too, because the ingestion writes all eight members of the
      // group for every tally it emits and `usageAsOf` now THROWS on a partial one rather than
      // reading a missing member as a zero (final fix round, M1). A fixture that seeded six of eight
      // was standing in for a store shape that does not exist.
      { season: N, week: 1, playerId: "hub", metric: PBP_PLAYER_METRICS.insideTenCarries, value: 2, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PBP_PLAYER_METRICS.insideTenTargets, value: 0, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PBP_PLAYER_METRICS.airYards, value: 40, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PBP_PLAYER_METRICS.airYardTargets, value: 5, asOf: BEFORE_GATE },
    ]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.redZoneTouchShare).toBeCloseTo((4 + 1) / (15 + 5), 5);
    expect(facts.get("hub")!.current.targetDepth).toBeCloseTo(40 / 5, 5);
    // No play-by-play evidence at all for "quiet" -> null, never zero.
    expect(facts.get("quiet")!.current.redZoneTouchShare).toBeNull();
    expect(facts.get("quiet")!.current.targetDepth).toBeNull();
  });

  it("incomingCoachTenureSeasons is the raw count, and null with no team edge at all", async () => {
    await recordPlayerTeams(db, [{ season: N, week: 1, playerId: "hub", team: "KC", asOf: BEFORE_GATE }]);
    await storeCoachFacts([{ season: N1, week: 1, team: "KC", metric: COACH_METRICS.tenureSeasons, value: 0, asOf: GATE }]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.incomingCoachTenureSeasons).toBe(0);
    expect(facts.get("quiet")!.current.incomingCoachTenureSeasons).toBeNull();
  });

  it("experienceYear is season minus draftYear plus one, and null with no draft year on record", async () => {
    await recordPreseasonRosters(db, [
      { season: N, team: "KC", playerId: "hub", position: "RB", status: "active", birthDate: null, draftYear: 2020, draftPick: 30, draftClub: "KC", asOf: BEFORE_GATE },
    ]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.experienceYear).toBe(N - 2020 + 1);
    expect(facts.get("quiet")!.current.experienceYear).toBeNull();
  });

  it("teamPaceSecondsPerPlay is the team's own season mean, and null with no team edge at all", async () => {
    await recordPlayerTeams(db, [{ season: N, week: 1, playerId: "hub", team: "KC", asOf: BEFORE_GATE }]);
    await storePbpTeamFacts([
      { season: N, week: 1, team: "KC", metric: PBP_METRICS.paceSecondsPerPlay, value: 30, asOf: BEFORE_GATE },
      { season: N, week: 2, team: "KC", metric: PBP_METRICS.paceSecondsPerPlay, value: 28, asOf: BEFORE_GATE },
    ]);
    await storeLines([line(N, 2, "hub", {}, BEFORE_GATE)]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.teamPaceSecondsPerPlay).toBeCloseTo(29, 5);
    expect(facts.get("quiet")!.current.teamPaceSecondsPerPlay).toBeNull();
  });

  it("does not leak a fact stamped after the gate", async () => {
    await storeSnapCounts([
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.offensiveSnaps, value: 60, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 65, asOf: BEFORE_GATE },
      // A late correction, stamped AFTER the gate this replay reads through — must not move the answer.
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.offensiveSnaps, value: 65, asOf: AFTER_GATE },
    ]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.snapShare).toBeCloseTo(60 / 65, 5);
  });
});

/**
 * THE TWO TEAM-MARKET QUANTITIES (Task 3). Everything here turns on the gate: the win total is
 * published in AUGUST of the season it prices, months after `schedulePublishedAsOf(N+1)`, so a read
 * on the ordinary gate returns nothing for every team in every season and BOTH quantities would be
 * silently null everywhere. `incomingAsOf` is what makes them readable, and the last test in this
 * block is the one that would have caught the bug.
 */
/**
 * TASK 2's VOCABULARY ADDITIONS (the discovery-expansion plan) — four new quantities plus the
 * production conditional. Every one is computed from a read this module already performed, so these
 * tests are about the arithmetic and the tri-state rule, never about a new store path.
 */
describe("discoveryFactsForSeason — the Task 2 quantities", () => {
  const players = [["hub", "RB"], ["mate", "WR"], ["quiet", "RB"]] as const;

  /** The eight-member play-by-play touch group, written in full: `usageAsOf` throws on a partial one. */
  function touchGroup(
    playerId: string,
    over: Partial<Record<keyof typeof PBP_PLAYER_METRICS, number>>,
  ): readonly ObservationRow[] {
    const counts: Record<string, number> = {
      carries: 0, targets: 0, redZoneCarries: 0, redZoneTargets: 0,
      insideTenCarries: 0, insideTenTargets: 0, airYards: 0, airYardTargets: 0,
      ...over,
    };
    return Object.entries(PBP_PLAYER_METRICS).map(([key, metric]) => ({
      season: N, week: 1, playerId, metric, value: counts[key]!, asOf: BEFORE_GATE,
    }));
  }

  beforeEach(async () => {
    await insertPlayers(players);
    await storeLines([
      line(N, 1, "hub", { rushingYards: 800, receivingYards: 100, receptions: 20 }, BEFORE_GATE),
      line(N, 1, "mate", { receivingYards: 600, receptions: 40 }, BEFORE_GATE),
      line(N, 1, "quiet", { rushingYards: 300, receivingYards: 50, receptions: 10 }, BEFORE_GATE),
    ]);
    await storeSnapCounts([
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.offensiveSnaps, value: 50, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 65, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "mate", metric: PARTICIPATION_METRICS.offensiveSnaps, value: 55, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "mate", metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 65, asOf: BEFORE_GATE },
    ]);
  });

  it("insideTenTouchShare divides the tighter band by the SAME denominator redZoneTouchShare uses", async () => {
    await storePbpPlayerFacts(
      touchGroup("hub", { carries: 15, targets: 5, redZoneCarries: 4, redZoneTargets: 1, insideTenCarries: 2, insideTenTargets: 1 }),
    );
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    const current = facts.get("hub")!.current;
    expect(current.insideTenTouchShare).toBeCloseTo((2 + 1) / (15 + 5), 5);
    expect(current.redZoneTouchShare).toBeCloseTo((4 + 1) / (15 + 5), 5);
    // Strictly the tighter band: never larger than the twenty-yard version it sits inside.
    expect(current.insideTenTouchShare!).toBeLessThanOrEqual(current.redZoneTouchShare!);
  });

  it("insideTenTouchShare is null with no play-by-play evidence, never a zero share", async () => {
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.insideTenTouchShare).toBeNull();
  });

  it("insideTenTouchShare is a real ZERO where the play-by-play saw him and he never reached the ten", async () => {
    await storePbpPlayerFacts(touchGroup("hub", { carries: 12, targets: 3, redZoneCarries: 1, redZoneTargets: 0 }));
    expect((await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE)).get("hub")!.current.insideTenTouchShare).toBe(0);
  });

  it("teamAirYardsShare divides one man's air yards by his team's own, summed over the teammates the store can place", async () => {
    await recordPlayerTeams(db, [
      { season: N, week: 1, playerId: "hub", team: "KC", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "mate", team: "KC", asOf: BEFORE_GATE },
    ]);
    await storePbpPlayerFacts([
      ...touchGroup("hub", { carries: 15, targets: 5, airYards: 30, airYardTargets: 5 }),
      ...touchGroup("mate", { targets: 10, airYards: 90, airYardTargets: 10 }),
    ]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.teamAirYardsShare).toBeCloseTo(30 / 120, 5);
    expect(facts.get("mate")!.current.teamAirYardsShare).toBeCloseTo(90 / 120, 5);
  });

  it("teamAirYardsShare is null with no team edge, with no play-by-play evidence, and on a non-positive team total", async () => {
    await storePbpPlayerFacts(touchGroup("hub", { carries: 15, targets: 5, airYards: 30, airYardTargets: 5 }));
    // "hub" has evidence but no team edge; "quiet" has neither.
    let facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.teamAirYardsShare).toBeNull();
    expect(facts.get("quiet")!.current.teamAirYardsShare).toBeNull();

    // A team whose only placeable receiver ran everything behind the line: a share of a non-positive
    // total is not a share, and reporting one would invert the quantity's meaning.
    await truncateAll(db);
    await insertPlayers(players);
    await storeLines([line(N, 1, "hub", { rushingYards: 800, receptions: 20 }, BEFORE_GATE)]);
    await storeSnapCounts([
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.offensiveSnaps, value: 50, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "hub", metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 65, asOf: BEFORE_GATE },
    ]);
    await recordPlayerTeams(db, [{ season: N, week: 1, playerId: "hub", team: "KC", asOf: BEFORE_GATE }]);
    await storePbpPlayerFacts(touchGroup("hub", { carries: 10, targets: 4, airYards: -6, airYardTargets: 4 }));
    facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.teamAirYardsShare).toBeNull();
  });

  it("gamesPlayed counts the weeks he was scored in, and pointsPerGame is that same season's points over it", async () => {
    await storeLines([line(N, 2, "hub", { rushingYards: 100, receptions: 4 }, BEFORE_GATE)]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.gamesPlayed).toBe(2);
    expect(facts.get("quiet")!.current.gamesPlayed).toBe(1);
    // 300 rushing yards + 50 receiving + 10 receptions, PPR, over one game.
    expect(facts.get("quiet")!.current.pointsPerGame).toBeCloseTo(300 / 10 + 50 / 10 + 10, 5);
  });

  it("pointsPerGame is never null on a row that exists at all — a row is only built for a scorable season", async () => {
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    for (const entry of facts.values()) {
      expect(entry.current.pointsPerGame).not.toBeNull();
      expect(entry.current.gamesPlayed).not.toBeNull();
    }
  });

  it("draftPick is the roster row's own overall pick, and null for an undrafted player", async () => {
    await recordPreseasonRosters(db, [
      { season: N, team: "KC", playerId: "hub", position: "RB", status: "active", birthDate: null, draftYear: 2020, draftPick: 30, draftClub: "KC", asOf: BEFORE_GATE },
      { season: N, team: "KC", playerId: "quiet", position: "RB", status: "active", birthDate: null, draftYear: 2021, draftPick: null, draftClub: null, asOf: BEFORE_GATE },
    ]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.draftPick).toBe(30);
    expect(facts.get("quiet")!.current.draftPick).toBeNull();
    // No roster row at all is the same answer as an undrafted one, for the same reason `age` and
    // `experienceYear` are null there: the backfill does not reach that season.
    expect(facts.get("mate")!.current.draftPick).toBeNull();
  });

  it("carries every new quantity into the PRIOR half too, so the crossing templates have both seasons", async () => {
    await storeLines([line(N - 1, 1, "hub", { rushingYards: 200, receptions: 5 }, BEFORE_GATE)]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    const prior = facts.get("hub")!.prior;
    expect(prior).not.toBeNull();
    expect(prior!.gamesPlayed).toBe(1);
    expect(prior!.pointsPerGame).toBeCloseTo(200 / 10 + 5, 5);
  });
});

describe("discoveryFactsForSeason — incoming team win total and its delta", () => {
  const players = [["hub", "RB"], ["quiet", "RB"]] as const;

  beforeEach(async () => {
    await insertPlayers(players);
    await storeLines([
      line(N, 1, "hub", { rushingYards: 800, receptions: 20 }, BEFORE_GATE),
      line(N, 1, "quiet", { rushingYards: 300, receptions: 10 }, BEFORE_GATE),
    ]);
    await recordPlayerTeams(db, [{ season: N, week: 1, playerId: "hub", team: "KC", asOf: BEFORE_GATE }]);
  });

  it("reads season N+1's own published line, for the team the player finished season N with", async () => {
    await storeWinTotal(N1, "KC", 11.5, VEGAS_STAMP);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.incomingTeamWinTotal).toBe(11.5);
    // No team edge at all -> unknown, never a league-average line.
    expect(facts.get("quiet")!.current.incomingTeamWinTotal).toBeNull();
  });

  it("is null for a team-season the store holds no line for, rather than a default", async () => {
    await storeWinTotal(N1, "BUF", 10.5, VEGAS_STAMP);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.incomingTeamWinTotal).toBeNull();
  });

  it("subtracts the store's own schedule-derived record, counting a tie as half a win", async () => {
    await storeWinTotal(N1, "KC", 11.5, VEGAS_STAMP);
    // Seventeen results, the full complement for a 2023 regular season: eleven wins, one tie.
    await storeGameResults("KC", [...Array(11).fill(1), 0.5, ...Array(5).fill(0)] as readonly number[]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.incomingTeamWinTotalDelta).toBeCloseTo(11.5 - 11.5, 10);
  });

  it("is negative when the market prices a collapse, which is the case this quantity exists for", async () => {
    await storeWinTotal(N1, "KC", 7.5, VEGAS_STAMP);
    await storeGameResults("KC", [...Array(13).fill(1), ...Array(4).fill(0)] as readonly number[]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.incomingTeamWinTotalDelta).toBeCloseTo(7.5 - 13, 10);
  });

  it("leaves the delta null on a season whose record is not fully in the store, never a partial total", async () => {
    await storeWinTotal(N1, "KC", 11.5, VEGAS_STAMP);
    await storeGameResults("KC", [1, 1, 1]); // three games of seventeen
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.incomingTeamWinTotal).toBe(11.5); // the line half is still known
    expect(facts.get("hub")!.current.incomingTeamWinTotalDelta).toBeNull();
  });

  it("leaves the delta null when the line is missing but the record is known", async () => {
    await storeGameResults("KC", [...Array(11).fill(1), ...Array(6).fill(0)] as readonly number[]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("hub")!.current.incomingTeamWinTotalDelta).toBeNull();
  });

  /**
   * THE FIRING-COUNT TRAP, as a test. A win total stamped in August of N+1 sits AFTER
   * `schedulePublishedAsOf(N+1)`, so reading it on the gate the rest of this module uses returns
   * nothing — for every team, in every season, silently. This proves the separate `incomingAsOf` is
   * load-bearing rather than decorative, and that it still refuses a line stamped after itself.
   */
  it("is invisible on the May gate and visible on the preseason gate, and refuses anything later", async () => {
    await storeWinTotal(N1, "KC", 11.5, VEGAS_STAMP);
    const onTheMayGate = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, GATE);
    expect(onTheMayGate.get("hub")!.current.incomingTeamWinTotal).toBeNull();

    const onThePreseasonGate = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(onThePreseasonGate.get("hub")!.current.incomingTeamWinTotal).toBe(11.5);

    await storeWinTotal(N1, "SF", 12.5, AFTER_INCOMING_GATE);
    await recordPlayerTeams(db, [{ season: N, week: 2, playerId: "quiet", team: "SF", asOf: BEFORE_GATE }]);
    await storeLines([line(N, 2, "quiet", {}, BEFORE_GATE)]);
    const stillGated = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(stillGated.get("quiet")!.current.incomingTeamWinTotal).toBeNull();
  });
});

describe("discoveryFactsForSeason — the prior-season half", () => {
  const players = [["vet", "RB"]] as const;

  it("prior is null when the player has no evidence at all for season N-1", async () => {
    await insertPlayers(players);
    await storeLines([line(N, 1, "vet", { rushingYards: 500, receptions: 20 }, BEFORE_GATE)]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("vet")!.prior).toBeNull();
  });

  it("prior carries season N-1's own values, read through the same current-season gate", async () => {
    await insertPlayers(players);
    await storeLines([
      line(N, 1, "vet", { rushingYards: 500, receptions: 20 }, BEFORE_GATE),
      line(N - 1, 1, "vet", { rushingYards: 300, receptions: 10 }, new Date("2022-09-01T00:00:00.000Z")),
    ]);
    await storeSnapCounts([
      { season: N - 1, week: 1, playerId: "vet", metric: PARTICIPATION_METRICS.offensiveSnaps, value: 30, asOf: new Date("2022-09-01T00:00:00.000Z") },
      { season: N - 1, week: 1, playerId: "vet", metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 60, asOf: new Date("2022-09-01T00:00:00.000Z") },
    ]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true, INCOMING_GATE);
    expect(facts.get("vet")!.prior).not.toBeNull();
    expect(facts.get("vet")!.prior!.snapShare).toBeCloseTo(0.5, 5);
    expect(facts.get("vet")!.current.snapShare).toBeNull(); // no season-N snap evidence stored above
  });
});

describe("discoveryFactsForSeason — position scope", () => {
  it("excludes K and DEF, the same as factsForSeason's own consumers", async () => {
    await insertPlayers([["kicker", "K"], ["dline", "DEF"], ["rb", "RB"]]);
    await storeLines([
      line(N, 1, "kicker", {}, BEFORE_GATE),
      line(N, 1, "dline", {}, BEFORE_GATE),
      line(N, 1, "rb", { rushingYards: 100, receptions: 5 }, BEFORE_GATE),
    ]);
    const positions = new Map<string, "QB" | "RB" | "WR" | "TE" | "K" | "DEF">([
      ["kicker", "K"],
      ["dline", "DEF"],
      ["rb", "RB"],
    ]);
    const facts = await discoveryFactsForSeason(db, N, positions, PPR_SCORING, true, INCOMING_GATE);
    expect(facts.has("kicker")).toBe(false);
    expect(facts.has("dline")).toBe(false);
    expect(facts.has("rb")).toBe(true);
  });
});
