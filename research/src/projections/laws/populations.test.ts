import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research/db/test-db";
import { nflPlayers } from "@research/db/schema";
import { STAT_FIELDS, type StatLine } from "@research/domain/player";
import { statLineObservations } from "../nflverse/stat-lines";
import type { SeasonStatLine } from "../lines";
import { STAT_LINE_SOURCE } from "../lines";
import { PARTICIPATION_METRICS } from "../nflverse/map";
import { COACH_METRICS } from "../nflverse/coaches";
import { schedulePublishedAsOf, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { recordObservations } from "../store";
import { recordPlayerTeams, recordTeamObservations } from "../team-store";
import { recordPreseasonRosters } from "../preseason/store";
import { buildPopulations, canonicalPointOrder, LAW_SPECS } from "./populations";
import { matchedPairsStratified, measureEffect } from "./harness";
import type { PlayerSeasonPoint } from "./types";

/**
 * DB-BACKED FIXTURES FOR THE SIX LAW POPULATIONS, following `backtest.test.ts`'s style: one test
 * database, `truncateAll` between tests, hand-built rows stamped at the exact moments that matter.
 *
 * Season N is 2023, season N+1 is 2024, and `GATE` is the as-of every builder reads season N
 * through — `schedulePublishedAsOf(2024)`. Every "does not leak" test adds a fact that is either
 * about the wrong season or stamped after `GATE`, and asserts the population's `condition` is
 * unmoved — the same proof `backtest.test.ts` runs for a late stat correction. Every "drops from
 * both pools" test seeds a player with a real StatLine but NO evidence for one law's antecedent,
 * and asserts he is entirely ABSENT from that law's population — never present with `condition: false`.
 */

const db = createTestDb();

const N = 2023;
const N1 = 2024;
const GATE = schedulePublishedAsOf(N1);
const BEFORE_GATE = new Date("2023-09-01T00:00:00.000Z");
const AFTER_GATE = new Date("2024-06-01T00:00:00.000Z");

function specFor(id: string) {
  const spec = LAW_SPECS.find((entry) => entry.id === id);
  if (spec === undefined) throw new Error(`No LawSpec registered for ${id}`);
  return spec;
}

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

/** All-zero weeks — a player who "played" but recorded nothing, so `games` still counts them. */
function fillerWeeks(season: number, playerId: string, weeks: readonly number[], asOf: Date): readonly SeasonStatLine[] {
  return weeks.map((week) => line(season, week, playerId, {}, asOf));
}

async function storeLines(lines: readonly SeasonStatLine[]): Promise<void> {
  await recordObservations(db, statLineObservations(lines));
}

interface ParticipationRow {
  readonly season: number;
  readonly week: number;
  readonly playerId: string;
  readonly metric: string;
  readonly value: number;
  readonly asOf: Date;
}

async function storeParticipation(rows: readonly ParticipationRow[]): Promise<void> {
  await recordObservations(db, rows.map((row) => ({ ...row, source: STAT_LINE_SOURCE })));
}

interface CoachRow {
  readonly season: number;
  readonly week: number;
  readonly team: string;
  readonly metric: string;
  readonly value: number;
  readonly asOf: Date;
}

async function storeCoachFacts(rows: readonly CoachRow[]): Promise<void> {
  await recordTeamObservations(db, rows.map((row) => ({ ...row, source: SCHEDULE_SOURCE.schedule })));
}

async function insertPlayers(entries: readonly (readonly [string, string])[]): Promise<void> {
  await db.insert(nflPlayers).values(
    entries.map(([id, position]) => ({ id, pfrId: id, name: id, position, latestTeam: null, rookieSeason: 2015, lastSeason: 2026 })),
  );
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("rb_workload_cliff", () => {
  const spec = specFor("rb_workload_cliff");

  beforeEach(async () => {
    await insertPlayers([
      ["heavy", "RB"],
      ["light", "RB"],
    ]);
    await storeLines([
      line(N, 1, "heavy", { rushingYards: 1000, receivingYards: 200, receptions: 60 }, BEFORE_GATE),
      line(N, 1, "light", { rushingYards: 400, receivingYards: 100, receptions: 50 }, BEFORE_GATE),
    ]);
    await storeParticipation([
      { season: N, week: 1, playerId: "heavy", metric: PARTICIPATION_METRICS.carries, value: 250, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "light", metric: PARTICIPATION_METRICS.carries, value: 100, asOf: BEFORE_GATE },
    ]);
  });

  it("flags 300+ combined carries and receptions, and computes PPR points/game", async () => {
    const points = await spec.population(db, [N]);
    const heavy = points.find((p) => p.playerId === "heavy")!;
    const light = points.find((p) => p.playerId === "light")!;

    // heavy: 250 carries + 60 receptions = 310 touches.
    expect(heavy.condition).toBe(true);
    expect(heavy.pointsPerGame).toBe(180); // 1000*0.1 + 200*0.1 + 60*1
    expect(heavy.matchKey).toBe(180);
    expect(heavy.position).toBe("RB");

    // light: 100 carries + 50 receptions = 150 touches.
    expect(light.condition).toBe(false);
    expect(light.pointsPerGame).toBe(100); // 400*0.1 + 100*0.1 + 50*1
  });

  it("does not let a late season-N correction, nor any season-N+1 fact, flip the condition", async () => {
    // A "correction" that would push light over 300 touches, filed AFTER the gate.
    await storeParticipation([{ season: N, week: 1, playerId: "light", metric: PARTICIPATION_METRICS.carries, value: 500, asOf: AFTER_GATE }]);
    // A season-N+1 fact entirely — wrong season, must never be read as season-N history.
    await storeParticipation([{ season: N1, week: 1, playerId: "light", metric: PARTICIPATION_METRICS.carries, value: 500, asOf: BEFORE_GATE }]);

    const points = await spec.population(db, [N]);
    const light = points.find((p) => p.playerId === "light")!;
    expect(light.condition).toBe(false);
  });

  it("drops a player with no participation row entirely — unknown touches, never zero touches", async () => {
    await insertPlayers([["noCarries", "RB"]]);
    await storeLines([line(N, 1, "noCarries", { rushingYards: 100, receptions: 5 }, BEFORE_GATE)]);
    // No carries observation recorded for "noCarries" at all — not even a zero.
    const points = await spec.population(db, [N]);
    expect(points.some((p) => p.playerId === "noCarries")).toBe(false);
  });
});

describe("rb_age_curve", () => {
  const spec = specFor("rb_age_curve");

  beforeEach(async () => {
    await insertPlayers([
      ["veteran", "RB"],
      ["young", "RB"],
    ]);
    await storeLines([
      line(N, 1, "veteran", { rushingYards: 100, receptions: 5 }, BEFORE_GATE),
      line(N, 1, "young", { rushingYards: 100, receptions: 5 }, BEFORE_GATE),
    ]);
    const cutdown = new Date("2023-08-25T00:00:00.000Z");
    await recordPreseasonRosters(db, [
      { season: N, team: "KC", playerId: "veteran", position: "RB", status: "active", birthDate: "1994-08-01", draftYear: 2016, draftPick: 50, draftClub: "KC", asOf: cutdown },
      { season: N, team: "BUF", playerId: "young", position: "RB", status: "active", birthDate: "2000-06-01", draftYear: 2022, draftPick: 80, draftClub: "BUF", asOf: cutdown },
    ]);
  });

  it("flags 28+ at the season opener", async () => {
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "veteran")!.condition).toBe(true);
    expect(points.find((p) => p.playerId === "young")!.condition).toBe(false);
  });

  it("ignores a birth-date row filed after the gate", async () => {
    // A bogus correction claiming young is actually old, filed after the gate — must be invisible.
    await recordPreseasonRosters(db, [
      { season: N, team: "BUF", playerId: "young", position: "RB", status: "active", birthDate: "1990-01-01", draftYear: 2022, draftPick: 80, draftClub: "BUF", asOf: AFTER_GATE },
    ]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "young")!.condition).toBe(false);
  });

  it("drops a player with no roster row entirely — unknown age, never a false condition", async () => {
    await insertPlayers([["noRoster", "RB"]]);
    await storeLines([line(N, 1, "noRoster", { rushingYards: 100, receptions: 5 }, BEFORE_GATE)]);
    // No preseason roster row for "noRoster" at all — no birth date is knowable.
    const points = await spec.population(db, [N]);
    expect(points.some((p) => p.playerId === "noRoster")).toBe(false);
  });
});

