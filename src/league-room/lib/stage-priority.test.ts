import { describe, expect, it } from "vitest";
import { compareAttentionCards, stageFor, type RankableCard, type StageInput } from "./stage-priority";

const BASE: StageInput = {
  draftComplete: true,
  hasDraftSchedule: true,
  weekStatus: "scheduled",
  hasMyMatchup: true,
  lineupProblemCount: 0,
  actionableTradeCount: 0,
};

describe("stageFor", () => {
  it("shows the waiting room while the draft is not complete", () => {
    expect(stageFor({ ...BASE, draftComplete: false })).toBe("waiting");
  });

  it("cannot show a waiting room without a draft schedule", () => {
    expect(stageFor({ ...BASE, draftComplete: false, hasDraftSchedule: false })).toBe("pulse");
  });

  it("shows the live matchup when the week is in progress and I have one", () => {
    expect(stageFor({ ...BASE, weekStatus: "in_progress" })).toBe("live");
  });

  it("live outranks every attention card", () => {
    expect(
      stageFor({ ...BASE, weekStatus: "in_progress", lineupProblemCount: 2, actionableTradeCount: 1 }),
    ).toBe("live");
  });

  it("does not go live on a bye week without a matchup", () => {
    expect(stageFor({ ...BASE, weekStatus: "in_progress", hasMyMatchup: false })).toBe("pulse");
  });

  it("shows attention for a lineup problem", () => {
    expect(stageFor({ ...BASE, lineupProblemCount: 1 })).toBe("attention");
  });

  it("shows attention for a pending trade", () => {
    expect(stageFor({ ...BASE, actionableTradeCount: 1 })).toBe("attention");
  });

  it("rests at the pulse when nothing needs the user", () => {
    expect(stageFor(BASE)).toBe("pulse");
  });

  it("rests at the pulse when the week is final", () => {
    expect(stageFor({ ...BASE, weekStatus: "final" })).toBe("pulse");
  });
});

describe("compareAttentionCards", () => {
  const lineup = (severity: number): RankableCard => ({ kind: "lineup", severity, deadlineMs: null });
  const trade = (deadlineMs: number | null): RankableCard => ({ kind: "trade", severity: 0, deadlineMs });

  it("lineup problems always lead trades, even a soon-expiring one", () => {
    expect(compareAttentionCards(lineup(1), trade(0))).toBeLessThan(0);
    expect(compareAttentionCards(trade(0), lineup(1))).toBeGreaterThan(0);
  });

  it("ranks lineup problems by severity, empty slot first", () => {
    expect(compareAttentionCards(lineup(3), lineup(2))).toBeLessThan(0);
  });

  it("ranks trades by soonest expiry", () => {
    expect(compareAttentionCards(trade(1_000), trade(2_000))).toBeLessThan(0);
  });

  it("a trade with no deadline sorts last", () => {
    expect(compareAttentionCards(trade(5_000), trade(null))).toBeLessThan(0);
  });
});
