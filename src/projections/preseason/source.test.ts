import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflverseInjuries, nflverseRosterWeeks } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { recordNflPlayers } from "../universe";
import { PARTICIPATION_METRICS, NFLVERSE_SOURCE } from "../nflverse/map";
import { week1RosterAsOf } from "../nflverse/rosters";
import { STAT_LINE_SOURCE, statMetricName } from "../lines";
import { DERIVED_STAT_LINE_SOURCE } from "../nflverse/derived-stat-lines";
import { PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "../nflverse/pbp-players";
import { predictRates } from "../model/efficiency";
import { recordObservations, type PlayerWeekObservation } from "../store";
import { BENCHMARK_SOURCES } from "./benchmarks";
import { recordPreseasonRankings, recordPreseasonRosters } from "./store";
import { recordPlayerTeams, recordTeamObservations, type PlayerWeekTeam, type TeamWeekObservation } from "../team-store";
import { VEGAS_METRICS, VEGAS_SOURCE } from "../vegas/ingest";
import { lawReasonsFor } from "../laws/board-reasons";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { DEPTH_METRIC, DEPTH_SOURCE } from "./depth";
import { INJURY_METRICS, INJURY_SOURCE } from "../news/retrieve";
import { FITTED_MODEL } from "../model/source";
import type { Law } from "../laws/types";
import { blendBoard, seasonPointsOf, shippedPreseasonCandidates, type BlendConstants } from "../market/blend";
import type { MarketPriorEntry } from "../market/curve";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "./fitted";
import {
  ALL_PRESEASON_FEATURES,
  liveMomentFor,
  loadPreseason,
  preseasonCandidates,
  preseasonMomentFor,
  replayMomentFor,
  rookieSegmentFor,
  SHIPPED_PRESEASON_FEATURES,
  type BoardMoment,
  type PreseasonPriors,
} from "./source";

/**
 * STRICT WEEK-ZERO DISCIPLINE, TESTED THE ONLY WAY IT CAN BE.
 *
 * This is the leakage rule at its most dangerous, because offseason data is messy and dates are
 * easy to lose. A leak here would not fail anything — it would simply make a backtested board look
 * brilliant, and every number the phase published would be a lie nobody could see.
 *
 * So the load-bearing test is the structural one model v1 relies on, moved to the preseason: a
 * board is IDENTICAL before and after the season it predicts is written into the store with wildly
 * different numbers. A model that reads the season it is predicting cannot pass it, and no unit
 * test of any individual function would notice.
 */
const db = createTestDb();

const PRIORS: PreseasonPriors = {
  model: FITTED_MODEL,
  availability: FITTED_AVAILABILITY_PRIORS,
  rookies: FITTED_ROOKIE_PRIORS,
  depth: FITTED_DEPTH_PRIORS,
  career: FITTED_CAREER_PRIORS,
};

const VETERAN = "00-0000001";
const ROOKIE = "00-0000002";
const PRIOR_SEASON_LANDED = new Date("2024-01-08T00:00:00.000Z");
const TARGET_SEASON_LANDED = new Date("2024-09-10T00:00:00.000Z");

function observation(overrides: Partial<PlayerWeekObservation> & Pick<PlayerWeekObservation, "metric" | "value">): PlayerWeekObservation {
  return {
    season: 2023,
    week: 1,
    playerId: VETERAN,
    source: NFLVERSE_SOURCE.snapCounts,
    asOf: PRIOR_SEASON_LANDED,
    ...overrides,
  };
}

/** One player-week of usage plus the outcome that goes with it, which layer 2 needs to see together. */
function playerWeek(season: number, week: number, playerId: string, asOf: Date, scale: number): readonly PlayerWeekObservation[] {
  const usage: readonly [string, number][] = [
    [PARTICIPATION_METRICS.offensiveSnaps, 55 * scale],
    [PARTICIPATION_METRICS.teamOffensiveSnaps, 65],
    [PARTICIPATION_METRICS.targets, 9 * scale],
    [PARTICIPATION_METRICS.teamTargets, 34],
    [PARTICIPATION_METRICS.carries, 1],
    [PARTICIPATION_METRICS.teamCarries, 26],
    [PARTICIPATION_METRICS.passAttempts, 0],
    [PARTICIPATION_METRICS.teamPassAttempts, 34],
  ];
  const outcome: readonly [string, number][] = [
    [statMetricName("receptions"), 6 * scale],
    [statMetricName("receivingYards"), 78 * scale],
    [statMetricName("receivingTouchdowns"), 0.5 * scale],
  ];
  return [
    ...usage.map(([metric, value]) =>
      observation({ season, week, playerId, asOf, metric, value, source: NFLVERSE_SOURCE.snapCounts }),
    ),
    ...outcome.map(([metric, value]) =>
      observation({ season, week, playerId, asOf, metric, value, source: STAT_LINE_SOURCE }),
    ),
  ];
}

async function seedPriorSeason(): Promise<void> {
  await recordNflPlayers(db, [
    { id: VETERAN, espnId: null, pfrId: "Vete01", name: "Vera Veteran", position: "WR", latestTeam: "BUF", rookieSeason: 2020, lastSeason: 2024 },
    { id: ROOKIE, espnId: null, pfrId: "Rook01", name: "Rory Rookie", position: "WR", latestTeam: "BUF", rookieSeason: 2024, lastSeason: 2024 },
  ]);
  const rows: PlayerWeekObservation[] = [];
  for (let week = 1; week <= 17; week += 1) rows.push(...playerWeek(2023, week, VETERAN, PRIOR_SEASON_LANDED, 1));
  await recordObservations(db, rows);
  await recordPreseasonRosters(db, [
    {
      season: 2024,
      team: "BUF",
      playerId: VETERAN,
      position: "WR",
      status: "active",
      birthDate: "1998-04-08",
      draftYear: 2020,
      draftPick: 17,
      draftClub: "BUF",
      asOf: week1RosterAsOf(2024),
    },
    {
      season: 2024,
      team: "BUF",
      playerId: ROOKIE,
      position: "WR",
      status: "active",
      birthDate: "2002-06-01",
      draftYear: 2024,
      draftPick: 12,
      draftClub: "BUF",
      asOf: week1RosterAsOf(2024),
    },
  ]);
}

/** The target season, written with numbers nothing preseason could possibly have known. */
async function seedTargetSeason(scale: number): Promise<void> {
  const rows: PlayerWeekObservation[] = [];
  for (let week = 1; week <= 17; week += 1) {
    rows.push(...playerWeek(2024, week, VETERAN, TARGET_SEASON_LANDED, scale));
    rows.push(...playerWeek(2024, week, ROOKIE, TARGET_SEASON_LANDED, scale));
  }
  await recordObservations(db, rows);
}

beforeEach(async () => {
  await truncateAll(db);
  await seedPriorSeason();
  await seedTargetSeason(1);
});

describe("preseasonMomentFor", () => {
  it("is strictly BEFORE the earliest thing the season produced, not at it", async () => {
    const moment = await preseasonMomentFor(db, 2024);
    expect(moment.getTime()).toBe(TARGET_SEASON_LANDED.getTime() - 1);
  });

  it("refuses a season the store does not hold rather than defaulting to a date", async () => {
    await expect(preseasonMomentFor(db, 2019)).rejects.toThrow(/holds no game-derived observations for 2019/);
  });
});

describe("loadPreseason", () => {
  it("reads the prior season and NOTHING from the season being predicted", async () => {
    const inputs = await loadPreseason(db, 2024);
    expect(inputs.usage.length).toBeGreaterThan(0);
    expect(inputs.usage.every((row) => row.season < 2024)).toBe(true);
    expect(inputs.history.every((row) => row.season < 2024)).toBe(true);
  });

  it("reads the week-one roster, which is the one fact about the season it IS allowed to see", async () => {
    const inputs = await loadPreseason(db, 2024);
    expect(inputs.roster.map((row) => row.playerId).sort()).toEqual([VETERAN, ROOKIE].sort());
  });

  it("reads the prior season's availability record through the designation archives, and says nothing where they are silent", async () => {
    // The fixture seeds no roster weeks and no injury rows, so 2023 is an uncovered season: the
    // veteran's seventeen played games are real and his availability is unclaimed.
    const silent = await loadPreseason(db, 2024);
    expect(silent.availability.get(2023)?.get(VETERAN)).toEqual({ season: 2023, gamesPlayed: 17, teamGames: 17, gamesUnavailable: null });

    // Cover 2023: the veteran is active every week; the rookie (no played row) sits on reserve.
    await db.insert(nflverseRosterWeeks).values([
      ...Array.from({ length: 17 }, (_, index) => ({ season: 2023, week: index + 1, playerId: VETERAN, team: "BUF", status: "ACT", position: "WR" })),
      ...Array.from({ length: 17 }, (_, index) => ({ season: 2023, week: index + 1, playerId: ROOKIE, team: "BUF", status: "RES", position: "WR" })),
    ]);
    await db.insert(nflverseInjuries).values({ season: 2023, week: 3, playerId: VETERAN, reportStatus: "Questionable", primaryInjury: "Ankle", practiceStatus: "" });
    const covered = await loadPreseason(db, 2024);
    expect(covered.availability.get(2023)?.get(VETERAN)).toEqual({ season: 2023, gamesPlayed: 17, teamGames: 17, gamesUnavailable: 0 });
    expect(covered.availability.get(2023)?.get(ROOKIE)).toEqual({ season: 2023, gamesPlayed: 0, teamGames: 17, gamesUnavailable: 17 });
    expect(covered.availability.has(2024)).toBe(false);
  });

  it("refuses a season with no week-one roster rather than building half a board", async () => {
    // 2023 is in the store as history and has no roster of its own, which is exactly the shape an
    // operator hits when the participation backfill has run and the preseason ingestion has not.
    await expect(loadPreseason(db, 2023)).rejects.toThrow(/no 2023 week-one roster/);
  });
});

describe("the leakage guarantee", () => {
  it("PRODUCES AN IDENTICAL BOARD BEFORE AND AFTER THE SEASON IS WRITTEN WITH DIFFERENT NUMBERS", async () => {
    // The structural test `src/projections/model/source.test.ts` holds the weekly model to, moved to
    // the preseason. Nothing else in the suite would catch a leak: a board that read the season it
    // predicts would simply score better, and every unit test below it would still pass.
    const before = preseasonCandidates(await loadPreseason(db, 2024), ALL_PRESEASON_FEATURES, PRIORS);

    // Restate every week of 2024 at four times the volume, stamped when it really landed.
    const rows: PlayerWeekObservation[] = [];
    for (let week = 1; week <= 17; week += 1) {
      rows.push(...playerWeek(2024, week, VETERAN, new Date(TARGET_SEASON_LANDED.getTime() + 86_400_000), 4));
    }
    await recordObservations(db, rows);

    const after = preseasonCandidates(await loadPreseason(db, 2024), ALL_PRESEASON_FEATURES, PRIORS);
    expect(after).toEqual(before);
  });
});

describe("this season's closing line, which the docblock has always said is refused", () => {
  it("REFUSES a kickoff-stamped fact about the target season even when the gate would admit it", async () => {
    // The gate alone does not deliver this and never did. The preseason moment is one millisecond
    // before the earliest GAME-DERIVED player observation, a box score is stamped a day and a half
    // after its game, and a closing line is stamped AT kickoff — so on every real season the
    // Thursday opener's lines sit inside the moment. Nothing consumed them, so nothing failed; the
    // injury feed was in exactly that state when it silently gated itself out of every board this
    // engine had built. The refusal is now by source rather than by arithmetic.
    const kickoff = new Date(TARGET_SEASON_LANDED.getTime() - 36 * 60 * 60 * 1000);
    await recordTeamObservations(db, [
      {
        season: 2024,
        week: 1,
        team: "BUF",
        source: SCHEDULE_SOURCE.kickoff,
        metric: SCHEDULE_METRICS.pointSpread,
        value: -3,
        asOf: kickoff,
      },
      {
        season: 2024,
        week: 1,
        team: "BUF",
        source: SCHEDULE_SOURCE.schedule,
        metric: SCHEDULE_METRICS.restDays,
        value: 7,
        asOf: new Date("2024-05-20T00:00:00.000Z"),
      },
    ]);

    const inputs = await loadPreseason(db, 2024);
    // The kickoff stamp really is inside the gate, which is what makes the refusal load-bearing
    // rather than decorative.
    expect(kickoff.getTime()).toBeLessThan(inputs.moment.getTime());
    expect(inputs.teamObservations.some((row) => row.source === SCHEDULE_SOURCE.kickoff)).toBe(false);
    // And the May-stamped schedule fact, which a board IS allowed to read, still arrives.
    expect(inputs.teamObservations.some((row) => row.source === SCHEDULE_SOURCE.schedule)).toBe(true);
  });
});

describe("preseasonCandidates", () => {
  it("puts a veteran on the board with a per-game line and a games distribution", async () => {
    const candidates = preseasonCandidates(await loadPreseason(db, 2024), ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;
    expect(veteran.position).toBe("WR");
    expect(veteran.team).toBe("BUF");
    expect(veteran.perGame.receivingYards).toBeGreaterThan(0);
    expect(veteran.games.expected).toBeGreaterThan(0);
    expect(veteran.games.expected).toBeLessThan(17);
    expect(veteran.reasons.some((reason) => reason.code === "availability")).toBe(true);
  });

  it("puts a ROOKIE on the board, whom the weekly model cannot project at all", async () => {
    const inputs = await loadPreseason(db, 2024);
    const withRookies = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const without = preseasonCandidates(inputs, { ...ALL_PRESEASON_FEATURES, rookies: false }, PRIORS);
    expect(withRookies.map((candidate) => candidate.playerId)).toContain(ROOKIE);
    expect(without.map((candidate) => candidate.playerId)).not.toContain(ROOKIE);
    expect(rookieSegmentFor(inputs).has(ROOKIE)).toBe(true);
  });

  it("gives everybody seventeen games when availability is switched off, which is the ablation's before arm", async () => {
    const candidates = preseasonCandidates(await loadPreseason(db, 2024), { ...ALL_PRESEASON_FEATURES, availability: false }, PRIORS);
    for (const candidate of candidates) {
      expect(candidate.games.expected).toBe(17);
      expect(candidate.reasons.some((reason) => reason.code === "availability")).toBe(false);
    }
  });

  it("is sorted by player id, so two runs over the same store agree exactly", async () => {
    const inputs = await loadPreseason(db, 2024);
    const first = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    expect(preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS)).toEqual(first);
    expect(first.map((candidate) => candidate.playerId)).toEqual([...first.map((candidate) => candidate.playerId)].sort());
  });

  it("leaves a man nobody rostered off the board entirely", async () => {
    // He is in the universe and has a full prior season, and he is still not on anybody's
    // week-one roster. A board that carried him would be offering a player who does not exist.
    await recordPreseasonRosters(db, [
      {
        season: 2024,
        team: "BUF",
        playerId: VETERAN,
        position: "WR",
        status: "off_roster",
        birthDate: "1998-04-08",
        draftYear: 2020,
        draftPick: 17,
        draftClub: "BUF",
        asOf: new Date(week1RosterAsOf(2024).getTime() + 1),
      },
    ]);
    const candidates = preseasonCandidates(await loadPreseason(db, 2024), ALL_PRESEASON_FEATURES, PRIORS);
    expect(candidates.map((candidate) => candidate.playerId)).not.toContain(VETERAN);
  });
});

/**
 * Fix round (IMPORTANT 2) — THE WHOLE WIRING SEAM, END TO END: `loadPreseason`'s `factsForSeason`
 * call → `PreseasonInputs.lawFacts` → `preseasonCandidates`' `emit()` → `lawReasonsFor`. Every other
 * `reasons` assertion in this file is a `.some()` check for an unrelated code and would not notice
 * this path silently producing nothing.
 *
 * A FIXTURE REGISTRY, never `registry()` — the live `measured.json` — so this test's pass/fail can
 * never move with a future re-measurement. `target_share_persistence`'s own condition is
 * `targetShare >= 0.24` (`laws/populations.ts`), so this block seeds an EXTRA 2023 participation
 * row for the veteran, 9 targets against 34 team targets every week (`9/34 ≈ 0.265`, comfortably
 * over the line and an exact, hand-checkable number) — under `STAT_LINE_SOURCE`, matching
 * `laws/populations.test.ts`'s own convention, because `factsForSeason`'s `seasonParticipation`
 * (the shared predicate this seam is built on) reads participation gated by THAT source. The rest
 * of this file's shared `playerWeek` fixture stamps its usage rows under
 * `NFLVERSE_SOURCE.snapCounts` instead, for the model's own `usageAsOf` reader — a different
 * consumer of the same kind of fact, gated by a different source, so it does not supply this one.
 */
describe("law reasons — the board-assembly wiring (fix round, IMPORTANT 2)", () => {
  function fixtureLaw(overrides: Partial<Law> = {}): Law {
    return {
      id: "target_share_persistence",
      position: "WR",
      claim: "Fixture claim for target_share_persistence, independent of the real registry.",
      measured: { effect: 1.8, ci: [1.2, 2.4], sample: 250, seasons: "fixture" },
      trainEffect: 1.8,
      verdict: "confirmed",
      modelPath: null,
      hasFoldEvidence: true,
      origin: "tribal",
      primaryQuantityId: null,
      primaryQuantityNoun: null,
      primaryQuantityUnit: null,
      ...overrides,
    };
  }

  /**
   * A REAL discovered candidate id (Task 8 fix round, IMPORTANT 1) — `preseasonCandidates`'
   * `lawReasonsFor` call site never overrides `candidates` (`board-reasons.ts`'s own default
   * parameter), so it always matches a discovered `Law.id` against the REAL
   * `generateCandidates()`'s own output, never a fixture candidate. `threshold:WR:targetShare:q80`
   * is real (the committed `DISCOVERY_QUANTILES` table fits a WR `targetShare` quantile at every
   * level) and its primary quantity is `targetShare` — the SAME quantity `target_share_persistence`
   * reads, off the SAME `beforeEach` participation rows this describe block already seeds (9
   * targets / 34 team targets weekly, `9/34 ≈ 0.265`), so no new seeding is needed to trip it: 0.265
   * clears every one of the real WR `targetShare` quantile marks (0.152/0.188/0.234 at q70/q80/q90).
   */
  function fixtureDiscoveredLaw(overrides: Partial<Law> = {}): Law {
    return {
      id: "threshold:WR:targetShare:q80",
      position: "WR",
      claim: "Fixture claim for a discovered targetShare law, independent of the real discovered.json.",
      measured: { effect: 2.1, ci: [1.4, 2.8], sample: 250, seasons: "fixture" },
      trainEffect: 2.1,
      verdict: "confirmed",
      modelPath: null,
      hasFoldEvidence: true,
      origin: "discovered",
      primaryQuantityId: "targetShare",
      primaryQuantityNoun: "target share",
      primaryQuantityUnit: "percent",
      ...overrides,
    };
  }

  beforeEach(async () => {
    const rows: PlayerWeekObservation[] = [];
    for (let week = 1; week <= 17; week += 1) {
      rows.push(
        observation({ season: 2023, week, playerId: VETERAN, asOf: PRIOR_SEASON_LANDED, source: STAT_LINE_SOURCE, metric: PARTICIPATION_METRICS.targets, value: 9 }),
        observation({ season: 2023, week, playerId: VETERAN, asOf: PRIOR_SEASON_LANDED, source: STAT_LINE_SOURCE, metric: PARTICIPATION_METRICS.teamTargets, value: 34 }),
      );
    }
    await recordObservations(db, rows);
  });

  it("attaches a \"law\" reason, carrying the FIXTURE registry's effect and the veteran's own target share as magnitude", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [fixtureLaw()] });
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    const lawReasons = veteran.reasons.filter((reason) => reason.code === "law");
    expect(lawReasons).toEqual([{ code: "law", lawId: "target_share_persistence", effect: 1.8, magnitude: 9 / 34 }]);
  });

  it("attaches no \"law\" reason when the fixture registry's matching law is not confirmed", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [fixtureLaw({ verdict: "weak" })] });
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    expect(veteran.reasons.some((reason) => reason.code === "law")).toBe(false);
  });

  it("attaches no \"law\" reason for a player the registry's confirmed law does not apply to", async () => {
    // The rookie has no 2023 usage at all (he did not exist in the league yet), so `lawFacts` has
    // no entry for him and `target_share_persistence`'s condition is never even asked.
    const inputs = await loadPreseason(db, 2024, { laws: [fixtureLaw()] });
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const rookie = candidates.find((candidate) => candidate.playerId === ROOKIE)!;

    expect(rookie.reasons.some((reason) => reason.code === "law")).toBe(false);
  });

  it("defaults `loadPreseason`'s laws to the real registry() when none is passed", async () => {
    // Not asserting on the real registry's CONTENT (which would couple this test to
    // `measured.json`) — only that the default wiring runs end to end without throwing, matching
    // every other `loadPreseason(db, 2024)` call site in this file.
    const inputs = await loadPreseason(db, 2024);
    expect(inputs.laws.length).toBeGreaterThan(0);
    expect(() => preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS)).not.toThrow();
  });

  /**
   * THE DISCOVERED-ORIGIN SIBLING OF THIS DESCRIBE BLOCK'S OWN TRIBAL TESTS ABOVE (Task 8 fix round,
   * IMPORTANT 1) — the SAME wiring seam (`loadPreseason`'s `discoveryFactsForSeason` call ->
   * `PreseasonInputs.discoveryFacts` -> `preseasonCandidates`'s `emit()` -> `lawReasonsFor`), driven
   * through the REAL `discoveryFactsForSeason` -> `discoveryQuantitiesForSeason` reader rather than
   * a hand-built `DiscoveryFacts` object the way `board-reasons.test.ts`'s own fixtures do. This is
   * the guard against a silent-all-nulls failure the unit fixtures cannot catch: if
   * `discoveryQuantitiesForSeason`'s own store reads ever drifted from what `PARTICIPATION_METRICS`/
   * `STAT_LINE_SOURCE` actually publish, every `DiscoveryQuantityValues` field would come back
   * `null` for every real player and every discovered law would silently stop firing — a unit test
   * with hand-built facts would never notice, because it never asks the real reader anything.
   */
  it("attaches a DISCOVERED \"law\" reason through the REAL discoveryFactsForSeason path, not hand-built facts", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [fixtureDiscoveredLaw()] });
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    const lawReasons = veteran.reasons.filter((reason) => reason.code === "law");
    expect(lawReasons).toEqual([{ code: "law", lawId: "threshold:WR:targetShare:q80", effect: 2.1, magnitude: 9 / 34 }]);
  });

  it("attaches no DISCOVERED \"law\" reason when the fixture law is not confirmed, even with real tripping evidence", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [fixtureDiscoveredLaw({ verdict: "weak" })] });
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    expect(veteran.reasons.some((reason) => reason.code === "law")).toBe(false);
  });

  it("attaches no DISCOVERED \"law\" reason for the rookie, who has no 2023 evidence at all", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [fixtureDiscoveredLaw()] });
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const rookie = candidates.find((candidate) => candidate.playerId === ROOKIE)!;

    expect(rookie.reasons.some((reason) => reason.code === "law")).toBe(false);
  });

  it("attaches BOTH a tribal and a discovered \"law\" reason for the same player when both fixtures fire", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [fixtureLaw(), fixtureDiscoveredLaw()] });
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    const lawReasons = veteran.reasons.filter((reason) => reason.code === "law");
    expect(lawReasons.map((reason) => (reason.code === "law" ? reason.lawId : null)).sort()).toEqual([
      "target_share_persistence",
      "threshold:WR:targetShare:q80",
    ]);
  });
});