describe("wr_target_competition", () => {
  const spec = specFor("wr_target_competition");

  beforeEach(async () => {
    await insertPlayers([
      ["wr1", "WR"],
      ["wr2", "WR"],
      ["te1", "TE"],
    ]);
    await recordPlayerTeams(db, [
      { season: N, week: 1, playerId: "wr1", team: "KC", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wr2", team: "KC", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "te1", team: "KC", asOf: BEFORE_GATE },
    ]);
    await storeParticipation([
      { season: N, week: 1, playerId: "wr1", metric: PARTICIPATION_METRICS.targets, value: 100, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wr1", metric: PARTICIPATION_METRICS.teamTargets, value: 150, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wr2", metric: PARTICIPATION_METRICS.targets, value: 20, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wr2", metric: PARTICIPATION_METRICS.teamTargets, value: 150, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "te1", metric: PARTICIPATION_METRICS.targets, value: 10, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "te1", metric: PARTICIPATION_METRICS.teamTargets, value: 150, asOf: BEFORE_GATE },
    ]);
    await storeLines([
      line(N, 1, "wr1", { receivingYards: 800, receptions: 100 }, BEFORE_GATE),
      line(N, 1, "wr2", { receivingYards: 200, receptions: 20 }, BEFORE_GATE),
    ]);
  });

  it("flags a receiver whose WR/TE teammate has an individual share >= 20% and >= his own", async () => {
    // Own shares: wr1 100/150=66.7%, wr2 20/150=13.3%, te1 10/150=6.7%.
    // wr1's best teammate share is 13.3% (wr2) — never clears 20%. wr2's best teammate share is
    // 66.7% (wr1) — clears 20% and exceeds wr2's own 13.3%.
    const points = await spec.population(db, [N]);
    const wr1 = points.find((p) => p.playerId === "wr1")!;
    const wr2 = points.find((p) => p.playerId === "wr2")!;
    expect(wr1.condition).toBe(false);
    expect(wr1.pointsPerGame).toBe(180); // 800*0.1 + 100*1
    expect(wr2.condition).toBe(true);
    expect(wr2.pointsPerGame).toBe(40); // 200*0.1 + 20*1
    // TE is not part of the WR population itself.
    expect(points.some((p) => p.playerId === "te1")).toBe(false);
  });

  it("does not let a late-filed teammate target correction flip the condition", async () => {
    // A correction that would make te1 wr1's dominant teammate, filed after the gate.
    await storeParticipation([{ season: N, week: 1, playerId: "te1", metric: PARTICIPATION_METRICS.targets, value: 300, asOf: AFTER_GATE }]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wr1")!.condition).toBe(false);
  });

  it("drops a player with no team edge entirely — unknown teammates, never a false condition", async () => {
    await insertPlayers([["noTeam", "WR"]]);
    await storeLines([line(N, 1, "noTeam", { receivingYards: 100, receptions: 10 }, BEFORE_GATE)]);
    // No recordPlayerTeams row for "noTeam" at all.
    const points = await spec.population(db, [N]);
    expect(points.some((p) => p.playerId === "noTeam")).toBe(false);
  });

  it("groups teammates week by week, not by a single season-final team, when a player is traded", async () => {
    await insertPlayers([
      ["traded", "WR"],
      ["wrSFteammate", "WR"],
    ]);
    await recordPlayerTeams(db, [
      { season: N, week: 1, playerId: "traded", team: "SF", asOf: BEFORE_GATE },
      { season: N, week: 2, playerId: "traded", team: "SF", asOf: BEFORE_GATE },
      { season: N, week: 3, playerId: "traded", team: "DAL", asOf: BEFORE_GATE },
      { season: N, week: 4, playerId: "traded", team: "DAL", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrSFteammate", team: "SF", asOf: BEFORE_GATE },
      { season: N, week: 2, playerId: "wrSFteammate", team: "SF", asOf: BEFORE_GATE },
    ]);
    await storeParticipation(
      [1, 2, 3, 4].flatMap((week) => [
        { season: N, week, playerId: "traded", metric: PARTICIPATION_METRICS.targets, value: 30, asOf: BEFORE_GATE },
        { season: N, week, playerId: "traded", metric: PARTICIPATION_METRICS.teamTargets, value: 100, asOf: BEFORE_GATE },
      ]),
    );
    await storeParticipation(
      [1, 2].flatMap((week) => [
        { season: N, week, playerId: "wrSFteammate", metric: PARTICIPATION_METRICS.targets, value: 5, asOf: BEFORE_GATE },
        { season: N, week, playerId: "wrSFteammate", metric: PARTICIPATION_METRICS.teamTargets, value: 100, asOf: BEFORE_GATE },
      ]),
    );
    await storeLines([
      line(N, 1, "traded", { receivingYards: 100, receptions: 10 }, BEFORE_GATE),
      line(N, 1, "wrSFteammate", { receivingYards: 50, receptions: 5 }, BEFORE_GATE),
    ]);

    const points = await spec.population(db, [N]);
    const wrSFteammate = points.find((p) => p.playerId === "wrSFteammate")!;
    // traded's SEASON share (SF weeks 1-2 plus DAL weeks 3-4) is 120/400 = 30%, reachable as
    // wrSFteammate's teammate only if grouping is done week by week (both on SF in weeks 1-2) —
    // a single season-final-team grouping (DAL) would lose him as a teammate entirely.
    expect(wrSFteammate.condition).toBe(true);
  });
});

describe("play_caller_fingerprint", () => {
  const spec = specFor("play_caller_fingerprint");

  beforeEach(async () => {
    await insertPlayers([
      ["wrKC", "WR"],
      ["teKC", "TE"],
      ["wrBUF", "WR"],
      ["wrNYJ", "WR"],
    ]);
    await recordPlayerTeams(db, [
      { season: N, week: 1, playerId: "wrKC", team: "KC", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "teKC", team: "KC", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrBUF", team: "BUF", asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrNYJ", team: "NYJ", asOf: BEFORE_GATE },
    ]);
    await storeLines([
      line(N, 1, "wrKC", { receivingYards: 100, receptions: 10 }, BEFORE_GATE),
      line(N, 1, "teKC", { receivingYards: 80, receptions: 8 }, BEFORE_GATE),
      line(N, 1, "wrBUF", { receivingYards: 100, receptions: 10 }, BEFORE_GATE),
      line(N, 1, "wrNYJ", { receivingYards: 100, receptions: 10 }, BEFORE_GATE),
    ]);
    await storeCoachFacts([
      { season: N1, week: 1, team: "KC", metric: COACH_METRICS.tenureSeasons, value: 0, asOf: GATE },
      { season: N1, week: 1, team: "KC", metric: COACH_METRICS.priorPassRateOverExpected, value: 0.05, asOf: GATE },
      { season: N1, week: 1, team: "BUF", metric: COACH_METRICS.tenureSeasons, value: 3, asOf: GATE },
      { season: N1, week: 1, team: "NYJ", metric: COACH_METRICS.tenureSeasons, value: 0, asOf: GATE },
      { season: N1, week: 1, team: "NYJ", metric: COACH_METRICS.priorPassRateOverExpected, value: -0.02, asOf: GATE },
    ]);
  });

  it("flags WR/TE on a team with a first-year play-caller whose own history skews pass-heavy", async () => {
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wrKC")!.condition).toBe(true);
    expect(points.find((p) => p.playerId === "teKC")!.condition).toBe(true);
    expect(points.find((p) => p.playerId === "wrBUF")!.condition).toBe(false); // tenure 3, not new
    expect(points.find((p) => p.playerId === "wrNYJ")!.condition).toBe(false); // new, but PROE negative
  });

  it("does not let a coach fact stamped after the gate flip the condition", async () => {
    await storeCoachFacts([
      { season: N1, week: 1, team: "BUF", metric: COACH_METRICS.tenureSeasons, value: 0, asOf: AFTER_GATE },
      { season: N1, week: 1, team: "BUF", metric: COACH_METRICS.priorPassRateOverExpected, value: 0.9, asOf: AFTER_GATE },
    ]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wrBUF")!.condition).toBe(false);
  });

  it("drops a player whose team has no coach facts at all — unknown, never a false condition", async () => {
    await insertPlayers([["wrMIA", "WR"]]);
    await recordPlayerTeams(db, [{ season: N, week: 1, playerId: "wrMIA", team: "MIA", asOf: BEFORE_GATE }]);
    await storeLines([line(N, 1, "wrMIA", { receivingYards: 100, receptions: 10 }, BEFORE_GATE)]);
    // No coachObservations rows for MIA's season-N+1 at all.
    const points = await spec.population(db, [N]);
    expect(points.some((p) => p.playerId === "wrMIA")).toBe(false);
  });
});

describe("target_share_persistence", () => {
  const spec = specFor("target_share_persistence");

  beforeEach(async () => {
    await insertPlayers([
      ["wrHigh", "WR"],
      ["wrLow", "WR"],
    ]);
    await storeLines([
      line(N, 1, "wrHigh", { receivingYards: 400, receptions: 40 }, BEFORE_GATE),
      line(N, 1, "wrLow", { receivingYards: 200, receptions: 20 }, BEFORE_GATE),
    ]);
    await storeParticipation([
      { season: N, week: 1, playerId: "wrHigh", metric: PARTICIPATION_METRICS.targets, value: 40, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrHigh", metric: PARTICIPATION_METRICS.teamTargets, value: 150, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrLow", metric: PARTICIPATION_METRICS.targets, value: 20, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "wrLow", metric: PARTICIPATION_METRICS.teamTargets, value: 150, asOf: BEFORE_GATE },
    ]);
  });

  it("flags a season-N target share of 24% or more", async () => {
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wrHigh")!.condition).toBe(true); // 40/150 = 26.7%
    expect(points.find((p) => p.playerId === "wrLow")!.condition).toBe(false); // 20/150 = 13.3%
  });

  it("does not let a late-filed target correction flip the condition", async () => {
    await storeParticipation([{ season: N, week: 1, playerId: "wrLow", metric: PARTICIPATION_METRICS.targets, value: 50, asOf: AFTER_GATE }]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "wrLow")!.condition).toBe(false);
  });
});

describe("td_regression", () => {
  const spec = specFor("td_regression");

  beforeEach(async () => {
    await insertPlayers([
      ["rbA", "RB"],
      ["rbB", "RB"],
      ["rbC", "RB"],
    ]);
    // Each gets 8 games (the median's regulars floor) — week 1 carries the real stats, weeks 2-8
    // are scoreless fillers, so games/shares match the pre-fix single-week fixture exactly.
    await storeLines([
      // Shares: 6/60=0.10, 12/80=0.15, 36/72=0.50 — median 0.15, threshold 1.5*0.15=0.225.
      line(N, 1, "rbA", { rushingYards: 540, rushingTouchdowns: 1 }, BEFORE_GATE),
      ...fillerWeeks(N, "rbA", [2, 3, 4, 5, 6, 7, 8], BEFORE_GATE),
      line(N, 1, "rbB", { rushingYards: 680, rushingTouchdowns: 2 }, BEFORE_GATE),
      ...fillerWeeks(N, "rbB", [2, 3, 4, 5, 6, 7, 8], BEFORE_GATE),
      line(N, 1, "rbC", { rushingYards: 360, rushingTouchdowns: 6 }, BEFORE_GATE),
      ...fillerWeeks(N, "rbC", [2, 3, 4, 5, 6, 7, 8], BEFORE_GATE),
    ]);
  });

  it("flags a touchdown-points share at least 1.5x the position-season median among regulars", async () => {
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "rbA")!.condition).toBe(false);
    expect(points.find((p) => p.playerId === "rbB")!.condition).toBe(false);
    expect(points.find((p) => p.playerId === "rbC")!.condition).toBe(true);
  });

  it("does not let a season-N+1 touchdown fact flip the season-N condition", async () => {
    await storeLines([line(N1, 1, "rbA", { rushingYards: 100, rushingTouchdowns: 10 }, BEFORE_GATE)]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "rbA")!.condition).toBe(false);
  });

  it("excludes a sub-8-game player-season from the median, so a one-game flare-up cannot swing it", async () => {
    // A one-game player with a huge share would drag the median up if counted; it must not be.
    await insertPlayers([["oneGameFlash", "RB"]]);
    await storeLines([line(N, 1, "oneGameFlash", { rushingYards: 10, rushingTouchdowns: 5 }, BEFORE_GATE)]);
    const points = await spec.population(db, [N]);
    // rbC's verdict is unchanged by oneGameFlash's presence — the threshold still comes from rbA/rbB/rbC alone.
    expect(points.find((p) => p.playerId === "rbC")!.condition).toBe(true);
    expect(points.find((p) => p.playerId === "rbA")!.condition).toBe(false);
  });
});

describe("season-N+1 actuals — the deliberately ungated read", () => {
  const spec = specFor("rb_workload_cliff");

  it("yields the exact next-season points/game for a seeded N+1 line", async () => {
    await insertPlayers([["player", "RB"]]);
    await storeLines([
      line(N, 1, "player", { rushingYards: 1000, receptions: 60 }, BEFORE_GATE),
      line(N1, 1, "player", { rushingYards: 200, receptions: 10 }, BEFORE_GATE), // 20 + 10 = 30
    ]);
    await storeParticipation([{ season: N, week: 1, playerId: "player", metric: PARTICIPATION_METRICS.carries, value: 10, asOf: BEFORE_GATE }]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "player")!.nextPointsPerGame).toBe(30);
  });

  it("gives null for a player absent from season N+1 entirely", async () => {
    await insertPlayers([["gone", "RB"]]);
    await storeLines([line(N, 1, "gone", { rushingYards: 100, receptions: 5 }, BEFORE_GATE)]);
    await storeParticipation([{ season: N, week: 1, playerId: "gone", metric: PARTICIPATION_METRICS.carries, value: 10, asOf: BEFORE_GATE }]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "gone")!.nextPointsPerGame).toBeNull();
  });

  it("includes a late-filed N+1 correction — the actuals read is deliberately ungated", async () => {
    await insertPlayers([["corrected", "RB"]]);
    await storeLines([
      line(N, 1, "corrected", { rushingYards: 100, receptions: 5 }, BEFORE_GATE),
      // Filed AFTER the season-N gate — irrelevant here, since actuals are read at FINAL_OUTCOME.
      line(N1, 1, "corrected", { rushingYards: 100, receptions: 5 }, AFTER_GATE),
    ]);
    await storeParticipation([{ season: N, week: 1, playerId: "corrected", metric: PARTICIPATION_METRICS.carries, value: 10, asOf: BEFORE_GATE }]);
    const points = await spec.population(db, [N]);
    expect(points.find((p) => p.playerId === "corrected")!.nextPointsPerGame).toBe(15); // 10 + 5
  });

  it("computes each season's points/game as the correct per-game quotient over a multi-week season", async () => {
    await insertPlayers([["multiWeek", "RB"]]);
    await storeLines([
      // Season N: 3 weeks, 30 points total => 10.0 ppg, not 30.
      line(N, 1, "multiWeek", { rushingYards: 100 }, BEFORE_GATE),
      line(N, 2, "multiWeek", { rushingYards: 100 }, BEFORE_GATE),
      line(N, 3, "multiWeek", { rushingYards: 100 }, BEFORE_GATE),
      // Season N+1: 1 week, 40 points => 40.0 ppg, not divided by season N's 3 games.
      line(N1, 1, "multiWeek", { rushingYards: 400 }, BEFORE_GATE),
    ]);
    await storeParticipation([{ season: N, week: 1, playerId: "multiWeek", metric: PARTICIPATION_METRICS.carries, value: 10, asOf: BEFORE_GATE }]);
    const points = await spec.population(db, [N]);
    const found = points.find((p) => p.playerId === "multiWeek")!;
    expect(found.pointsPerGame).toBe(10); // (10 + 10 + 10) / 3
    expect(found.nextPointsPerGame).toBe(40); // 40 / 1
  });
});

