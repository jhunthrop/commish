import { describe, expect, it } from "vitest";
import type { PublicLeagueSummary } from "./contract";
import { soonestJoinableOrder, sortBySoonestJoinableDraft } from "./shelf-order";

/** A minimal, honest summary — every field the contract requires, overridable per case. */
function summary(overrides: Partial<PublicLeagueSummary> & { readonly id: string }): PublicLeagueSummary {
  return {
    name: `League ${overrides.id}`,
    format: "snake",
    experienceTier: "experienced",
    stakeTier: 0,
    entryFeeCents: 0,
    teamCount: 12,
    filledTeams: 0,
    scoringLabel: "Half PPR",
    compositionCategory: "open",
    draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)",
    medianGame: false,
    startTrigger: "when_full",
    houseRung: null,
    heldSeats: 0,
    rosterSummary: "15 slots, 1 flex",
    playoffWeeks: [15, 16, 17],
    kickoffRolls: 0,
    ...overrides,
  };
}

describe("sortBySoonestJoinableDraft (the shelf's one sort sentence)", () => {
  it("ranks by seats remaining ascending — the room closest to full fires next, both triggers", () => {
    const wide = summary({ id: "wide", teamCount: 12, filledTeams: 2 });
    const tight = summary({ id: "tight", teamCount: 12, filledTeams: 11 });
    const mid = summary({ id: "mid", teamCount: 10, filledTeams: 5 });
    expect(sortBySoonestJoinableDraft([wide, mid, tight]).map((l) => l.id)).toEqual(["tight", "mid", "wide"]);
  });

  it("breaks a seats tie by the sooner CHOSEN kickoff", () => {
    const later = summary({ id: "later", filledTeams: 6, startTrigger: "scheduled", draftAtIso: "2026-09-06T20:00:00.000Z" });
    const sooner = summary({ id: "sooner", filledTeams: 6, startTrigger: "scheduled", draftAtIso: "2026-09-04T20:00:00.000Z" });
    expect(sortBySoonestJoinableDraft([later, sooner]).map((l) => l.id)).toEqual(["sooner", "later"]);
  });

  it("lets a chosen instant beat none on a tie — a when_full room's stored instant is a placeholder, never a choice", () => {
    const sitAndGo = summary({ id: "sitandgo", filledTeams: 6, startTrigger: "when_full", draftAtIso: "2026-09-01T00:00:00.000Z" });
    const chosen = summary({ id: "chosen", filledTeams: 6, startTrigger: "scheduled", draftAtIso: "2026-09-30T20:00:00.000Z" });
    expect(sortBySoonestJoinableDraft([sitAndGo, chosen]).map((l) => l.id)).toEqual(["chosen", "sitandgo"]);
    // The placeholder never entered the comparison at all: two when_full rooms at equal seats tie.
    expect(soonestJoinableOrder(sitAndGo, summary({ id: "other", filledTeams: 6 }))).toBe(0);
  });

  it("never outranks a genuinely tighter room with a chosen time — the kickoff is a tiebreak, not the axis", () => {
    const tightSitAndGo = summary({ id: "tight", teamCount: 12, filledTeams: 11 });
    const scheduledSoon = summary({ id: "soon", teamCount: 12, filledTeams: 3, startTrigger: "scheduled", draftAtIso: "2026-09-03T01:00:00.000Z" });
    expect(sortBySoonestJoinableDraft([scheduledSoon, tightSitAndGo]).map((l) => l.id)).toEqual(["tight", "soon"]);
  });

  it("keeps input order on a full tie and never mutates the caller's list", () => {
    const a = summary({ id: "a", filledTeams: 4 });
    const b = summary({ id: "b", filledTeams: 4 });
    const input = [a, b];
    const sorted = sortBySoonestJoinableDraft(input);
    expect(sorted.map((l) => l.id)).toEqual(["a", "b"]);
    expect(sorted).not.toBe(input);
    expect(input.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("treats a summary with no instant and an unparseable instant alike: no chosen time", () => {
    const noIso = summary({ id: "none", filledTeams: 6, startTrigger: "scheduled" });
    const garbage = summary({ id: "garbage", filledTeams: 6, startTrigger: "scheduled", draftAtIso: "not a time" });
    expect(soonestJoinableOrder(noIso, garbage)).toBe(0);
  });
});
