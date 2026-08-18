import { describe, it, expect } from "vitest";
import * as engine from "./index";

/**
 * Nothing else in this package imports the barrel — it exists for consumers outside
 * `src/draft-engine/**` (API routes, the durable draft service). Without this test the
 * barrel is never loaded during `npm test`, so it's invisible to the coverage run despite
 * `coverage.include` naming the directory. This test's only job is to load it.
 */
describe("the draft-engine public barrel", () => {
  it("re-exports the reducer, replay, events, selectors, slotting, clock schedule, state, and config surface", () => {
    expect(engine.reduceDraft).toBeTypeOf("function");
    expect(engine.replayDraft).toBeTypeOf("function");
    expect(engine.draftEventsFor).toBeTypeOf("function");
    expect(engine.draftStateView).toBeTypeOf("function");
    expect(engine.draftClockView).toBeTypeOf("function");
    expect(engine.maxBidsFor).toBeTypeOf("function");
    expect(engine.clockTierFor).toBeTypeOf("function");
    expect(engine.DRAFT_CLOCK_SCHEDULE).toBeDefined();
    expect(engine.AUCTION_CONFIG).toBeDefined();
    expect(engine.initialDraftState).toBeTypeOf("function");
    expect(engine.totalRosterSlots).toBeTypeOf("function");
    expect(engine.rosterFor).toBeTypeOf("function");
    expect(engine.auctionOf).toBeTypeOf("function");
    expect(engine.assignSlot).toBeTypeOf("function");
    expect(engine.snakeTeamForPick).toBeTypeOf("function");
    expect(engine.roundForPick).toBeTypeOf("function");
    expect(engine.DraftReplayError).toBeTypeOf("function");
    expect(engine.tierIndexFor).toBeTypeOf("function");
    expect(engine.nextTighteningAfter).toBeTypeOf("function");
    expect(engine.hoursUntil).toBeTypeOf("function");
    expect(engine.draftedPlayerIds).toBeTypeOf("function");
    expect(engine.availablePool).toBeTypeOf("function");
    expect(engine.openSlotCount).toBeTypeOf("function");
    expect(engine.isComplete).toBeTypeOf("function");
    expect(engine.teamOnClock).toBeTypeOf("function");
    expect(engine.bestAvailableFor).toBeTypeOf("function");
    expect(engine.remainingBudget).toBeTypeOf("function");
    expect(engine.minBidFor).toBeTypeOf("function");
    expect(engine.maxBidFor).toBeTypeOf("function");
    expect(engine.currentTier).toBeTypeOf("function");
    expect(engine.currentClockSeconds).toBeTypeOf("function");
    expect(engine.currentDeadline).toBeTypeOf("function");
    expect(engine.nextTightening).toBeTypeOf("function");
    expect(engine.draftActionSchema).toBeDefined();
    expect(engine.clientDraftActionSchema).toBeDefined();
    expect(engine.DRAFT_QUEUE_CONFIG).toBeDefined();
    expect(engine.reduceSetQueue).toBeTypeOf("function");
    expect(engine.queuedEntriesFor).toBeTypeOf("function");
    expect(engine.queueFor).toBeTypeOf("function");
    expect(engine.nudgeDeadline).toBeTypeOf("function");
    expect(engine.clientQueueSchema).toBeDefined();
    expect(engine.toSetQueueAction).toBeTypeOf("function");
  });
});