describe("buildPopulations", () => {
  it("computes every law's population in one shared pass, matching each law's own population()", async () => {
    await insertPlayers([
      ["heavy", "RB"],
      ["light", "RB"],
    ]);
    await storeLines([
      line(N, 1, "heavy", { rushingYards: 1000, receivingYards: 200, receptions: 60 }, BEFORE_GATE),
      line(N, 1, "light", { rushingYards: 400, receivingYards: 100, receptions: 50 }, BEFORE_GATE),
    ]);
    await storeParticipation([
      { season: N, week: 1, playerId: "heavy", metric: PARTICIPATION_METRICS.carries, value: 250, asOf: BEFORE_GATE },
      { season: N, week: 1, playerId: "light", metric: PARTICIPATION_METRICS.carries, value: 100, asOf: BEFORE_GATE },
    ]);

    const batch = await buildPopulations(db, [N]);
    const solo = await specFor("rb_workload_cliff").population(db, [N]);
    expect(batch.get("rb_workload_cliff")).toEqual(solo);
    expect([...batch.keys()].sort()).toEqual(LAW_SPECS.map((entry) => entry.id).sort());
  });

  it("returns every law's population pre-sorted by (season, position, playerId), regardless of DB/insertion order", async () => {
    // Player ids and insertion order are deliberately reverse-canonical, so a pass proves the
    // OUTPUT order is IMPOSED by canonicalPointOrder rather than merely inherited from insertion
    // order — an un-ORDER-BYed Postgres select makes no promise it preserves insertion order at all.
    await insertPlayers([
      ["zRB", "RB"],
      ["aRB", "RB"],
      ["zWR", "WR"],
      ["aWR", "WR"],
    ]);
    await storeLines([
      line(N1, 1, "zRB", { rushingYards: 100 }, BEFORE_GATE),
      line(N1, 1, "aRB", { rushingYards: 90 }, BEFORE_GATE),
      line(N, 1, "zWR", { receivingYards: 80, receptions: 8 }, BEFORE_GATE),
      line(N, 1, "aWR", { receivingYards: 70, receptions: 7 }, BEFORE_GATE),
    ]);
    await storeParticipation([
      { season: N1, week: 1, playerId: "zRB", metric: PARTICIPATION_METRICS.carries, value: 10, asOf: BEFORE_GATE },
      { season: N1, week: 1, playerId: "aRB", metric: PARTICIPATION_METRICS.carries, value: 10, asOf: BEFORE_GATE },
    ]);

    const populations = await buildPopulations(db, [N, N1]);
    for (const points of populations.values()) {
      for (let i = 1; i < points.length; i += 1) {
        expect(canonicalPointOrder(points[i - 1]!, points[i]!)).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe("determinism anchor — canonicalPointOrder", () => {
  function fixturePoint(over: Partial<PlayerSeasonPoint>): PlayerSeasonPoint {
    return { playerId: "p", season: 2020, position: "RB", pointsPerGame: 10, nextPointsPerGame: 8, matchKey: 10, condition: true, ...over };
  }

  // ONE stratum, two conditions TIED on matchKey, and only ONE control inside the caliper of
  // either — `matchedPairs`'s greedy loop is a stable sort on matchKey followed by first-claims-it
  // nearest-neighbor assignment, so a tie is broken by ARRAY ORDER alone: whichever condition
  // appears first in the input claims the one reachable control, and the other is dropped for lack
  // of an alternative. c1's own year-over-year change (-5) and c2's (-1) are deliberately far
  // apart, so which one wins swings the measured effect hard rather than by some fragile bootstrap
  // coincidence — this is a genuinely different SET of matched pairs, not just a reordering of an
  // identical one.
  const c1 = fixturePoint({ playerId: "b1", matchKey: 10, pointsPerGame: 10, nextPointsPerGame: 5, condition: true }); // change -5
  const c2 = fixturePoint({ playerId: "b2", matchKey: 10, pointsPerGame: 10, nextPointsPerGame: 9, condition: true }); // change -1
  const control = fixturePoint({ playerId: "a1", matchKey: 10.3, pointsPerGame: 10.3, nextPointsPerGame: 8.3, condition: false }); // change -2

  // Canonical (season, position, playerId) order: "a1" < "b1" < "b2".
  const canonicalOrderPoints: readonly PlayerSeasonPoint[] = [control, c1, c2];
  // The same three rows, with c2 placed ahead of c1 — a fixed, deterministic reordering an
  // un-ORDER-BYed Postgres select is free to produce with no data change at all.
  const shuffledOrderPoints: readonly PlayerSeasonPoint[] = [c2, control, c1];

  const KEY_OF = (point: PlayerSeasonPoint): string => String(point.season);
  const CALIPER = 1;

  function measure(points: readonly PlayerSeasonPoint[]) {
    return measureEffect(matchedPairsStratified(points, CALIPER, KEY_OF));
  }

  it("without the canonical sort, reordering the SAME rows changes which pair matches — and the measured effect — the bug this anchor fixes", () => {
    // Canonical order processes c1 first (playerId "b1" < "b2"): c1 claims the only control, c2 is
    // dropped. effect = change(c1) - change(control) = -5 - (-2) = -3.
    const fromCanonicalOrder = measure(canonicalOrderPoints);
    expect(fromCanonicalOrder.effect).toBe(-3);
    expect(fromCanonicalOrder.sample).toBe(1);

    // Shuffled order processes c2 first: c2 claims the only control, c1 is dropped instead.
    // effect = change(c2) - change(control) = -1 - (-2) = 1 — the SIGN itself flips.
    const fromShuffledOrder = measure(shuffledOrderPoints);
    expect(fromShuffledOrder.effect).toBe(1);
    expect(fromShuffledOrder.sample).toBe(1);

    expect(fromShuffledOrder.effect).not.toBe(fromCanonicalOrder.effect);
  });

  it("with the canonical sort applied first, sorted-in and shuffled-in populations measure byte-identically", () => {
    const sortedFromCanonical = [...canonicalOrderPoints].sort(canonicalPointOrder);
    const sortedFromShuffled = [...shuffledOrderPoints].sort(canonicalPointOrder);
    // The sort itself collapses both input orders to the same array — the guarantee `buildPopulations` relies on.
    expect(sortedFromShuffled).toEqual(sortedFromCanonical);

    expect(measure(sortedFromShuffled)).toEqual(measure(sortedFromCanonical));
  });
});