/**
 * THE WIN-TOTAL LAWS ON THE BOARD (vegas-laws Task 4) — the ONE fact class in `DiscoveryFacts` that
 * is published AFTER the May gate the rest of that module reads on, proven to reach a board row
 * through the real `loadPreseason` -> `discoveryFactsForSeason(..., incomingAsOf = the board's own
 * moment)` path rather than through hand-built facts.
 *
 * The law fixtures carry the REAL discovered ids (`and:WR:threshold:WR:incomingTeamWinTotal:q70 +
 * threshold:WR:snapShare:q70`, and its q80 sibling), because `preseasonCandidates`' own
 * `lawReasonsFor` call site never overrides `board-reasons.ts`'s default candidate map: a discovered
 * `Law.id` is always matched against the real `generateCandidates()` output. Their verdicts and
 * effects are fixtures, so a future re-discovery cannot move this test's pass/fail.
 *
 * The numbers are exact and hand-checkable against the committed `DISCOVERY_QUANTILES` table:
 *
 *   - snap share: this file's shared `playerWeek` fixture writes 55 offensive snaps against 65 team
 *     snaps every week under `NFLVERSE_SOURCE.snapCounts`, which is the source
 *     `discovery-facts.ts`'s own `seasonSnapCounts` reads. 55/65 = 0.8462, over the WR q70 mark of
 *     0.6926 (and over q80's 0.7749, which is why only the two fixtures' win-total halves separate
 *     them below).
 *   - incoming win total: 10.5 for BUF, over the WR q70 mark of 9.0 AND the q80 mark of 9.5.
 *
 * "Incoming" means season 2024's line attached to a player's season-2023 team, which is why every
 * fixture player below needs a 2023 `playerWeekTeams` edge: `discoveryQuantitiesForSeason` resolves
 * his team from the season it is describing, then looks the NEXT season's line up under it.
 */
