import { describe, expect, it } from "vitest";
import { pickLabel } from "@/domain/pick-label";
import { normalizeSentence } from "@/capsules/narrative-slots";
import { teamOnClock } from "@/draft-engine";
import { advisorCore } from "./advisor";
import { ADVISOR_CONFIG } from "./config";
import { FIXTURE_SHAPE, FIXTURE_TEAM_IDS, fixtureAdvance, fixtureNames, fixtureStart, fixtureValued } from "./test-fixture";
import type { AdvisorView } from "./view";

const ASKING = FIXTURE_TEAM_IDS[3]!;

function viewAfter(picks: number): AdvisorView {
  const state = fixtureAdvance(fixtureStart(), picks);
  const view = advisorCore({
    state,
    askingTeamId: ASKING,
    valued: fixtureValued(),
    shape: FIXTURE_SHAPE,
    seedNamespace: "advisor-test",
    winningBuilds: null,
    computedBasis: "a replayed room",
    names: fixtureNames(),
    runs: 30,
  });
  if (view === null) throw new Error("expected a view");
  return view;
}

const BANNED_PUNCTUATION = /[—;]/;

describe("advisorCore", () => {
  it("stamps the view with the pick and sequence it was computed at, and says whether you are on the clock", () => {
    const state = fixtureAdvance(fixtureStart(), 3);
    expect(teamOnClock(state)).toBe(ASKING);
    const view = viewAfter(3);
    expect(view.onTheClock).toBe(true);
    expect(view.picksUntilYourTurn).toBe(0);
    expect(view.stamp).toEqual({ computedAtPick: 4, sequence: state.sequence });
    expect(view.teamCount).toBe(10);
    expect(pickLabel(view.stamp.computedAtPick, view.teamCount)).toBe("1.04");
  });

  it("counts the picks until your turn when you are not on the clock", () => {
    const view = viewAfter(12); // pick 13 is up; seat 4 next at 17
    expect(view.onTheClock).toBe(false);
    expect(view.pickNumber).toBe(17);
    expect(view.picksUntilYourTurn).toBe(4);
  });

  it("ranks five candidates for now, each with a slot, a value, odds with their run count, and a reason built from its own facts", () => {
    const view = viewAfter(3);
    expect(view.now).toHaveLength(ADVISOR_CONFIG.now.shortlistSize);
    for (const candidate of view.now) {
      expect(candidate.fillsSlot).not.toBeNull();
      expect(candidate.positionRank).toBeGreaterThan(0);
      expect(candidate.makeItBack).not.toBeNull();
      expect(candidate.makeItBack!.runs).toBeGreaterThan(0);
      expect(candidate.templateReason).toContain(view.names[candidate.playerId]!);
      expect(candidate.templateReason).not.toMatch(BANNED_PUNCTUATION);
      expect(candidate.templateReason).not.toMatch(/last man/i);
    }
  });

  it("never puts two identical sentences on one card", () => {
    const view = viewAfter(3);
    const sentences = [view.strategyTemplate, ...view.now.map((candidate) => candidate.templateReason)].map(normalizeSentence);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it("writes a strategy note of at most two sentences from the plan and the signals, with no banned punctuation", () => {
    const view = viewAfter(12);
    expect(view.strategyTemplate.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(2);
    expect(view.strategyTemplate).not.toMatch(BANNED_PUNCTUATION);
    const firstTurn = view.plan.turns[0]!;
    expect(view.strategyTemplate).toContain(pickLabel(firstTurn.pickNumber, view.teamCount));
  });

  it("carries the plan, the signals and a voice that is honestly absent until the writer runs", () => {
    const view = viewAfter(12);
    expect(view.plan.turns.length).toBeGreaterThan(0);
    expect(view.plan.runs).toBe(30);
    expect(view.signals.ahead).toHaveLength(4);
    expect(view.voice).toEqual({ status: "absent", strategy: null, reasons: {} });
  });

  it("puts every number the card states on the ledger, and every name", () => {
    const view = viewAfter(12);
    const ledger = new Set(view.ledger.numbers);
    for (const candidate of view.now) {
      expect(ledger.has(candidate.valueOverReplacement)).toBe(true);
      expect(ledger.has(candidate.makeItBack!.survival)).toBe(true);
      expect(ledger.has(candidate.makeItBack!.runs)).toBe(true);
      expect(view.ledger.names).toContain(view.names[candidate.playerId]!);
    }
    for (const turn of view.plan.turns) {
      expect(ledger.has(turn.pickNumber)).toBe(true);
      for (const target of turn.targets) for (const cell of target.oddsByTurn) if (cell !== null) expect(ledger.has(cell.survival)).toBe(true);
    }
    for (const seat of view.signals.ahead) expect(view.ledger.names).toContain(`Seat ${seat.seat}`);
  });

  it("is reproducible for the same room state", () => {
    expect(viewAfter(12)).toEqual(viewAfter(12));
  });

  it("recomputes on a new pick: the stamp and the plan move with the room", () => {
    const a = viewAfter(12);
    const b = viewAfter(13);
    expect(b.stamp.sequence).toBeGreaterThan(a.stamp.sequence);
    expect(b.stamp.computedAtPick).toBe(a.stamp.computedAtPick + 1);
    expect(b.picksUntilYourTurn).toBe(a.picksUntilYourTurn - 1);
  });
});
