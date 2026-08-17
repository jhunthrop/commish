import { describe, it, expect } from "vitest";
import { clientDraftActionSchema, draftActionSchema, toDraftAction } from "./action-schema";

describe("draftActionSchema (persisted jsonb boundary)", () => {
  it("accepts a v1 MAKE_PICK row", () => {
    const row = { v: 1, type: "MAKE_PICK", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerId: "p1" };
    expect(draftActionSchema.parse(row)).toEqual(row);
  });

  it("accepts a v1 START_DRAFT row with its order and pool", () => {
    const row = {
      v: 1,
      type: "START_DRAFT",
      timestamp: "2026-09-01T00:00:00.000Z",
      draftOrder: ["t1", "t2"],
      pool: [{ playerId: "p1", position: "QB" }],
    };
    expect(draftActionSchema.parse(row)).toEqual(row);
  });

  it("rejects an unknown version — old rows are never silently reinterpreted", () => {
    const row = { v: 2, type: "MAKE_PICK", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerId: "p1" };
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