describe("the win-total laws — the board's own incoming-line path (vegas-laws Task 4)", () => {
  const WIN_TOTAL_QB = "00-0000003";
  const NO_LINE_WR = "00-0000004";
  const LATE_LINE_WR = "00-0000005";
  /** August of the season being projected: after May's schedule gate, before the board's moment. */
  const LINE_PUBLISHED = new Date("2024-08-15T00:00:00.000Z");
  /** The same fact, stamped after the season started. A board must not be able to see it. */
  const LINE_PUBLISHED_LATE = new Date("2024-09-20T00:00:00.000Z");
  const SNAP_SHARE = 55 / 65;

  function winTotalLaw(overrides: Partial<Law> = {}): Law {
    return {
      id: "and:WR:threshold:WR:incomingTeamWinTotal:q70+threshold:WR:snapShare:q70",
      position: "WR",
      claim: "Fixture claim for the q70 win-total law, independent of the real discovered.json.",
      measured: { effect: 1.5, ci: [0.9, 2.2], sample: 244, seasons: "fixture" },
      trainEffect: 1.3,
      verdict: "confirmed",
      modelPath: null,
      hasFoldEvidence: true,
      origin: "discovered",
      primaryQuantityId: "snapShare",
      primaryQuantityNoun: "snap share",
      primaryQuantityUnit: "percent",
      ...overrides,
    };
  }

  function winTotalLawQ80(): Law {
    return winTotalLaw({
      id: "and:WR:threshold:WR:incomingTeamWinTotal:q80+threshold:WR:snapShare:q70",
      claim: "Fixture claim for the q80 win-total law, independent of the real discovered.json.",
      measured: { effect: 1.8, ci: [1.1, 2.6], sample: 196, seasons: "fixture" },
      trainEffect: 1.5,
    });
  }

  /** One more fixture player: the universe row, a full 2023, his 2023 team edges, his 2024 roster. */
  async function seedPlayer(playerId: string, position: "WR" | "QB", team: string): Promise<void> {
    await recordNflPlayers(db, [
      { id: playerId, espnId: null, pfrId: null, name: `Fixture ${playerId}`, position, latestTeam: team, rookieSeason: 2020, lastSeason: 2024 },
    ]);
    const rows: PlayerWeekObservation[] = [];
    const teamRows: PlayerWeekTeam[] = [];
    for (let week = 1; week <= 17; week += 1) {
      rows.push(...playerWeek(2023, week, playerId, PRIOR_SEASON_LANDED, 1));
      teamRows.push({ season: 2023, week, playerId, team, asOf: PRIOR_SEASON_LANDED });
    }
    await recordObservations(db, rows);
    await recordPlayerTeams(db, teamRows);
    await recordPreseasonRosters(db, [
      {
        season: 2024,
        team,
        playerId,
        position,
        status: "active",
        birthDate: "1998-04-08",
        draftYear: 2020,
        draftPick: 17,
        draftClub: team,
        asOf: week1RosterAsOf(2024),
      },
    ]);
  }

  function winTotalRow(team: string, value: number, asOf: Date): TeamWeekObservation {
    // Week ONE, exactly — `vegas/ingest.ts` writes one row per team-season and does not replicate it
    // across the season, and `incomingWinTotalByTeam` reads that week exactly.
    return { season: 2024, week: 1, team, source: VEGAS_SOURCE, metric: VEGAS_METRICS.winTotal, value, asOf };
  }

  beforeEach(async () => {
    // The veteran this file already seeds is the FIRING wide receiver; he needs only his 2023 team.
    const veteranTeams: PlayerWeekTeam[] = [];
    for (let week = 1; week <= 17; week += 1) veteranTeams.push({ season: 2023, week, playerId: VETERAN, team: "BUF", asOf: PRIOR_SEASON_LANDED });
    await recordPlayerTeams(db, veteranTeams);
    await seedPlayer(WIN_TOTAL_QB, "QB", "BUF");
    await seedPlayer(NO_LINE_WR, "WR", "NYJ");
    await seedPlayer(LATE_LINE_WR, "WR", "MIA");
    await recordTeamObservations(db, [
      winTotalRow("BUF", 10.5, LINE_PUBLISHED),
      winTotalRow("MIA", 10.5, LINE_PUBLISHED_LATE),
      // NYJ deliberately absent: the tri-state arm.
    ]);
  });

  async function lawReasonsOf(playerId: string, laws: readonly Law[]): Promise<readonly string[]> {
    const inputs = await loadPreseason(db, 2024, { laws });
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const candidate = candidates.find((entry) => entry.playerId === playerId)!;
    return candidate.reasons.flatMap((reason) => (reason.code === "law" ? [reason.lawId] : []));
  }

  it("resolves the NEXT season's published win total on the board's own moment, which the May gate would have nulled", async () => {
    const inputs = await loadPreseason(db, 2024);
    expect(inputs.discoveryFacts.get(VETERAN)!.current.incomingTeamWinTotal).toBe(10.5);
    expect(inputs.discoveryFacts.get(VETERAN)!.current.snapShare).toBeCloseTo(SNAP_SHARE, 12);
  });

  it("gives a WIDE RECEIVER over both marks the chip, carrying the law's effect and his own snap share", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [winTotalLaw(), winTotalLawQ80()] });
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    expect(veteran.reasons.filter((reason) => reason.code === "law")).toEqual([
      { code: "law", lawId: "and:WR:threshold:WR:incomingTeamWinTotal:q70+threshold:WR:snapShare:q70", effect: 1.5, magnitude: SNAP_SHARE },
      { code: "law", lawId: "and:WR:threshold:WR:incomingTeamWinTotal:q80+threshold:WR:snapShare:q70", effect: 1.8, magnitude: SNAP_SHARE },
    ]);
  });

  it("gives a QUARTERBACK with the IDENTICAL numbers no chip — the position gate, not the arithmetic", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [winTotalLaw()] });
    const quarterback = inputs.discoveryFacts.get(WIN_TOTAL_QB)!;
    // His numbers are the receiver's, to the digit, and they DO trip the candidate's own condition:
    // the same facts under a WR position produce the chip. Only `lawReasonsFor`'s position gate
    // stands between him and a law measured over wide receivers alone.
    expect(quarterback.current.incomingTeamWinTotal).toBe(10.5);
    expect(quarterback.current.snapShare).toBeCloseTo(SNAP_SHARE, 12);
    expect(lawReasonsFor("WR", null, quarterback, [winTotalLaw()])).toHaveLength(1);

    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const board = candidates.find((candidate) => candidate.playerId === WIN_TOTAL_QB)!;
    expect(board.position).toBe("QB");
    expect(board.reasons.some((reason) => reason.code === "law")).toBe(false);
  });

  it("gives a receiver whose team has NO published line no chip — unknown, never a false zero", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [winTotalLaw()] });
    expect(inputs.discoveryFacts.get(NO_LINE_WR)!.current.incomingTeamWinTotal).toBeNull();
    expect(await lawReasonsOf(NO_LINE_WR, [winTotalLaw()])).toEqual([]);
  });

  it("gives a receiver whose line is stamped AFTER the board's moment no chip — the gate is real", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [winTotalLaw()] });
    expect(inputs.discoveryFacts.get(LATE_LINE_WR)!.current.incomingTeamWinTotal).toBeNull();
    expect(await lawReasonsOf(LATE_LINE_WR, [winTotalLaw()])).toEqual([]);
  });

  it("gives a receiver over the q70 line but UNDER the q80 line only the q70 chip", async () => {
    await recordTeamObservations(db, [{ ...winTotalRow("BUF", 9.0, LINE_PUBLISHED), asOf: new Date(LINE_PUBLISHED.getTime() + 1) }]);
    expect(await lawReasonsOf(VETERAN, [winTotalLaw(), winTotalLawQ80()])).toEqual([
      "and:WR:threshold:WR:incomingTeamWinTotal:q70+threshold:WR:snapShare:q70",
    ]);
  });
});

