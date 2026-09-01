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
import { schedulePublishedAsOf, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { recordObservations } from "../store";
import { recordPlayerTeams, recordTeamObservations } from "../team-store";
import { recordPreseasonRosters } from "../preseason/store";
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
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true);
    // (60+40) / (65+60) = 100/125 = 0.8, NOT the mean of (60/65=0.923) and (40/60=0.667).
    expect(facts.get("hub")!.current.snapShare).toBeCloseTo(0.8, 5);
  });

  it("snapShare is null with no snap-count evidence at all", async () => {
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true);
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
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true);
    expect(facts.get("hub")!.current.redZoneTouchShare).toBeCloseTo((4 + 1) / (15 + 5), 5);
    expect(facts.get("hub")!.current.targetDepth).toBeCloseTo(40 / 5, 5);
    // No play-by-play evidence at all for "quiet" -> null, never zero.
    expect(facts.get("quiet")!.current.redZoneTouchShare).toBeNull();
    expect(facts.get("quiet")!.current.targetDepth).toBeNull();
  });

  it("incomingCoachTenureSeasons is the raw count, and null with no team edge at all", async () => {
    await recordPlayerTeams(db, [{ season: N, week: 1, playerId: "hub", team: "KC", asOf: BEFORE_GATE }]);
    await storeCoachFacts([{ season: N1, week: 1, team: "KC", metric: COACH_METRICS.tenureSeasons, value: 0, asOf: GATE }]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true);
    expect(facts.get("hub")!.current.incomingCoachTenureSeasons).toBe(0);
    expect(facts.get("quiet")!.current.incomingCoachTenureSeasons).toBeNull();
  });

  it("experienceYear is season minus draftYear plus one, and null with no draft year on record", async () => {
    await recordPreseasonRosters(db, [
      { season: N, team: "KC", playerId: "hub", position: "RB", status: "active", birthDate: null, draftYear: 2020, draftPick: 30, draftClub: "KC", asOf: BEFORE_GATE },
    ]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true);
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
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true);
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
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true);
    expect(facts.get("hub")!.current.snapShare).toBeCloseTo(60 / 65, 5);
  });
});

describe("discoveryFactsForSeason — the prior-season half", () => {
  const players = [["vet", "RB"]] as const;

  it("prior is null when the player has no evidence at all for season N-1", async () => {
    await insertPlayers(players);
    await storeLines([line(N, 1, "vet", { rushingYards: 500, receptions: 20 }, BEFORE_GATE)]);
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true);
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
    const facts = await discoveryFactsForSeason(db, N, await positionsMap(players), PPR_SCORING, true);
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
    const facts = await discoveryFactsForSeason(db, N, positions, PPR_SCORING, true);
    expect(facts.has("kicker")).toBe(false);
    expect(facts.has("dline")).toBe(false);
    expect(facts.has("rb")).toBe(true);
  });
});
