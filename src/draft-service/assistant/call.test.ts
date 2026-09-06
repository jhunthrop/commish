import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getDraftStore() (called by assistantCall) uses the process-wide getDb() — point it at the test
// infrastructure before any module is imported, the same idiom `api-routes.test.ts` uses.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, nflPlayers, playerCrosswalk, players, preseasonProjections, users } from "@/db/schema";
import { survivalProbabilities } from "@/projections/decide/survival";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import type { DraftState } from "@/draft-engine";
import { totalRosterSlots } from "@/draft-engine";
import * as draftServiceModule from "@/draft-service";
import { getDraftStore } from "@/draft-service";
import { seedDraftFixture } from "@/draft-service/test-support";
import { SIM_CONFIG, SIM_SHARPNESS } from "@/draft-service/sim/config";
import * as evidenceModule from "@/draft-service/sim/evidence";
import { deriveSeed } from "@/draft-service/sim/service";
import { createSimRun, hashSimConfig, markSimRunSucceeded } from "@/draft-service/sim/store";
import * as simStoreModule from "@/draft-service/sim/store";
import type { SimConfig, SimSummary } from "@/draft-service/sim/types";
import { assistantCall } from "./call";

/** Two rounds, two positions — enough rounds to reach a real "next turn" without a large fixture. */
const TWO_ROUND_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

/** One round only — every seat's only pick is also its forced last pick of the draft. */
const ONE_ROUND_SLOTS: readonly RosterSlotConfig[] = [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }];

const ASOF = new Date("2026-09-01T00:00:00.000Z");

/** Seeds the evidence board (`nfl_players` + `players` + `player_crosswalk` + `preseason_projections`)
 *  for a small closed set of players, with clean, well-separated value-over-replacement gaps so a
 *  recommendation's ranking is unambiguous regardless of the small survival/roster-fit adjustments
 *  `recommendPick` layers on top of raw value. */
async function seedEvidence(db: Db, byPosition: Readonly<Record<string, readonly { readonly id: string; readonly points: number }[]>>): Promise<void> {
  const rows = Object.entries(byPosition).flatMap(([position, entries]) =>
    entries.map((entry, index) => ({ position, ...entry, positionRank: index + 1 })),
  );
  await db.insert(nflPlayers).values(rows.map((row) => ({ id: `nfl-${row.id}`, name: row.id, position: row.position as never })));
  await db.insert(players).values(rows.map((row) => ({ id: row.id, name: row.id, position: row.position as never, nflTeam: "SF" })));
  await db.insert(playerCrosswalk).values(rows.map((row) => ({ playerId: row.id, nflPlayerId: `nfl-${row.id}`, method: "espn_id", resolvedAt: new Date() })));
  const byPointsDescending = [...rows].sort((a, b) => b.points - a.points);
  await db.insert(preseasonProjections).values(preseasonProjectionsRows(byPointsDescending));
}

// Drizzle insert helper split out only so `seedEvidence` above reads as one paragraph of intent.
function preseasonProjectionsRows(
  rows: readonly { readonly id: string; readonly position: string; readonly points: number; readonly positionRank: number }[],
) {
  return rows.map((row, index) => ({
    season: PRODUCT_SEASON,
    source: BOARD_SOURCE,
    playerId: `nfl-${row.id}`,
    rank: index + 1,
    positionRank: row.positionRank,
    projectedPoints: row.points,
    valueOverReplacement: 0,
    valueRank: index + 1,
    expectedGames: 17,
    floorPoints: 0,
    medianPoints: 0,
    ceilingPoints: 0,
    tier: 0,
    asOf: ASOF,
  }));
}

