import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@research-ts/db/schema";
import { draftGrades, leagues, memberNotices } from "@/db/schema";
import { currentDeadline, DRAFT_SKIP_POLICY } from "@/draft-engine";
import type { DraftAction } from "@research-ts/domain/draft";
import { createDraftStore, type DraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import type { MemberNotice } from "@/integrity-service/notify";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { parseDraftGradesJobPayload, runDraftGradesJobStep } from "./draft-grades-job";

const db: Db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };
const publish = async () => "1-0";
const deliverNoticeFake = async () => {};
const GENERATION = new Date("2026-08-01T00:00:00.000Z");

/** One player per position per team slot, so a 2-team `SPRINT_ROSTER_SLOTS` draft always fills —
 *  the identical fixture `commit.test.ts` uses for the same reason. */
const POOL_ROWS = [
  { id: "qb1", name: "QB One", position: "QB" as const, nflTeam: "KC" },
  { id: "qb2", name: "QB Two", position: "QB" as const, nflTeam: "SF" },
  { id: "rb1", name: "RB One", position: "RB" as const, nflTeam: "KC" },
  { id: "rb2", name: "RB Two", position: "RB" as const, nflTeam: "SF" },
  { id: "wr1", name: "WR One", position: "WR" as const, nflTeam: "KC" },
  { id: "wr2", name: "WR Two", position: "WR" as const, nflTeam: "SF" },
];
const SPRINT_POOL = POOL_ROWS.map((p) => ({ playerId: p.id, position: p.position }));

async function fixture(overrides: { readonly draftId: string; readonly leagueId: string; readonly draftGradesVisible?: boolean }) {
  const f = await seedDraftFixture(db, {
    draftId: overrides.draftId,
    leagueId: overrides.leagueId,
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
  await db.insert(players).values(POOL_ROWS);
  if (overrides.draftGradesVisible === false) {
    await db.update(leagues).set({ draftGradesVisible: false }).where(eq(leagues.id, overrides.leagueId));
  }
  return f;
}

/** One board row per `POOL_ROWS` player, all under the same generation stamp, so the job's own
 *  `evidencePoolFor(db)` read (default `asOf: new Date()`) finds every drafted player valued. */
async function seedEvidenceBoard(): Promise<void> {
  let rank = 1;
  for (const player of POOL_ROWS) {
    const nflId = `nfl_${player.id}`;
    await db.insert(nflPlayers).values({ id: nflId, name: player.name, position: player.position });
    await db.insert(playerCrosswalk).values({ playerId: player.id, nflPlayerId: nflId, method: "espn_id", resolvedAt: new Date() });
    const points = 300 - rank * 10;
    await db.insert(preseasonProjections).values({
      season: PRODUCT_SEASON,
      source: BOARD_SOURCE,
      playerId: nflId,
      rank,
      positionRank: 1,
      projectedPoints: points,
      valueOverReplacement: points,
      valueRank: rank,
      expectedGames: 17,
      floorPoints: points - 20,
      medianPoints: points,
      ceilingPoints: points + 20,
      tier: 0,
      asOf: GENERATION,
      momentKind: "live",
    });
    rank += 1;
  }
}

const start = (teamIds: readonly string[]): DraftAction => ({
  v: 1, type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, timestamp: clock.now(), draftOrder: teamIds, pool: SPRINT_POOL,
});

/** Runs a snake draft to completion on the clock alone — every pick lands via `TIMER_EXPIRE`,
 *  the identical harness `commit.test.ts`'s own `runOnTheClock` uses, which is what makes the
 *  real store commit `draft_picks`/`roster_slots` and set `drafts.status = 'complete'`. */
async function completeDraft(store: DraftStore, draftId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const state = await store.getDraftState(draftId);
    if (state === null || state.phase === "complete") return;
    const result = await store.applyAction(draftId, { v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state) ?? clock.now() });
    if (!result.ok) throw new Error(result.reason);
  }
  throw new Error("draft did not finish");
}

async function seedCompletedDraft(draftId: string, leagueId: string, options: { readonly draftGradesVisible?: boolean } = {}) {
  const store = createDraftStore({ db, publish, clock, deliverNotice: deliverNoticeFake });
  const f = await fixture({ draftId, leagueId, draftGradesVisible: options.draftGradesVisible });
  await seedEvidenceBoard();
  await store.applyAction(draftId, start(f.teamIds));
  await completeDraft(store, draftId);
  return f;
}

