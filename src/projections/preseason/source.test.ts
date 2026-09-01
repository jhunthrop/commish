import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { recordNflPlayers } from "../universe";
import { PARTICIPATION_METRICS, NFLVERSE_SOURCE } from "../nflverse/map";
import { week1RosterAsOf } from "../nflverse/rosters";
import { STAT_LINE_SOURCE, statMetricName } from "../lines";
import { recordObservations, type PlayerWeekObservation } from "../store";
import { recordPreseasonRosters } from "./store";
import { recordTeamObservations } from "../team-store";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { FITTED_MODEL } from "../model/source";
import type { Law } from "../laws/types";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "./fitted";
import {
  ALL_PRESEASON_FEATURES,
  loadPreseason,
  preseasonCandidates,
  preseasonMomentFor,
  rookieSegmentFor,
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
    const inputs = await loadPreseason(db, 2024, [fixtureLaw()]);
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    const lawReasons = veteran.reasons.filter((reason) => reason.code === "law");
    expect(lawReasons).toEqual([{ code: "law", lawId: "target_share_persistence", effect: 1.8, magnitude: 9 / 34 }]);
  });

  it("attaches no \"law\" reason when the fixture registry's matching law is not confirmed", async () => {
    const inputs = await loadPreseason(db, 2024, [fixtureLaw({ verdict: "weak" })]);
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    expect(veteran.reasons.some((reason) => reason.code === "law")).toBe(false);
  });

  it("attaches no \"law\" reason for a player the registry's confirmed law does not apply to", async () => {
    // The rookie has no 2023 usage at all (he did not exist in the league yet), so `lawFacts` has
    // no entry for him and `target_share_persistence`'s condition is never even asked.
    const inputs = await loadPreseason(db, 2024, [fixtureLaw()]);
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
    const inputs = await loadPreseason(db, 2024, [fixtureDiscoveredLaw()]);
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    const lawReasons = veteran.reasons.filter((reason) => reason.code === "law");
    expect(lawReasons).toEqual([{ code: "law", lawId: "threshold:WR:targetShare:q80", effect: 2.1, magnitude: 9 / 34 }]);
  });

  it("attaches no DISCOVERED \"law\" reason when the fixture law is not confirmed, even with real tripping evidence", async () => {
    const inputs = await loadPreseason(db, 2024, [fixtureDiscoveredLaw({ verdict: "weak" })]);
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    expect(veteran.reasons.some((reason) => reason.code === "law")).toBe(false);
  });

  it("attaches no DISCOVERED \"law\" reason for the rookie, who has no 2023 evidence at all", async () => {
    const inputs = await loadPreseason(db, 2024, [fixtureDiscoveredLaw()]);
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const rookie = candidates.find((candidate) => candidate.playerId === ROOKIE)!;

    expect(rookie.reasons.some((reason) => reason.code === "law")).toBe(false);
  });

  it("attaches BOTH a tribal and a discovered \"law\" reason for the same player when both fixtures fire", async () => {
    const inputs = await loadPreseason(db, 2024, [fixtureLaw(), fixtureDiscoveredLaw()]);
    const candidates = preseasonCandidates(inputs, ALL_PRESEASON_FEATURES, PRIORS);
    const veteran = candidates.find((candidate) => candidate.playerId === VETERAN)!;

    const lawReasons = veteran.reasons.filter((reason) => reason.code === "law");
    expect(lawReasons.map((reason) => (reason.code === "law" ? reason.lawId : null)).sort()).toEqual([
      "target_share_persistence",
      "threshold:WR:targetShare:q80",
    ]);
  });
});