describe("assistantCall", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    // `getDraftStore()`'s replay cache is process-wide and keyed by draft id alone — a truncate
    // between tests must invalidate every id this file reuses, or a later test could replay a
    // sequence number left over from an earlier test's now-deleted rows.
    for (const draftId of ["draft_stranger", "draft_scheduled", "draft_commish", "draft_top3", "draft_noadp", "draft_last"]) {
      getDraftStore().invalidate(draftId);
    }
  });

  afterEach(() => {
    // Only the "short-circuits" describe block below ever spies on these module namespaces —
    // restoring unconditionally here is a no-op for every other test in this file, and keeps a
    // spy installed by one test from ever leaking into the next.
    vi.restoreAllMocks();
  });

  it("returns null for a signed-in stranger with no team in this league", async () => {
    await seedDraftFixture(db, {
      draftId: "draft_stranger", leagueId: "league_stranger", format: "snake", teamCount: 2,
      slotConfig: STANDARD_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await getDraftStore().startDraft("draft_stranger");
    expect(await assistantCall(db, "draft_stranger", "a-total-stranger")).toBeNull();
  });

  it("returns null before the draft has started", async () => {
    const f = await seedDraftFixture(db, {
      draftId: "draft_scheduled", leagueId: "league_scheduled", format: "snake", teamCount: 2,
      slotConfig: STANDARD_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    expect(await assistantCall(db, "draft_scheduled", f.userIds[0]!)).toBeNull();
  });

  it("returns null for a commissioner who fields no team of their own", async () => {
    const f = await seedDraftFixture(db, {
      draftId: "draft_commish", leagueId: "league_commish", format: "snake", teamCount: 2,
      slotConfig: STANDARD_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    const commissionerId = "league_commish_commish_no_team";
    await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: commissionerId });
    await db.update(leagues).set({ commissionerUserId: commissionerId }).where(eq(leagues.id, f.leagueId));
    await getDraftStore().startDraft("draft_commish");
    expect(await assistantCall(db, "draft_commish", commissionerId)).toBeNull();
  });

  describe("mid-draft, with a real next turn", () => {
    const DRAFT_ID = "draft_top3";
    const LEAGUE_ID = "league_top3";

    async function seeded() {
      const f = await seedDraftFixture(db, {
        draftId: DRAFT_ID, leagueId: LEAGUE_ID, format: "snake", teamCount: 2,
        slotConfig: TWO_ROUND_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
      });
      await seedEvidence(db, {
        QB: [
          { id: "qb1", points: 1200 },
          { id: "qb2", points: 200 },
          { id: "qb3", points: 150 },
        ],
        RB: [
          { id: "rb1", points: 10200 },
          { id: "rb2", points: 200 },
          { id: "rb3", points: 150 },
        ],
      });
      const started = await getDraftStore().startDraft(DRAFT_ID);
      if (!started.ok) throw new Error(started.reason);
      // The draft order is drawn fresh at START_DRAFT — never assume it matches `f.teamIds`'
      // own insertion order; read the real on-clock team back and map it to its user.
      const onClockUserId = f.userIds[f.teamIds.indexOf(started.state.draftOrder[0]!)]!;
      return { ...f, onClockUserId };
    }

    it("puts the two runaway-value players at the top, each carrying reasons and a live odds row", async () => {
      const { onClockUserId } = await seeded();

      const view = await assistantCall(db, DRAFT_ID, onClockUserId);
      expect(view).not.toBeNull();
      expect(view!.pickNumber).toBe(1);
      expect(view!.onTheClock).toBe(true);
      expect(view!.candidates.length).toBeGreaterThan(0);
      expect(view!.candidates.length).toBeLessThanOrEqual(3);

      // rb1 and qb1 are worth orders of magnitude more than anything else on the board — the
      // shortlist's top two spots, in that order, regardless of who fills the (much closer) third.
      const ids = view!.candidates.map((c) => c.playerId);
      expect(ids.slice(0, 2)).toEqual(["rb1", "qb1"]);

      for (const candidate of view!.candidates) {
        expect(candidate.reasons.length).toBeGreaterThan(0);
        // A real next turn exists (2 rounds, 2 teams): every candidate's odds are either a real
        // measured row, or null only because that specific measurement ended in every run.
        if (candidate.makeItBack !== null) {
          expect(candidate.makeItBack.playerId).toBe(candidate.playerId);
          expect(candidate.makeItBack.survival).not.toBeNull();
          expect(candidate.makeItBack.survival).toBeGreaterThanOrEqual(0);
          expect(candidate.makeItBack.survival).toBeLessThanOrEqual(1);
        }
      }

      expect(view!.computedBasis).toBe(ASOF.toISOString());
      // No picks made yet: classifyBuild's own honest reading of an empty roster (zero backs in
      // the first three rounds, zero quarterbacks in the first six — both technically true of
      // nothing at all).
      expect(view!.yourBuild).toEqual(["zero-RB", "late-QB"]);
    });

    it("is deterministic: two calls at the same pick return identical odds", async () => {
      const { onClockUserId } = await seeded();
      const first = await assistantCall(db, DRAFT_ID, onClockUserId);
      const second = await assistantCall(db, DRAFT_ID, onClockUserId);
      expect(second).toEqual(first);
    });

    it("no cached sim for this league means an honest null, never a fabricated build list", async () => {
      const { onClockUserId } = await seeded();
      const view = await assistantCall(db, DRAFT_ID, onClockUserId);
      expect(view!.winningBuilds).toBeNull();
    });

    it("reads a build list straight from the canonical cached sim, never triggering one of its own", async () => {
      const { onClockUserId } = await seeded(); // draftOrder[0], so this seat's slot is 1
      const shape = { teamCount: 2, rosterSlots: TWO_ROUND_SLOTS };
      const knobs = { slot: 1, rounds: totalRosterSlots(TWO_ROUND_SLOTS), runs: SIM_CONFIG.syncRunThreshold, sharpness: SIM_SHARPNESS.mixed };
      const config: SimConfig = { ...shape, ...knobs, seed: deriveSeed(shape, { leagueId: LEAGUE_ID, ...knobs }) };
      const summary: SimSummary = {
        runs: knobs.runs, teamCount: 2, slot: 1, rounds: knobs.rounds, baselineTop3Rate: 0.5,
        builds: [{ label: "hero-RB", runsWithLabel: 40, top3FinishRate: 0.6 }],
        availability: [], exposure: [], meanFinishRank: 4, elapsedMs: 12,
      };
      await createSimRun(db, { id: "cached-run", userId: onClockUserId, leagueId: LEAGUE_ID, config, configHash: hashSimConfig(config), boardGeneration: ASOF.toISOString() });
      await markSimRunSucceeded(db, "cached-run", summary);

      const view = await assistantCall(db, DRAFT_ID, onClockUserId);
      expect(view!.winningBuilds).toEqual(summary.builds);
    });
  });

  describe("a board the market has never priced, quarterbacks on top of raw points", () => {
    const DRAFT_ID = "draft_noadp";
    const LEAGUE_ID = "league_noadp";

    /**
     * THE FOUNDER'S OWN BUG (2026-09-05) pointed at the Assistant. With no ADP anywhere, survival
     * is priced off the fallback rank, and the fallback has to be the VALUE rank. Two teams
     * starting one quarterback and one back:
     *
     *   QB replacement is qb2's 296, so qb1 is worth 4, qb2 0, qb3 -4.
     *   RB replacement is rb2's 120, so rb1 is worth 160, rb2 0, rb3 -60.
     *
     * Value order: rb1, qb1, qb2, rb2, qb3, rb3. Raw points order: qb1, qb2, qb3, rb1, rb2, rb3.
     * The two disagree about who leads the queue, which is the whole question.
     */
    async function seeded() {
      const f = await seedDraftFixture(db, {
        draftId: DRAFT_ID, leagueId: LEAGUE_ID, format: "snake", teamCount: 2,
        slotConfig: TWO_ROUND_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
      });
      await seedEvidence(db, {
        QB: [
          { id: "qb1", points: 300 },
          { id: "qb2", points: 296 },
          { id: "qb3", points: 292 },
        ],
        RB: [
          { id: "rb1", points: 280 },
          { id: "rb2", points: 120 },
          { id: "rb3", points: 60 },
        ],
      });
      const started = await getDraftStore().startDraft(DRAFT_ID);
      if (!started.ok) throw new Error(started.reason);
      return f.userIds[f.teamIds.indexOf(started.state.draftOrder[0]!)]!;
    }

    it("prices survival off the value rank, never off a rank by raw points", async () => {
      const view = await assistantCall(db, DRAFT_ID, await seeded());
      const survivalOf = (playerId: string): number | null => {
        const reasons = view!.candidates.find((c) => c.playerId === playerId)?.reasons ?? [];
        const reason = reasons.find((r) => r.code === "will_not_survive" || r.code === "safe_to_wait");
        return reason === undefined ? null : reason.survivalProbability;
      };

      // `averageDraftPosition` falls back to each player's 0-based VALUE rank, so this is the
      // exact board `survivalProbabilities` queues off. Reproduced here from the arithmetic in
      // the docblock above rather than read back out of the code under test.
      const expected = survivalProbabilities({
        board: [
          { playerId: "rb1", position: "RB", averageDraftPosition: 0 },
          { playerId: "qb1", position: "QB", averageDraftPosition: 1 },
          { playerId: "qb2", position: "QB", averageDraftPosition: 2 },
          { playerId: "rb2", position: "RB", averageDraftPosition: 3 },
          { playerId: "qb3", position: "QB", averageDraftPosition: 4 },
          { playerId: "rb3", position: "RB", averageDraftPosition: 5 },
        ],
        fromPick: 1,
        toPick: 4,
      });

      // rb1 leads our board, so HE is the one who will not last to pick 4. Ranked by raw points
      // the top quarterback would have led the queue and worn this reason instead, which is the
      // bug: he is the most points on the board and nowhere near the most value.
      expect(survivalOf("rb1")).toBeCloseTo(expected.get("rb1")!, 10);
      expect(view!.candidates.find((c) => c.playerId === "rb1")!.reasons.map((r) => r.code)).toContain("will_not_survive");
      expect(view!.candidates.find((c) => c.playerId === "qb1")!.reasons.map((r) => r.code)).not.toContain("will_not_survive");
      expect(survivalOf("qb1")).toBeNull(); // second in the queue: neither doomed nor safe to wait
    });
  });

  describe("a forced last pick — no next turn exists at all", () => {
    it("nulls every candidate's make-it-back odds, never a fabricated survival number", async () => {
      const f = await seedDraftFixture(db, {
        draftId: "draft_last", leagueId: "league_last", format: "snake", teamCount: 2,
        slotConfig: ONE_ROUND_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
      });
      await seedEvidence(db, {
        QB: [
          { id: "qb1", points: 500 },
          { id: "qb2", points: 200 },
          { id: "qb3", points: 150 },
        ],
      });
      const started = await getDraftStore().startDraft("draft_last");
      if (!started.ok) throw new Error(started.reason);
      const onClockUserId = f.userIds[f.teamIds.indexOf(started.state.draftOrder[0]!)]!;

      const view = await assistantCall(db, "draft_last", onClockUserId);
      expect(view).not.toBeNull();
      expect(view!.pickNumber).toBe(1);
      expect(view!.onTheClock).toBe(true);
      expect(view!.candidates.length).toBeGreaterThan(0);
      for (const candidate of view!.candidates) {
        expect(candidate.makeItBack).toBeNull();
      }
    });
  });

  describe("short-circuits before either remaining DB read when the asking seat has no further turn", () => {
    /**
     * Review fix (Task 12): the `assistantCallCore` extraction moved this guard BEHIND
     * `evidencePoolFor`/`findCachedRun` — a real regression, since a seat with no turn left to
     * advise now paid for two Postgres reads it used to skip entirely. `askingWindow`'s own
     * docblock notes this state is "defensive only" in an ORDINARY snake draft (every in-progress
     * draft owes every seat at least one more pick, by `totalPickCount`'s own construction) — so
     * rather than chase an unreachable-in-practice real draft into this state, this stubs
     * `getDraftStore`/`resolveDraftActor` (the same `@/draft-service` module namespace `call.ts`
     * itself imports from, spied the identical way `adp-snapshot-job.test.ts` already spies on a
     * sibling module) to hand `assistantCall` a hand-built `DraftState` whose `pickNumber` already
     * sits past `totalPickCount` while `phase` stays `"in_progress"` — an internally consistent
     * `DraftState` for `askingWindow` to read, however it came to exist. The actual assertion is
     * `evidencePoolFor`/`findCachedRun` are NEVER CALLED — the one fact the pre-refactor ordering
     * guaranteed and the regression broke.
     */
    const GUARD_TEAM_ID = "team_guard_test";
    const GUARD_SLOTS: readonly RosterSlotConfig[] = [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }];

    function stateWithNoFurtherTurn(): DraftState {
      return {
        config: {
          draftId: "draft_guard_test",
          leagueId: "league_guard_test",
          format: "snake",
          kickoffAt: "2026-09-10T17:00:00.000Z",
          auctionBudget: null,
          slotConfig: GUARD_SLOTS,
          clockSchedule: [],
        },
        phase: "in_progress",
        sequence: 1,
        draftOrder: [GUARD_TEAM_ID, "team_guard_other"],
        pool: [],
        picks: [],
        rosters: {},
        budgets: {},
        queues: {},
        owedPicks: {},
        auction: null,
        // `totalPickCount` for this config is 2 (2 teams x 1 round) — comfortably past it, so
        // `askingWindow`'s own forward scan finds no match for either team and returns null.
        pickNumber: 999,
        turnStartedAt: null,
      };
    }

    it("never reads the evidence board or a cached sim run", async () => {
      const evidenceSpy = vi.spyOn(evidenceModule, "evidencePoolFor");
      const findCachedRunSpy = vi.spyOn(simStoreModule, "findCachedRun");
      vi.spyOn(draftServiceModule, "resolveDraftActor").mockResolvedValue({
        ok: true,
        actor: { draftId: "draft_guard_test", leagueId: "league_guard_test", userId: "user_guard_test", teamId: GUARD_TEAM_ID, isCommissioner: false },
      });
      vi.spyOn(draftServiceModule, "getDraftStore").mockReturnValue({
        getDraftState: vi.fn().mockResolvedValue(stateWithNoFurtherTurn()),
      } as unknown as ReturnType<typeof draftServiceModule.getDraftStore>);

      const view = await assistantCall(db, "draft_guard_test", "user_guard_test");

      expect(view).toBeNull();
      expect(evidenceSpy).not.toHaveBeenCalled();
      expect(findCachedRunSpy).not.toHaveBeenCalled();
    });
  });
});
