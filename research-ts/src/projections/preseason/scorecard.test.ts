import { describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import type { Clock } from "@research-ts/domain/timing";
import { recordNflPlayers } from "../universe";
import { recordPreseasonRosters } from "./store";
import { recordTeamObservations } from "../team-store";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { week1RosterAsOf } from "../nflverse/rosters";
import { liveMomentFor, loadPreseason, type PreseasonInputs } from "./source";
import { assertGradableMoment, gradableInputs } from "./scorecard";

/**
 * TASK 2 — AUDIT (c): "A LIVE BOARD MUST BE STRUCTURALLY UNGRADEABLE."
 *
 * `preseason-report.ts`, `preseason-diagnose.ts`, `blend-fit.ts` and `market-edge-scorecard.ts` all
 * score a board against ACTUAL outcomes for a season that has already been played. A board taken at
 * a LIVE moment is a claim about a season that has NOT been played yet — there is no actual outcome
 * to score it against, and grading one anyway would silently produce a meaningless number rather
 * than an honest refusal. This is the scorecard path's own half of the guard `source.ts`'s live-arm
 * read guard establishes on the load side.
 *
 * FIX ROUND, I3: `gradableInputs` is the CONVERGENCE POINT all four scripts above now call through,
 * immediately after `loadPreseason` — see its own docblock. `assertGradableMoment` is the lower-level
 * primitive it wraps; both are tested here, and `gradableInputs` a second time (M11) at the
 * call-site shape: a REAL `PreseasonInputs` built by `loadPreseason` with a live moment, not a
 * hand-typed string.
 */
describe("assertGradableMoment", () => {
  it("REFUSES a live row with a clear message naming the guard", () => {
    expect(() => assertGradableMoment("live", 2026)).toThrow(/live/i);
    expect(() => assertGradableMoment("live", 2026)).toThrow(/2026/);
  });

  it("does not throw for a replay row — the only kind the scorecard has ever graded", () => {
    expect(() => assertGradableMoment("replay", 2024)).not.toThrow();
  });
});

describe("gradableInputs — the convergence point (fix round, I3)", () => {
  it("throws the SAME refusal assertGradableMoment does, reading momentKind and season off inputs", () => {
    // A minimal stand-in for the two fields `gradableInputs` actually reads — `PreseasonInputs`
    // itself is not a security boundary the way `BoardMoment` is (nothing forges it to defeat a
    // guard), so a narrow, explicit assertion here is honest about what this test pins rather than
    // a heavier fixture that would obscure it.
    const live = { season: 2026, momentKind: "live" } as unknown as PreseasonInputs;
    expect(() => gradableInputs(live)).toThrow(/2026/);
    expect(() => gradableInputs(live)).toThrow(/live/i);
  });

  it("returns inputs UNCHANGED (identity) when the moment is gradable", () => {
    const replay = { season: 2024, momentKind: "replay" } as unknown as PreseasonInputs;
    expect(gradableInputs(replay)).toBe(replay);
  });

  /**
   * M11 — the call-site-level version: a REAL `PreseasonInputs`, built by the REAL `loadPreseason`
   * with a REAL live moment (`liveMomentFor`), not a hand-typed `momentKind` string. This is the
   * shape every one of the four grading scripts actually has in hand when it calls `gradableInputs`,
   * and it is the strongest proof available that the convergence point works end to end on the
   * dangerous path (a live board reaching a grading script) — the identity/non-throwing path above
   * is adequately covered without the added weight of a full replay-season fixture.
   */
  describe("against a REAL live PreseasonInputs, not a hand-typed momentKind", () => {
    const db = createTestDb();
    const LIVE_SEASON = 2026;
    const VETERAN = "00-0000001";
    const FIRST_KICKOFF = new Date("2026-09-04T23:20:00.000Z");

    it("throws when handed the live board a real loadPreseason call produced", async () => {
      await truncateAll(db);
      await recordNflPlayers(db, [
        { id: VETERAN, espnId: null, pfrId: "Vete01", name: "Vera Veteran", position: "WR", latestTeam: "BUF", rookieSeason: 2020, lastSeason: 2026 },
      ]);
      await recordPreseasonRosters(db, [
        {
          season: LIVE_SEASON,
          team: "BUF",
          playerId: VETERAN,
          position: "WR",
          status: "active",
          birthDate: "1998-04-08",
          draftYear: 2020,
          draftPick: 17,
          draftClub: "BUF",
          asOf: week1RosterAsOf(LIVE_SEASON),
        },
      ]);
      await recordTeamObservations(db, [
        {
          season: LIVE_SEASON,
          week: 1,
          team: "BUF",
          source: SCHEDULE_SOURCE.kickoff,
          metric: SCHEDULE_METRICS.kickoffInstant,
          value: 1,
          asOf: FIRST_KICKOFF,
        },
      ]);
      const clock: Clock = { now: () => new Date(FIRST_KICKOFF.getTime() - 24 * 60 * 60 * 1000).toISOString() };
      const liveMoment = await liveMomentFor(db, LIVE_SEASON, clock);
      const inputs = await loadPreseason(db, LIVE_SEASON, { boardMoment: liveMoment });

      expect(() => gradableInputs(inputs)).toThrow(/live/i);
      expect(() => gradableInputs(inputs)).toThrow(new RegExp(String(LIVE_SEASON)));
    });
  });
});