/**
 * I4 (fix round, 2026-08-31) — THE IDENTITY PIN, THROUGH A PRODUCTION-REACHABLE ROUTE. `blend.test.ts`
 * pins `blendBoard`'s own identity (no admitted evidence -> marketPoints exactly) against a
 * hand-built `BoardCandidate`; this test pins the SAME identity against a candidate this describe
 * block's own `preseasonCandidates` actually produced, with `features.availability: false` — the
 * real ablation route (`gives everybody seventeen games...`, above) that is the ONLY way a real
 * board's own `games.expected` becomes a clean, exact number rather than a fitted distribution's own
 * continuous mean. `laws: []` on `loadPreseason` keeps the candidate free of any real confirmed
 * law's own reason, so the only evidence source left to neutralise is the availability gap itself.
 */
describe("blendBoard's identity, through a production-reachable route (I4 fix round)", () => {
  it("returns marketPoints exactly for a real candidate whose games.expected matches the constants' own implied-games table", async () => {
    const inputs = await loadPreseason(db, 2024, { laws: [] });
    const candidates = preseasonCandidates(inputs, { ...ALL_PRESEASON_FEATURES, availability: false }, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;
    expect(veteran.games.expected).toBe(17); // the real ablation route: seventeenGamesForEveryone(2024)

    const marketEntry: MarketPriorEntry = { playerId: VETERAN, position: "WR", adpRank: 12, marketPoints: 233.47 };
    const constants: BlendConstants = {
      lawCapPoints: 20,
      availabilityCapPoints: 40,
      totalCapPoints: 40,
      // Deliberately matches veteran.games.expected (17) so the availability-gap delta is exactly
      // zero — the one condition under which the identity is exercised.
      impliedGamesByPosition: { QB: 17, RB: 17, WR: 17, TE: 17 },
      // This test is listed (marketEntry exists), so marketTailByPosition never applies, but
      // BlendConstants still requires it.
      marketTailByPosition: { QB: 100_000, RB: 100_000, WR: 100_000, TE: 100_000 },
    };
    const [blended] = blendBoard([marketEntry], [veteran], { season: 2024, constants, laws: [] });

    expect(seasonPointsOf(blended!)).toBeCloseTo(233.47, 6);
    expect(blended!.reasons).toContainEqual({ code: "market_anchor", marketPoints: 233.47, delta: 0 });
  });
});

/** M9 (fix round) — `shippedPreseasonCandidates`'s own `{ raw: true }` seam, through the real DB
 *  path rather than only inferred from reading the source. No ADP board is ingested anywhere in
 *  this file's fixtures, so the BLENDED path (the default) falls back every candidate to
 *  `market_unlisted`; the RAW path never touches the market at all and carries no such reason. */
describe("shippedPreseasonCandidates's raw flag (M9 fix round)", () => {
  it("raw: true returns exactly preseasonCandidates's own output, with no market_unlisted or market_anchor reason", async () => {
    const inputs = await loadPreseason(db, 2024);
    // shippedPreseasonCandidates defaults `features` to SHIPPED_PRESEASON_FEATURES, not
    // ALL_PRESEASON_FEATURES — the "expected" side has to match that default, not this file's own
    // usual ablation-testing default, or the two sides diverge on unrelated feature flags
    // (rookieLanding in particular) rather than on the raw/blended distinction this test is about.
    const expected = preseasonCandidates(inputs, SHIPPED_PRESEASON_FEATURES, PRIORS);
    const raw = await shippedPreseasonCandidates(db, inputs, PRIORS, { raw: true });
    expect(raw).toEqual(expected);
    for (const candidate of raw) {
      expect(candidate.reasons.some((reason) => reason.code === "market_unlisted" || reason.code === "market_anchor")).toBe(false);
    }
  });

  it("raw: false (the default) runs the blend, tagging every candidate market_unlisted when no ADP board exists", async () => {
    const inputs = await loadPreseason(db, 2024);
    const blended = await shippedPreseasonCandidates(db, inputs, PRIORS);
    expect(blended.length).toBeGreaterThan(0);
    for (const candidate of blended) {
      expect(candidate.reasons).toContainEqual({ code: "market_unlisted" });
    }
  });
});

/**
 * TASK 2 — THE LIVE MOMENT, AUDIT FIRST.
 *
 * `docs/research/2026-08-28-live-season.md` names the shape: a discriminated `BoardMoment`, whose
 * REPLAY arm wraps `preseasonMomentFor`'s existing derivation byte-identical, and whose LIVE arm is
 * `min(now, first-kickoff-minus-one-ms)` with a THROW the instant the season has already started (a
 * started season has a replay moment, never a live one) or has no ingested schedule at all. The live
 * arm's own READ GUARD is stricter than the replay assertion: it refuses ANY player-week observation
 * stamped from the season being projected, regardless of source or of its own as-of, so a live board
 * can never see a fact the replay arm's own `PRE_GAME_SOURCES` carve-out would have admitted.
 *
 * A season with no observations of its own at all (a genuinely unstarted one, this suite's LIVE_SEASON)
 * so every test below seeds only what it is actually testing.
 */
describe("BoardMoment — the live arm (Task 2 audit)", () => {
  const LIVE_SEASON = 2026;
  // A Thursday-night opener, well after `week1RosterAsOf(2026)` (1 September).
  const FIRST_KICKOFF = new Date("2026-09-04T23:20:00.000Z");

  async function seedFirstKickoff(season: number, kickoff: Date): Promise<void> {
    await recordTeamObservations(db, [
      {
        season,
        week: 1,
        team: "BUF",
        source: SCHEDULE_SOURCE.kickoff,
        // The UNCONDITIONAL marker (fix round, I4/I5) — `liveMomentFor` reads through
        // `firstKickoffFor`, which no longer keys off `pointSpread`.
        metric: SCHEDULE_METRICS.kickoffInstant,
        value: 1,
        asOf: kickoff,
      },
    ]);
  }

  /** A moment strictly before `FIRST_KICKOFF` and strictly AFTER `week1RosterAsOf(LIVE_SEASON)` (1
   *  September) — the window every test below needs `liveMomentFor` to land in so it both succeeds
   *  (before kickoff) and can actually see the seeded roster (at or after cutdown). */
  const clockBeforeKickoff: Clock = { now: () => new Date(FIRST_KICKOFF.getTime() - 24 * 60 * 60 * 1000).toISOString() };

  async function seedLiveRoster(season: number): Promise<void> {
    await recordPreseasonRosters(db, [
      {
        season,
        team: "BUF",
        playerId: VETERAN,
        position: "WR",
        status: "active",
        birthDate: "1998-04-08",
        draftYear: 2020,
        draftPick: 17,
        draftClub: "BUF",
        asOf: week1RosterAsOf(season),
      },
    ]);
  }

  describe("(a) both arms, pinned — the replay arm threaded through BoardMoment stays byte-identical", () => {
    it("produces the SAME board whether loadPreseason resolves the replay moment itself or is handed one explicitly", async () => {
      const explicitMoment = await replayMomentFor(db, 2024);
      expect(explicitMoment.kind).toBe("replay");

      const viaDefault = await loadPreseason(db, 2024);
      const viaExplicitMoment = await loadPreseason(db, 2024, { boardMoment: explicitMoment });

      // M10: SELF-CONTAINED, not merely mutually consistent. Pinning `viaDefault.moment` to the
      // fixture's own independently-known ground truth (`TARGET_SEASON_LANDED - 1ms`, the exact
      // value `preseasonMomentFor`'s own describe block above pins) means this test would fail if
      // BOTH paths agreed on the same WRONG moment, not only if they merely agreed with each other.
      expect(viaDefault.moment.getTime()).toBe(TARGET_SEASON_LANDED.getTime() - 1);

      expect(viaExplicitMoment.moment.getTime()).toBe(viaDefault.moment.getTime());
      expect(viaExplicitMoment.momentKind).toBe("replay");
      expect(viaDefault.momentKind).toBe("replay");

      const boardViaDefault = preseasonCandidates(viaDefault, ALL_PRESEASON_FEATURES, PRIORS);
      const boardViaExplicitMoment = preseasonCandidates(viaExplicitMoment, ALL_PRESEASON_FEATURES, PRIORS);
      expect(boardViaExplicitMoment).toEqual(boardViaDefault);
    });
  });

  describe("(b) the live arm's read guard — CLASS-SCOPED (Task 3, ruling A)", () => {
    // Fix round, C2: every live moment below is constructed THROUGH `liveMomentFor` — a hand-built
    // `{ kind: "live", at }` is no longer even legal here (see the "(C2)" describe block below for
    // what happens if one is attempted anyway), and doing it this way is stronger for free: it
    // exercises the SAME `liveMomentFor` derivation a real caller would go through, not a
    // hand-picked `Date` this test alone believes is "before kickoff".
    it("THROWS on a game-derived observation for the season, at ANY as-of — a box score existing at all means the season started", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      await recordObservations(db, [
        observation({
          season: LIVE_SEASON,
          week: 1,
          playerId: VETERAN,
          source: STAT_LINE_SOURCE,
          metric: statMetricName("receptions"),
          value: 4,
          // Stamped BEFORE the live moment on purpose — the old guard's "any row for the season"
          // rule would have caught this for free; the new class-scoped guard has to reach the same
          // verdict for a DIFFERENT reason (it is game-derived, full stop, never a comparison against
          // the moment), and this stamp proves that reasoning rather than reusing the moment check.
          asOf: new Date(FIRST_KICKOFF.getTime() - 5 * 24 * 60 * 60 * 1000),
        }),
      ]);

      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      await expect(loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment })).rejects.toThrow(/live board/i);
      await expect(loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment })).rejects.toThrow(/game-derived/i);
    });

    /**
     * M11's companion, carried forward: a game-derived fact stamped even AFTER the live moment
     * itself still throws — "at ANY as-of" has to mean both directions, not only "not yet in the
     * future".
     */
    it("THROWS on a game-derived STAT_LINE_SOURCE observation stamped AFTER the live moment too", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      await recordObservations(db, [
        observation({
          season: LIVE_SEASON,
          week: 1,
          playerId: VETERAN,
          source: STAT_LINE_SOURCE,
          metric: statMetricName("receptions"),
          value: 4,
          asOf: new Date(FIRST_KICKOFF.getTime() + 2 * 24 * 60 * 60 * 1000),
        }),
      ]);

      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      await expect(loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment })).rejects.toThrow(/live board/i);
    });

    it("a PRE-GAME (depth chart) row stamped BEFORE now is VISIBLE — no throw, no carve-out needed", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      // `now` (clockBeforeKickoff) is FIRST_KICKOFF minus one day; this row is stamped five days
      // before kickoff, so it is BEFORE now and must flow through the ORDINARY as-of gate, exactly
      // like a replay board's depth chart.
      await recordObservations(db, [
        observation({
          season: LIVE_SEASON,
          week: 1,
          playerId: VETERAN,
          source: DEPTH_SOURCE,
          metric: DEPTH_METRIC,
          value: 1,
          asOf: new Date(FIRST_KICKOFF.getTime() - 5 * 24 * 60 * 60 * 1000),
        }),
      ]);

      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });
      expect(inputs.momentKind).toBe("live");
      expect(inputs.depthChart.get(VETERAN)).toBe("first");
    });

    /**
     * M3 (fix round review) — the PRE-GAME class's OTHER member, admitted the identical way. Nothing
     * in `preseasonCandidates` reads an injury filing (`PRESEASON_MODEL_FEATURES.news` is off, and
     * `ProjectionInput.news` is always `[]` on this board), so there is no board-visible field to
     * assert a value landed in, unlike `depthChart` above. What this pins is narrower and just as
     * real: the guard itself does not throw on an `INJURY_SOURCE` row, proving the admission is a
     * genuine two-member `PRE_GAME_SOURCES` class rather than something that happens to work for
     * `DEPTH_SOURCE` alone.
     */
    it("an INJURY_SOURCE row is admitted by the guard too, even though nothing downstream reads it yet (news is off)", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      await recordObservations(db, [
        observation({
          season: LIVE_SEASON,
          week: 1,
          playerId: VETERAN,
          source: INJURY_SOURCE,
          metric: INJURY_METRICS.reportStatus,
          value: 1,
          asOf: new Date(FIRST_KICKOFF.getTime() - 5 * 24 * 60 * 60 * 1000),
        }),
      ]);

      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });
      expect(inputs.momentKind).toBe("live");
    });

    it("a PRE-GAME (depth chart) row stamped AFTER now is invisible via the ordinary gate — no throw, just gated", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      // The kickoff-eve convention's own stamp (kickoff - 1ms) — AFTER `now` (kickoff - 1 day) — is
      // exactly the case the pre-Task-3 depth ingestion produced for a live season. It must not
      // throw; it must simply not appear on the board, the same silent point-in-time behaviour every
      // other reader in this engine already has.
      await recordObservations(db, [
        observation({
          season: LIVE_SEASON,
          week: 1,
          playerId: VETERAN,
          source: DEPTH_SOURCE,
          metric: DEPTH_METRIC,
          value: 1,
          asOf: new Date(FIRST_KICKOFF.getTime() - 1),
        }),
      ]);

      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });
      expect(inputs.momentKind).toBe("live");
      expect(inputs.depthChart.has(VETERAN)).toBe(false);
    });

    it("succeeds and reports momentKind \"live\" when the store holds nothing at all for the season", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });
      expect(inputs.momentKind).toBe("live");
      expect(inputs.moment.getTime()).toBe(liveMoment.at.getTime());
    });
  });

  /**
   * C2 — BoardMoment is UNFORGEABLE. TypeScript's structural typing does nothing to stop a caller
   * writing `{ kind: "replay", at: new Date() }` and handing it straight to `loadPreseason`: the
   * object is shaped exactly like a real `BoardMoment`, and the type checker cannot tell it apart
   * from one `replayMomentFor` actually derived. That gap is the third leakage defect in one line —
   * a live board persisted and graded as though it were a claim about a finished season — and the
   * fix is a runtime brand (a private `WeakSet`, `source.ts`'s own `BRANDED_MOMENTS`) `loadPreseason`
   * checks on any caller-supplied moment before using it for anything.
   */
  describe("(C2) BoardMoment cannot be hand-built", () => {
    it("REFUSES a hand-constructed replay BoardMoment, naming the two real constructors", async () => {
      await seedLiveRoster(LIVE_SEASON);
      const forged: BoardMoment = { kind: "replay", at: new Date("2026-01-01T00:00:00.000Z") };
      await expect(loadPreseason(db, LIVE_SEASON, { boardMoment: forged })).rejects.toThrow(
        /replayMomentFor|liveMomentFor/,
      );
    });

    it("REFUSES a hand-constructed live BoardMoment too, not only a forged replay one", async () => {
      await seedLiveRoster(LIVE_SEASON);
      const forged: BoardMoment = { kind: "live", at: new Date("2026-01-01T00:00:00.000Z") };
      await expect(loadPreseason(db, LIVE_SEASON, { boardMoment: forged })).rejects.toThrow(
        /replayMomentFor|liveMomentFor/,
      );
    });
  });

  describe("(d) liveMomentFor — before kickoff `at` is now; at or after kickoff it throws", () => {
    it("returns `at = now` when now is strictly before the season's first scheduled kickoff", async () => {
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      const now = new Date(FIRST_KICKOFF.getTime() - 10 * 24 * 60 * 60 * 1000);
      const clock: Clock = { now: () => now.toISOString() };

      const moment = await liveMomentFor(db, LIVE_SEASON, clock);
      expect(moment).toEqual({ kind: "live", at: now });
    });

    it("throws the instant now reaches the season's first kickoff — a started season has a replay moment", async () => {
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      const clock: Clock = { now: () => FIRST_KICKOFF.toISOString() };
      await expect(liveMomentFor(db, LIVE_SEASON, clock)).rejects.toThrow(/kickoff|started/i);
    });

    it("throws once the season's first kickoff is in the past", async () => {
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      const clock: Clock = { now: () => new Date(FIRST_KICKOFF.getTime() + 60_000).toISOString() };
      await expect(liveMomentFor(db, LIVE_SEASON, clock)).rejects.toThrow(/kickoff|started/i);
    });
  });

  describe("(e) liveMomentFor refuses a season with no ingested schedule, rather than defaulting to a date", () => {
    it("throws", async () => {
      const clock: Clock = { now: () => "2026-01-01T00:00:00.000Z" };
      await expect(liveMomentFor(db, LIVE_SEASON, clock)).rejects.toThrow(/schedule/i);
    });
  });

  /**
   * (f) TASK 4 — `admitsDerivedPriorSeason`'s wiring, proven end to end rather than only argued in its
   * own docblock. `factsForSeason` drops a player from its returned map entirely when it finds no
   * scoring for him (`laws/populations.ts`: `if (scored === undefined || ppg === null) continue;`)
   * — the cleanest possible probe for "did `admitDerived` actually reach the read": a player whose
   * WHOLE prior season exists ONLY under `DERIVED_STAT_LINE_SOURCE` is PRESENT in
   * `lawFacts`/`discoveryFacts` when admitted and ABSENT when not, with no fixture registry or
   * population threshold needed to see it either way.
   */
  describe("(f) Task 4 — admitDerived on the live arm, narrowed to LIVE_ADMITTED_DERIVED_SEASONS", () => {
    /** VETERAN's whole `season` exists ONLY under `DERIVED_STAT_LINE_SOURCE` — the shape a real gap
     *  season takes today (no `stats_player_week_2025.csv` upstream). Stamped well before the
     *  following season's own `schedulePublishedAsOf` gate (20 May), so it is visible whenever
     *  `admitDerived` is `true`. */
    async function seedDerivedOnlySeason(season: number): Promise<void> {
      const rows: PlayerWeekObservation[] = [];
      for (let week = 1; week <= 17; week += 1) {
        rows.push(
          observation({
            season, week, playerId: VETERAN, source: DERIVED_STAT_LINE_SOURCE,
            metric: statMetricName("receivingYards"), value: 78,
            asOf: new Date(Date.UTC(season + 1, 0, 8)),
          }),
        );
      }
      await recordObservations(db, rows);
    }

    it("ADMITS a DERIVED-only 2025 season into lawFacts/discoveryFacts on the LIVE 2026 board (2025 is the allowlist)", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      await seedDerivedOnlySeason(2025);

      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });
      expect(inputs.momentKind).toBe("live");
      expect(inputs.lawFacts.has(VETERAN)).toBe(true);
      expect(inputs.discoveryFacts.has(VETERAN)).toBe(true);
    });

    it("does NOT admit a DERIVED-only 2025 season on a REPLAY board, even though 2025 is in the allowlist — the LIVE half of the conjunction is what actually gates it", async () => {
      // A REPLAY 2026 board: the season has its own game-derived stamp, so `loadPreseason`'s default
      // (no `boardMoment`) resolves the REPLAY arm. `season - 1` is still 2025, still admitted by
      // the allowlist alone, but `momentKind` is "replay" — the other half of the conjunction.
      await seedLiveRoster(LIVE_SEASON);
      await recordObservations(db, [
        observation({
          season: LIVE_SEASON, week: 1, playerId: VETERAN, source: STAT_LINE_SOURCE,
          metric: statMetricName("receptions"), value: 4,
          asOf: new Date(FIRST_KICKOFF.getTime() + 2 * 24 * 60 * 60 * 1000),
        }),
      ]);
      await seedDerivedOnlySeason(2025);

      const inputs = await loadPreseason(db, LIVE_SEASON);
      expect(inputs.momentKind).toBe("replay");
      expect(inputs.lawFacts.has(VETERAN)).toBe(false);
      expect(inputs.discoveryFacts.has(VETERAN)).toBe(false);
    });

    it("does NOT admit a DERIVED-only prior season on a LIVE board when that prior season is not in the allowlist", async () => {
      // A second live season, one year further on: LIVE_SEASON_2's own prior season is 2026, which
      // `LIVE_ADMITTED_DERIVED_SEASONS` does not list — only the LIVE half of the conjunction held.
      const LIVE_SEASON_2 = 2027;
      const FIRST_KICKOFF_2 = new Date("2027-09-03T23:20:00.000Z");
      const clockBeforeKickoff2: Clock = { now: () => new Date(FIRST_KICKOFF_2.getTime() - 24 * 60 * 60 * 1000).toISOString() };

      await recordPreseasonRosters(db, [
        {
          season: LIVE_SEASON_2, team: "BUF", playerId: VETERAN, position: "WR", status: "active",
          birthDate: "1998-04-08", draftYear: 2020, draftPick: 17, draftClub: "BUF",
          asOf: week1RosterAsOf(LIVE_SEASON_2),
        },
      ]);
      await recordTeamObservations(db, [
        {
          season: LIVE_SEASON_2, week: 1, team: "BUF", source: SCHEDULE_SOURCE.kickoff,
          metric: SCHEDULE_METRICS.kickoffInstant, value: 1, asOf: FIRST_KICKOFF_2,
        },
      ]);
      await seedDerivedOnlySeason(2026);

      const liveMoment = await liveMomentFor(db, LIVE_SEASON_2, clockBeforeKickoff2);
      const inputs = await loadPreseason(db, LIVE_SEASON_2, { boardMoment: liveMoment });
      expect(inputs.momentKind).toBe("live");
      expect(inputs.lawFacts.has(VETERAN)).toBe(false);
      expect(inputs.discoveryFacts.has(VETERAN)).toBe(false);
    });

    /**
     * FINAL FIX ROUND (whole-branch review, H1). Task 4 wired the admission into the LAW facts and
     * nowhere else, so the MODEL arm of the very same live board still read `season - 1` through the
     * published-only `statLinesAsOf` and found nothing: `predictRates` returns an empty map and every
     * player on the board falls to `priors.model.efficiency.byPosition[position]`, which looks like a
     * healthy board because "no evidence means the prior" is the designed fallback. These two tests
     * pin BOTH halves of the same conjunction the law facts already obey.
     */
    async function seedGapSeasonUsageAndOutcomes(season: number): Promise<void> {
      const rows: PlayerWeekObservation[] = [];
      for (let week = 1; week <= 17; week += 1) {
        const stamp = { season, week, playerId: VETERAN, asOf: new Date(Date.UTC(season + 1, 0, 8)) } as const;
        // The snap-counts file, which nflverse DOES publish for a gap season.
        rows.push(
          observation({ ...stamp, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.offensiveSnaps, value: 55 }),
          observation({ ...stamp, source: NFLVERSE_SOURCE.snapCounts, metric: PARTICIPATION_METRICS.teamOffensiveSnaps, value: 65 }),
        );
        // The play-by-play's own touch counts — the honest denominator the weekly stats file would
        // have carried. All eight members, the way the ingestion writes them.
        for (const [metric, value] of [
          [PBP_PLAYER_METRICS.carries, 1],
          [PBP_PLAYER_METRICS.targets, 9],
          [PBP_PLAYER_METRICS.redZoneCarries, 0],
          [PBP_PLAYER_METRICS.redZoneTargets, 1],
          [PBP_PLAYER_METRICS.insideTenCarries, 0],
          [PBP_PLAYER_METRICS.insideTenTargets, 0],
          [PBP_PLAYER_METRICS.airYards, 70],
          [PBP_PLAYER_METRICS.airYardTargets, 9],
        ] as const) {
          rows.push(observation({ ...stamp, source: PBP_PLAYER_SOURCE, metric, value }));
        }
        // The outcomes, derived from the same play-by-play, under the derived source alone.
        for (const [field, value] of [["receptions", 6], ["receivingYards", 78], ["receivingTouchdowns", 1]] as const) {
          rows.push(observation({ ...stamp, source: DERIVED_STAT_LINE_SOURCE, metric: statMetricName(field), value }));
        }
      }
      await recordObservations(db, rows);
    }

    it("ADMITS the derived prior season into the MODEL arm's history and opportunity on a LIVE board", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      await seedGapSeasonUsageAndOutcomes(2025);

      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });

      expect(inputs.history.some((row) => row.season === 2025)).toBe(true);
      const usage2025 = inputs.usage.filter((row) => row.season === 2025);
      expect(usage2025.length).toBe(17);
      // The play-by-play's counts stand in for the withheld weekly ones, so layer 2 has a real
      // denominator to take a rate over instead of an absence that reads as the position prior.
      expect(usage2025.every((row) => row.targets === 9)).toBe(true);
      // What has no honest substitute stays absent: a team total cannot come off a player feed.
      expect(usage2025.every((row) => row.teamTargets === null)).toBe(true);

      const rates = predictRates(inputs.history, inputs.usage, { season: LIVE_SEASON, week: 1, positions: inputs.positions }, PRIORS.model.efficiency);
      const measured = rates.get(VETERAN);
      expect(measured).toBeDefined();
      // 6 receptions on 9 targets, every week, is emphatically not the WR position mean.
      expect(measured!.receptionsPerTarget).not.toBeCloseTo(PRIORS.model.efficiency.byPosition.WR.receptionsPerTarget, 6);
      expect(measured!.receptionsPerTarget).toBeGreaterThan(PRIORS.model.efficiency.byPosition.WR.receptionsPerTarget);
    });

    it("does NOT admit it into the model arm on a REPLAY board — the live half of the conjunction gates this read too", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await recordObservations(db, [
        observation({
          season: LIVE_SEASON, week: 1, playerId: VETERAN, source: STAT_LINE_SOURCE,
          metric: statMetricName("receptions"), value: 4,
          asOf: new Date(FIRST_KICKOFF.getTime() + 2 * 24 * 60 * 60 * 1000),
        }),
      ]);
      await seedGapSeasonUsageAndOutcomes(2025);

      const inputs = await loadPreseason(db, LIVE_SEASON);
      expect(inputs.momentKind).toBe("replay");
      expect(inputs.history.some((row) => row.season === 2025)).toBe(false);
      const usage2025 = inputs.usage.filter((row) => row.season === 2025);
      expect(usage2025.length).toBe(17);
      expect(usage2025.every((row) => row.targets === null)).toBe(true);
    });
  });

  /**
   * (g) TASK 4 FIX ROUND — THE DEGENERACY GUARD (`market/blend.ts`'s `shippedPreseasonCandidates`).
   * A LIVE board whose market resolves ZERO listed players must never ship: every candidate would
   * fall back to the position tail cap and tie an entire position at the identical value, which is
   * exactly what the real 2026 persist produced before the ADP stamp fix landed.
   */
  describe("(g) Task 4 fix round — the degeneracy guard refuses a live board with zero listed market players", () => {
    it("THROWS naming the season and the moment when a LIVE board's market resolves nobody", async () => {
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      // No ADP rows recorded for LIVE_SEASON at all — the exact shape the real incident had before
      // the fix (every row's own stamp fell after the live moment, so nothing was visible).
      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });

      await expect(shippedPreseasonCandidates(db, inputs, PRIORS)).rejects.toThrow(
        new RegExp(`${LIVE_SEASON}'s LIVE board resolved ZERO listed market players`),
      );
      await expect(shippedPreseasonCandidates(db, inputs, PRIORS)).rejects.toThrow(/must not be persisted/);
    });

    it("does NOT throw when the LIVE board's market resolves at least one listed player, even with no candidates of our own to anchor", async () => {
      // No usage history is seeded for LIVE_SEASON here (this fixture's `beforeEach` only ever
      // seeds 2023/2024 history), so `preseasonCandidates` itself has nobody to emit — the
      // narrowest possible proof that the guard's own predicate is `market.length === 0`, not
      // `candidates.length === 0`: a market with one real, visible, listed player must not trip it,
      // whether or not OUR side of the board has anyone to blend that price against.
      await seedLiveRoster(LIVE_SEASON);
      await seedFirstKickoff(LIVE_SEASON, FIRST_KICKOFF);
      await recordPreseasonRankings(db, [
        {
          season: LIVE_SEASON,
          source: BENCHMARK_SOURCES.adp,
          playerId: VETERAN,
          rank: 12.6,
          // Well before the live moment (kickoff minus a day), so it is honestly visible.
          asOf: new Date(FIRST_KICKOFF.getTime() - 5 * 24 * 60 * 60 * 1000),
        },
      ]);
      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clockBeforeKickoff);
      const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });

      const candidates = await shippedPreseasonCandidates(db, inputs, PRIORS);
      expect(candidates).toEqual([]);
    });

    it("does NOT throw for a REPLAY board with zero listed market players — an established, legitimate state", async () => {
      // 2024's replay fixture never ingests any ADP board at all (the pre-existing "raw: false"
      // test below pins exactly this: every candidate is market_unlisted, not a thrown error).
      const inputs = await loadPreseason(db, 2024);
      const candidates = await shippedPreseasonCandidates(db, inputs, PRIORS);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.every((candidate) => candidate.reasons.some((reason) => reason.code === "market_unlisted"))).toBe(true);
    });
  });
});
