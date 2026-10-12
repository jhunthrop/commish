import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research/db/schema";
import type { LlmClient } from "@/lib/llm/client";
import { createDraftStore } from "./store";
import { createDraftAdvancer } from "./advance";
import { createMockBotDriver } from "@/mock-draft-service/driver";
import { createNudgeScheduler } from "./nudge";
import { createNudgeCopy } from "./nudge-copy";
import { setTeamQueue } from "./queue";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
let now = "2026-09-01T00:00:00.000Z";
const clock = { now: () => now };

beforeEach(async () => {
  await truncateAll(db);
  now = "2026-09-01T00:00:00.000Z";
});

afterAll(async () => {
  await truncateAll(db);
});

const POOL = [
  { id: "qb1", name: "QB One", position: "QB" as const, nflTeam: "KC" },
  { id: "rb1", name: "RB One", position: "RB" as const, nflTeam: "SF" },
  { id: "wr1", name: "WR One", position: "WR" as const, nflTeam: "NYJ" },
  { id: "qb2", name: "QB Two", position: "QB" as const, nflTeam: "KC" },
  { id: "rb2", name: "RB Two", position: "RB" as const, nflTeam: "SF" },
  { id: "wr2", name: "WR Two", position: "WR" as const, nflTeam: "NYJ" },
];

/**
 * Runs one identical draft end to end under the advance funnel: the same fixture, the same queues,
 * the same clock advances — differing ONLY in whether the moderator's copy comes from a
 * model. Returns the picks, which is the whole mechanical outcome.
 */
async function runDraft(llmEnabled: boolean) {
  // Brief-test defects (documented, fixed minimally):
  //  1. `now` is shared module state and `beforeEach` only resets it once per test, but this
  //     test calls `runDraft` twice within one `it`. Without a reset here, the second run's
  //     `startDraft` timestamps the turn with whatever `now` the first run's loop left
  //     behind, so its deadline is never reached and the draft never advances past pick 1.
  //  2. `draftOrderFor` deterministically shuffles the snake order from a hash of the DRAFT
  //     ID string. The brief gives each run a different id (`draft_parity_on`/`_off`), so the
  //     two runs get genuinely different team orders — not an LLM-driven difference, just two
  //     different fixtures — and the "identical picks" assertion is comparing apples to
  //     oranges. Using the SAME draft id / league id / team ids for both runs (truncating in
  //     between, since a draft id is a primary key) makes the two runs mechanically the same
  //     draft, so the only variable left is whether the moderator's copy comes from a model.
  await truncateAll(db);
  now = "2026-09-01T00:00:00.000Z";
  const draftId = "draft_parity";
  const f = await seedDraftFixture(db, {
    draftId, leagueId: "league_parity", format: "snake", teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
  await db.insert(players).values(POOL);

  const nudges: string[] = [];
  const store = createDraftStore({ db, clock, publish: async () => "1-0" });
  const llm: LlmClient = {
    generateCompletion: vi.fn().mockResolvedValue({ text: "Clock's running — take someone!", inputTokens: 1, outputTokens: 1 }),
  };
  const advancer = createDraftAdvancer({
    db,
    store,
    mockDriver: createMockBotDriver({ db }),
    nudger: createNudgeScheduler({
      db,
      publish: async (input) => {
        nudges.push(String((input.payload as { message: string }).message));
        return "1-0";
      },
      copy: createNudgeCopy({ enabled: llmEnabled, llm }),
    }),
  });

  // Team 1 queues the pool's WORST player, so a queue-driven autopick is unmistakable.
  await setTeamQueue({ db, store, clock }, { draftId, teamId: f.teamIds[0]!, playerIds: ["wr2"] });
  await store.startDraft(draftId);

  // Advance in 2-hour steps so every turn's tick grid actually lands inside the nudge
  // window. Brief-test defect (documented, fixed minimally): the brief's 4-hour steps against
  // an 8-hour turn and a 75% (6h) threshold sample only turn boundaries (0h, 4h, 8h, …) —
  // the [6h, 8h) nudge window is never hit, so no turn is ever nudged. A 2-hour step lands
  // exactly on the threshold each turn while still covering the same 96-hour span (48 steps).
  for (let step = 0; step < 48; step++) {
    now = new Date(Date.parse("2026-09-01T00:00:00.000Z") + step * 2 * 60 * 60 * 1000).toISOString();
    await advancer.advance(draftId, now);
  }

  const state = await store.getDraftState(draftId);
  return {
    picks: (state?.picks ?? []).map((p) => ({ pickNumber: p.pickNumber, teamId: p.teamId.slice(-1), playerId: p.playerId, auto: p.auto })),
    phase: state?.phase,
    nudges,
  };
}

describe("the moderator's mechanical outcome does not depend on the LLM", () => {
  it("makes exactly the same picks with isLLMEnabled() true and false", async () => {
    const withLlm = await runDraft(true);
    const withoutLlm = await runDraft(false);

    expect(withLlm.phase).toBe("complete");
    expect(withoutLlm.phase).toBe("complete");
    expect(withLlm.picks).toEqual(withoutLlm.picks);
    // The queue won: team 1's first pick is the player it queued, not the pool's best.
    expect(withLlm.picks[0]).toMatchObject({ teamId: "1", playerId: "wr2", auto: true });

    // …and both runs really did nudge, so the parity above is not vacuous.
    expect(withLlm.nudges.length).toBeGreaterThan(0);
    expect(withLlm.nudges).not.toEqual(withoutLlm.nudges);
    expect(withoutLlm.nudges[0]).toContain("Make your pick");
  });
});
