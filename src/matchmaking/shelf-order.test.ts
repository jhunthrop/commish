import { describe, expect, it } from "vitest";
import type { PublicLeagueSummary } from "./contract";
import { featuredFillingLeague, featuredLeagueId, soonestJoinableOrder, sortBySoonestJoinableDraft } from "./shelf-order";

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

/**
 * THE FEATURED ROOM (the doors-and-rooms fix round, 2026-09-10). The board's one solid verb and
 * its amber wash ride the fullest filling room, and a kickoff that has ROLLED no longer
 * disqualifies one — see `fullestFillingLeague`'s docblock for the ruling.
 */
describe("featuredFillingLeague (the board's one solid verb)", () => {
  it("features the fullest room that has somebody in it", () => {
    const board = [summary({ id: "empty" }), summary({ id: "half", filledTeams: 6 }), summary({ id: "nearly", filledTeams: 11 })];
    expect(featuredFillingLeague(board)?.id).toBe("nearly");
  });

  it("features a room whose kickoff has rolled — a roll is a fact about the DATE, which the row shows current", () => {
    // The old rule excluded any rolled `scheduled` league, which on a shelf where rooms roll
    // until they fill meant NO row ever wore the verb and the board read as nine identical
    // outline pills. A room that rolled is still the room closest to firing.
    const rolled = summary({ id: "rolled", filledTeams: 11, startTrigger: "scheduled", kickoffRolls: 3 });
    const looser = summary({ id: "looser", filledTeams: 4 });
    expect(featuredFillingLeague([looser, rolled])?.id).toBe("rolled");
  });

  it("never features an untouched room — an empty lobby is not a room that is filling", () => {
    expect(featuredFillingLeague([summary({ id: "a" }), summary({ id: "b" })])).toBeNull();
    expect(featuredFillingLeague([])).toBeNull();
  });

  it("breaks a fullness tie by the sooner chosen draft", () => {
    const later = summary({ id: "later", filledTeams: 9, startTrigger: "scheduled", draftAtIso: "2026-09-14T19:00:00.000Z" });
    const sooner = summary({ id: "sooner", filledTeams: 9, startTrigger: "scheduled", draftAtIso: "2026-09-12T19:00:00.000Z" });
    expect(featuredFillingLeague([later, sooner])?.id).toBe("sooner");
  });

  it("breaks a remaining tie by the room with a claim in flight — the most recent claim the wire can see", () => {
    // `PublicLeagueSummary` carries no claim timestamp (and would not: a per-claim instant is a
    // fact about a PERSON acting, which that contract's boundary refuses). A held seat IS a
    // claim happening right now, so it is the honest stand-in for "most recently claimed".
    const quiet = summary({ id: "quiet", filledTeams: 9 });
    const claiming = summary({ id: "claiming", filledTeams: 9, heldSeats: 1 });
    expect(featuredFillingLeague([quiet, claiming])?.id).toBe("claiming");
  });

  it("keeps list order on a total tie, so one rendered board has one deterministic answer", () => {
    const a = summary({ id: "a", filledTeams: 9 });
    const b = summary({ id: "b", filledTeams: 9 });
    expect(featuredFillingLeague([a, b])?.id).toBe("a");
    expect(featuredFillingLeague([b, a])?.id).toBe("b");
  });

  it("agrees with featuredLeagueId whenever anything is genuinely filling", () => {
    const board = [summary({ id: "empty" }), summary({ id: "nearly", filledTeams: 11 })];
    expect(featuredLeagueId(board)).toBe(featuredFillingLeague(board)?.id);
  });

  it("falls back to the tightest room for featuredLeagueId alone when nothing is filling", () => {
    const board = [summary({ id: "wide", teamCount: 12 }), summary({ id: "narrow", teamCount: 8 })];
    expect(featuredLeagueId(board)).toBe("narrow");
    expect(featuredFillingLeague(board)).toBeNull();
  });
});
