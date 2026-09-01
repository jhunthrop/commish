import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { recordNflPlayers } from "../universe";
import { PARTICIPATION_METRICS, NFLVERSE_SOURCE } from "../nflverse/map";
import { week1RosterAsOf } from "../nflverse/rosters";
import { STAT_LINE_SOURCE, statMetricName } from "../lines";
import { recordObservations, type PlayerWeekObservation } from "../store";
import { recordPreseasonRosters } from "./store";
import { recordTeamObservations } from "../team-store";
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
});
