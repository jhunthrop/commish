import { describe, expect, it } from "vitest";
import type { Position } from "@research-ts/domain/player";
import type { SimSummary } from "@/draft-service/sim/types";
import { sheetHealth, type SheetHealthEntry } from "./health";

const SIM: SimSummary = {
  runs: 100,
  teamCount: 12,
  slot: 1,
  rounds: 15,
  baselineTop3Rate: 0.25,
  builds: [
    { label: "hero-RB", runsWithLabel: 40, top3FinishRate: 0.4 },
    { label: "zero-RB", runsWithLabel: 20, top3FinishRate: 0.1 },
    { label: "robust-RB", runsWithLabel: 30, top3FinishRate: 0.3 },
    { label: "early-TE", runsWithLabel: 5, top3FinishRate: 0.6 },
    { label: "late-QB", runsWithLabel: 60, top3FinishRate: 0.28 },
  ],
  availability: [],
  exposure: [],
  meanFinishRank: 6,
  elapsedMs: 1,
};

function entry(playerId: string, position: Position, overrides: Partial<SheetHealthEntry> = {}): SheetHealthEntry {
  return { playerId, name: playerId, position, tag: null, boardRank: null, ...overrides };
}

describe("sheetHealth", () => {
  it("classifies the sheet's own first six entries as a hypothetical draft", () => {
    const entries = [entry("p1", "RB"), entry("p2", "WR"), entry("p3", "WR"), entry("p4", "TE"), entry("p5", "RB"), entry("p6", "WR")];
    const report = sheetHealth(entries, SIM, 12);
    expect(report.buildLabels).toContain("hero-RB");
    expect(report.buildLabels).toContain("late-QB");
  });

  it("only ever compares against labels the sheet itself earned", () => {
    const entries = [entry("p1", "RB"), entry("p2", "RB"), entry("p3", "RB")];
    const report = sheetHealth(entries, SIM, 12);
    expect(report.buildLabels).toEqual(["robust-RB", "late-QB"]);
    expect(report.comparisons.map((c) => c.label).sort()).toEqual(["late-QB", "robust-RB"]);
    expect(report.comparisons.every((c) => c.sentence.length > 0)).toBe(true);
  });

  it("flags a NEVER-tagged player the evidence board ranks inside the realistic early range", () => {
    const entries = [entry("p1", "RB", { tag: "never", boardRank: 5, name: "Never Guy" })];
    const report = sheetHealth(entries, SIM, 12);
    expect(report.neverDraftFlags).toEqual([{ playerId: "p1", name: "Never Guy", boardRank: 5 }]);
  });

  it("never flags a NEVER-tagged player ranked well outside the early range", () => {
    const entries = [entry("p1", "RB", { tag: "never", boardRank: 500 })];
    expect(sheetHealth(entries, SIM, 12).neverDraftFlags).toEqual([]);
  });

  it("never flags a player with no board rank at all", () => {
    const entries = [entry("p1", "RB", { tag: "never", boardRank: null })];
    expect(sheetHealth(entries, SIM, 12).neverDraftFlags).toEqual([]);
  });

  it("never flags a TARGET or AVOID tag, only NEVER", () => {
    const entries = [entry("p1", "RB", { tag: "target", boardRank: 1 }), entry("p2", "WR", { tag: "avoid", boardRank: 2 })];
    expect(sheetHealth(entries, SIM, 12).neverDraftFlags).toEqual([]);
  });

  it("an empty sheet earns the neutral zero-RB/late-QB labels and flags nothing", () => {
    const report = sheetHealth([], SIM, 12);
    expect(report.buildLabels).toEqual(["zero-RB", "late-QB"]);
    expect(report.neverDraftFlags).toEqual([]);
  });
});
