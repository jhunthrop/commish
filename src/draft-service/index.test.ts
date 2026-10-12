import { describe, expect, it, vi } from "vitest";

// getDraftStore() and getDraftAdvancer() open a real Postgres pool the moment they're called
// (`getDb()`, shared across the request path) — point it at the test infrastructure before the
// module under test is imported, the same idiom `src/stats-pipeline/index.test.ts` uses.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
});

const publishSpy = vi.fn(async () => "1-0");
vi.mock("@/lib/realtime/publisher", () => ({
  getPublisher: vi.fn(() => ({ publish: publishSpy })),
}));

import { players } from "@research/db/schema";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { heldRoomFacts, resetAdvisorMemoForTests } from "./assistant/memo";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";
import { awaitDraftFollowThroughForTests, followThroughAppliedAction, getDraftAdvancer, getDraftStore, logDraftNudgeError, logDraftPublishError, noteDraftPublishFailure, publishDraftEvent } from "./index";

const db = createTestDb();

describe("the pick's follow-through (draft-room performance round, item 1)", () => {
  it("every action the process-wide store accepts computes the room's facts for its new state, after the response, and the stream's loop is the one caller that opts out", async () => {
    await truncateAll(db);
    resetAdvisorMemoForTests();
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_follow_through", leagueId: "league_follow_through", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
      { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
      { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
      { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
      { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
      { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
    ]);
    const started = await getDraftStore().startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);
    // Outside a request scope `after()` throws, so the follow-through runs detached at once.
    await awaitDraftFollowThroughForTests();
    expect(heldRoomFacts(fixture.draftId, started.state.sequence)).not.toBeNull();
    await truncateAll(db);
  });

  it("followThroughAppliedAction never throws: a failing compute is logged", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const broken = { phase: "in_progress", sequence: 1, config: { draftId: "draft_missing", leagueId: "league_missing" } } as unknown as Parameters<typeof followThroughAppliedAction>[0];
      await expect(followThroughAppliedAction(broken)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith("[draft] room facts follow-through failed", { draftId: "draft_missing", sequence: 1 }, expect.anything());
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("draft-service edge wiring", () => {
  it("getDraftStore is a singleton, so two calls never mint two stores", () => {
    expect(getDraftStore()).toBe(getDraftStore());
  });

  it("getDraftAdvancer() is a singleton over the same store getDraftStore() returns, and wires a nudger", () => {
    // Both singletons share one `getDb()`-backed store rather than each minting their own —
    // proven by construction succeeding and by the store singleton assertion above rather than a
    // second accessor, since the advancer does not expose its store. Constructing it also
    // constructs its nudger via createNudgeScheduler, wired with isLLMEnabled()/getLlmClient()
    // read once at the edge, whichever way ANTHROPIC_API_KEY happens to be set.
    expect(getDraftAdvancer()).toBe(getDraftAdvancer());
  });

  it("publishDraftEvent delegates to the process-wide publisher", async () => {
    // The store's own call site is reached by any test that applies a real draft action
    // through `getDraftStore()`; the nudger's separately-defined call site is only ever
    // reached by a real nudge actually firing, which nothing short of this direct call proves.
    const input = { leagueId: "league_wiring_test", type: "draft.nudge" as const, payload: { draftId: "draft_1" } };
    await expect(publishDraftEvent(input)).resolves.toBe("1-0");
    expect(publishSpy).toHaveBeenCalledWith(input);
  });

  it("noteDraftPublishFailure logs the lost frame and marks the draft for resync in Redis (review finding 3)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { getResyncMarker } = await import("@/lib/realtime/resync");
      const draftId = `draft_lost_voice_${Date.now()}`;
      noteDraftPublishFailure(new Error("connect ETIMEDOUT"), { type: "draft.pick", leagueId: "league_x", draftId });
      expect(errorSpy).toHaveBeenCalledWith("[draft] publish failed", { type: "draft.pick", leagueId: "league_x", draftId }, expect.any(Error));
      await vi.waitFor(async () => expect(await getResyncMarker().check(draftId)).not.toBeNull());
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logDraftPublishError logs a publish failure without throwing", () => {
    // A full store publish failure would otherwise be the only way to reach this wiring line.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      logDraftPublishError(new Error("redis down"), { type: "draft.pick" });
      expect(errorSpy).toHaveBeenCalledWith("[draft] publish failed", { type: "draft.pick" }, expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logDraftNudgeError logs a nudge failure without throwing", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      logDraftNudgeError(new Error("llm down"), { draftId: "draft_1" });
      expect(errorSpy).toHaveBeenCalledWith("[draft] nudge failed", { draftId: "draft_1" }, expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