describe("draft grades job", () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("parses a well-formed payload and rejects a malformed one", () => {
    expect(parseDraftGradesJobPayload({ draftId: "draft-1" })).toEqual({ draftId: "draft-1" });
    expect(() => parseDraftGradesJobPayload({})).toThrow();
    expect(() => parseDraftGradesJobPayload({ draftId: 5 })).toThrow();
  });

  it("throws a terminal error for a drafts row that does not exist", async () => {
    await expect(runDraftGradesJobStep(db, { draftId: "missing" })).rejects.toThrow(/no drafts row/);
  });

  it("throws a terminal error for a draft that has not completed yet", async () => {
    const f = await fixture({ draftId: "draft_pending", leagueId: "league_pending" });
    await expect(runDraftGradesJobStep(db, { draftId: f.draftId })).rejects.toThrow(/is not complete/);
  });

  it("writes one row per team, with a letter and the board's own generation stamp, and notifies every seated member", async () => {
    const f = await seedCompletedDraft("draft_1", "league_1");

    const outcome = await runDraftGradesJobStep(db, { draftId: f.draftId });
    expect(outcome.summary).toContain("2 team grades written");
    expect(outcome.summary).toContain("2 members notified");

    const rows = await db.select().from(draftGrades).where(eq(draftGrades.draftId, f.draftId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.teamId).sort()).toEqual([...f.teamIds].sort());
    for (const row of rows) {
      expect(["A", "B", "C", "D"]).toContain(row.letter);
      expect(row.boardGeneration).toBe(GENERATION.toISOString());
      expect(row.leagueId).toBe(f.leagueId);
    }

    const notices = await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "draft_grades_ready"));
    expect(notices).toHaveLength(2);
    expect(notices.map((n) => n.userId).sort()).toEqual([...f.userIds].sort());
    expect(notices[0]!.body).toBe("Draft grades are up on your league home. Every grade shows its work.");
  });

  // The fix for the review's Important finding: every other leagueful notice site in this
  // codebase calls `deliverNotice` after its write transaction commits (`store.ts`,
  // `trades.ts`, `auto-lineup.ts`, `fill-trigger.ts`) so a member sitting on their league home
  // gets a live nudge, not just a row they see on their next poll. This job must too.
  it("delivers a live notice to every seated member after the write commits", async () => {
    const f = await seedCompletedDraft("draft_deliver_1", "league_deliver_1");
    const delivered: MemberNotice[] = [];
    const deliver = async (notice: MemberNotice) => {
      delivered.push(notice);
    };

    const outcome = await runDraftGradesJobStep(db, { draftId: f.draftId }, { deliver });

    expect(outcome.summary).toContain("2 members notified");
    expect(delivered).toHaveLength(2);
    expect(delivered.map((n) => n.userId).sort()).toEqual([...f.userIds].sort());
    for (const notice of delivered) {
      expect(notice.noticeType).toBe("draft_grades_ready");
      expect(notice.leagueId).toBe(f.leagueId);
    }
    // Every delivered notice is the SAME row `member_notices` holds, not a re-derived copy.
    const stored = await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "draft_grades_ready"));
    expect(delivered.map((n) => n.id).sort()).toEqual(stored.map((n) => n.id).sort());
  });

  it("never delivers, and never fails the job, when the opted-out league sends no notices", async () => {
    const f = await seedCompletedDraft("draft_deliver_2", "league_deliver_2", { draftGradesVisible: false });
    const delivered: MemberNotice[] = [];
    const deliver = async (notice: MemberNotice) => {
      delivered.push(notice);
    };

    await runDraftGradesJobStep(db, { draftId: f.draftId }, { deliver });
    expect(delivered).toHaveLength(0);
  });

  it("swallows a delivery failure rather than failing the job — the row already committed", async () => {
    const f = await seedCompletedDraft("draft_deliver_3", "league_deliver_3");
    const deliver = async () => {
      throw new Error("redis is down");
    };

    const outcome = await runDraftGradesJobStep(db, { draftId: f.draftId }, { deliver });
    expect(outcome.summary).toContain("2 members notified");

    const rows = await db.select().from(draftGrades).where(eq(draftGrades.draftId, f.draftId));
    expect(rows).toHaveLength(2);
    const notices = await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "draft_grades_ready"));
    expect(notices).toHaveLength(2);
  });

  it("is idempotent on re-run: no duplicate rows and no duplicate notices", async () => {
    const f = await seedCompletedDraft("draft_2", "league_2");

    await runDraftGradesJobStep(db, { draftId: f.draftId });
    const replay = await runDraftGradesJobStep(db, { draftId: f.draftId });
    expect(replay.summary).toContain("already computed");

    const rows = await db.select().from(draftGrades).where(eq(draftGrades.draftId, f.draftId));
    expect(rows).toHaveLength(2);
    const notices = await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "draft_grades_ready"));
    expect(notices).toHaveLength(2);
  });

  it("still writes every team's row for an opted-out league, but sends no notices", async () => {
    const f = await seedCompletedDraft("draft_3", "league_3", { draftGradesVisible: false });

    const outcome = await runDraftGradesJobStep(db, { draftId: f.draftId });
    expect(outcome.summary).toContain("2 team grades written");
    expect(outcome.summary).toContain("0 members notified");

    const rows = await db.select().from(draftGrades).where(eq(draftGrades.draftId, f.draftId));
    expect(rows).toHaveLength(2);
    const notices = await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "draft_grades_ready"));
    expect(notices).toHaveLength(0);
  });
});
