import { describe, it, expect } from "vitest";
import { DRAFT_QUEUE_CONFIG, DRAFT_SKIP_POLICY, PERSISTED_QUEUE_MAX } from "./config";
import { clientDraftActionSchema, clientQueueSchema, draftActionSchema, toDraftAction, toSetQueueAction } from "./action-schema";

describe("draftActionSchema (persisted jsonb boundary)", () => {
  it("accepts a v1 MAKE_PICK row", () => {
    const row = { v: 1, type: "MAKE_PICK", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerId: "p1" };
    expect(draftActionSchema.parse(row)).toEqual(row);
  });

  it("accepts a v1 START_DRAFT row with its order and pool", () => {
    const row = {
      v: 1,
      type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY,
      timestamp: "2026-09-01T00:00:00.000Z",
      draftOrder: ["t1", "t2"],
      pool: [{ playerId: "p1", position: "QB" }],
    };
    expect(draftActionSchema.parse(row)).toEqual(row);
  });

  it("leaves a persisted START_DRAFT row with no skipPolicy WITHOUT one, rather than handing an old draft today's allowance", () => {
    // Final whole-branch review, F3. This used to assert the opposite — that a pre-Task-5 row
    // parsed to `DRAFT_SKIP_POLICY` — which is exactly the drift: `reduceSnakeExpiry` folds a
    // `TIMER_EXPIRE` into an autopick or a skip depending on this value, so defaulting it
    // replayed a draft that autopicked as one that skipped, and changed the reconstructed roster.
    // The replay proof itself lives in `replay.test.ts` ("a pre-Task-5 log autopicks").
    const row = {
      v: 1,
      type: "START_DRAFT", minBid: 1,
      timestamp: "2026-09-01T00:00:00.000Z",
      draftOrder: ["t1", "t2"],
      pool: [{ playerId: "p1", position: "QB" }],
    };
    expect(draftActionSchema.parse(row)).toEqual(row);
    expect(draftActionSchema.parse(row)).not.toHaveProperty("skipPolicy");
  });

  it("accepts a v1 SET_QUEUE row", () => {
    const row = { v: 1, type: "SET_QUEUE", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerIds: ["p1", "p2"] };
    expect(draftActionSchema.parse(row)).toEqual(row);
  });

  it("rejects an unknown version — old rows are never silently reinterpreted", () => {
    const row = { v: 2, type: "MAKE_PICK", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerId: "p1" };
    expect(draftActionSchema.safeParse(row).success).toBe(false);
  });

  it("rejects a SET_QUEUE row with an unknown version", () => {
    const row = { v: 2, type: "SET_QUEUE", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerIds: ["p1"] };
    expect(draftActionSchema.safeParse(row).success).toBe(false);
  });

  it("rejects an unknown action type", () => {
    expect(draftActionSchema.safeParse({ v: 1, type: "TRADE", timestamp: "2026-09-01T00:00:00.000Z" }).success).toBe(false);
  });

  it("rejects a non-positive bid", () => {
    const row = { v: 1, type: "BID", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", amount: 0 };
    expect(draftActionSchema.safeParse(row).success).toBe(false);
  });

  it("rejects a non-ISO timestamp — a string that would Date.parse to NaN must never bypass the R-B4 deadline guard", () => {
    const row = { v: 1, type: "MAKE_PICK", timestamp: "not-a-real-timestamp", teamId: "t1", playerId: "p1" };
    expect(draftActionSchema.safeParse(row).success).toBe(false);
  });
});

describe("clientDraftActionSchema (HTTP body boundary)", () => {
  it("accepts a pick submission", () => {
    expect(clientDraftActionSchema.parse({ type: "MAKE_PICK", playerId: "p1" })).toEqual({ type: "MAKE_PICK", playerId: "p1" });
  });

  it("defaults a nomination's opening bid to the configured minimum", () => {
    expect(clientDraftActionSchema.parse({ type: "NOMINATE", playerId: "p1" })).toEqual({ type: "NOMINATE", playerId: "p1", openingBid: 1 });
  });

  it("ignores a client-supplied teamId — the server always resolves the team from the session", () => {
    const parsed = clientDraftActionSchema.parse({ type: "MAKE_PICK", playerId: "p1", teamId: "someone_elses_team" });
    expect(parsed).not.toHaveProperty("teamId");
  });

  it("refuses TIMER_EXPIRE from a client — only the server ticker may expire a clock", () => {
    expect(clientDraftActionSchema.safeParse({ type: "TIMER_EXPIRE" }).success).toBe(false);
  });

  it("refuses START_DRAFT from the actions endpoint", () => {
    expect(clientDraftActionSchema.safeParse({ type: "START_DRAFT" }).success).toBe(false);
  });
});

describe("clientQueueSchema (HTTP body boundary for POST /api/drafts/:draftId/queue)", () => {
  it("accepts a ranked list of player ids", () => {
    expect(clientQueueSchema.parse({ playerIds: ["p1", "p2"] })).toEqual({ playerIds: ["p1", "p2"] });
  });

  it("accepts an empty list, as a way to clear the queue", () => {
    expect(clientQueueSchema.parse({ playerIds: [] })).toEqual({ playerIds: [] });
  });

  it("rejects a list longer than the configured maximum", () => {
    const tooMany = Array.from({ length: DRAFT_QUEUE_CONFIG.maxLength + 1 }, (_, i) => `p${i}`);
    expect(clientQueueSchema.safeParse({ playerIds: tooMany }).success).toBe(false);
  });
});

describe("the frozen persisted-queue ceiling", () => {
  it("never sits below the client-tunable maxLength — lowering the tunable must never break replay of older rows", () => {
    expect(DRAFT_QUEUE_CONFIG.maxLength).toBeLessThanOrEqual(PERSISTED_QUEUE_MAX);
  });

  it("accepts a persisted SET_QUEUE row up to the frozen ceiling, even beyond today's client-submission maximum", () => {
    const playerIds = Array.from({ length: PERSISTED_QUEUE_MAX }, (_, i) => `p${i}`);
    const row = { v: 1, type: "SET_QUEUE", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerIds };
    expect(draftActionSchema.safeParse(row).success).toBe(true);
  });

  it("rejects a persisted SET_QUEUE row longer than the frozen ceiling", () => {
    const playerIds = Array.from({ length: PERSISTED_QUEUE_MAX + 1 }, (_, i) => `p${i}`);
    const row = { v: 1, type: "SET_QUEUE", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerIds };
    expect(draftActionSchema.safeParse(row).success).toBe(false);
  });
});

describe("toDraftAction (stamps the server-resolved teamId and timestamp)", () => {
  it("stamps a MAKE_PICK", () => {
    expect(toDraftAction({ type: "MAKE_PICK", playerId: "p1" }, "team_1", "2026-09-01T00:00:00.000Z")).toEqual({
      v: 1,
      type: "MAKE_PICK",
      timestamp: "2026-09-01T00:00:00.000Z",
      teamId: "team_1",
      playerId: "p1",
    });
  });

  it("stamps a NOMINATE", () => {
    expect(toDraftAction({ type: "NOMINATE", playerId: "p1", openingBid: 5 }, "team_1", "2026-09-01T00:00:00.000Z")).toEqual({
      v: 1,
      type: "NOMINATE",
      timestamp: "2026-09-01T00:00:00.000Z",
      teamId: "team_1",
      playerId: "p1",
      openingBid: 5,
    });
  });

  it("stamps a BID", () => {
    expect(toDraftAction({ type: "BID", amount: 10 }, "team_1", "2026-09-01T00:00:00.000Z")).toEqual({
      v: 1,
      type: "BID",
      timestamp: "2026-09-01T00:00:00.000Z",
      teamId: "team_1",
      amount: 10,
    });
  });
});

describe("toSetQueueAction (stamps the server-resolved teamId and timestamp for a queue edit)", () => {
  it("stamps a SET_QUEUE", () => {
    expect(toSetQueueAction(["p1", "p2"], "team_1", "2026-09-01T00:00:00.000Z")).toEqual({
      v: 1,
      type: "SET_QUEUE",
      timestamp: "2026-09-01T00:00:00.000Z",
      teamId: "team_1",
      playerIds: ["p1", "p2"],
    });
  });
});
