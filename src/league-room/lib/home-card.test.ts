import { describe, expect, it } from "vitest";
import { homeCard } from "../test-fixtures";
import { figureFor, isOwed, momentLine, needFor, opponentOf, orderByNeed, stackCaption, verbFor, type HomeCardNeed } from "./home-card";

const MATCHUP = {
  weekNumber: 4,
  homeTeamId: "t1",
  awayTeamId: "t2",
  homeTeamName: "Bay Bandits",
  awayTeamName: "Iron Owls",
  homeScore: null,
  awayScore: null,
  final: false,
  weekStatus: "scheduled" as const,
};

describe("needFor names the one thing a league is owed", () => {
  it("puts a running draft above everything", () => {
    expect(needFor(homeCard({ draftStatus: "in_progress" }))).toBe("draft-running");
  });

  it("calls an in-season week with an unset lineup an open one-time task", () => {
    expect(needFor(homeCard({ lineupSet: false, weekStatus: "scheduled" }))).toBe("lineup-unset");
  });

  it("calls an unranked pre-draft league an open one-time task, and a ranked one idle", () => {
    expect(needFor(homeCard({ draftStatus: "scheduled", slotsRanked: false }))).toBe("slots-unranked");
    expect(needFor(homeCard({ draftStatus: "scheduled", slotsRanked: true }))).toBe("idle");
  });

  it("calls a live week live, and a settled league idle", () => {
    expect(needFor(homeCard({ weekStatus: "in_progress" }))).toBe("live");
    expect(needFor(homeCard({ weekStatus: "final" }))).toBe("idle");
  });

  it("marks only the open one-time tasks as owed", () => {
    const owed: readonly HomeCardNeed[] = ["draft-running", "lineup-unset", "slots-unranked"];
    expect(owed.every(isOwed)).toBe(true);
    expect(isOwed("live")).toBe(false);
    expect(isOwed("idle")).toBe(false);
  });
});

describe("orderByNeed puts what needs this manager first, stably", () => {
  it("orders a running draft, an empty lineup, unranked slots, a live week, then the rest", () => {
    const cards = [
      homeCard({ id: "idle" }),
      homeCard({ id: "live", weekStatus: "in_progress" }),
      homeCard({ id: "slots", draftStatus: "scheduled" }),
      homeCard({ id: "lineup", lineupSet: false }),
      homeCard({ id: "draft", draftStatus: "in_progress" }),
    ];
    expect(orderByNeed(cards).map((card) => card.id)).toEqual(["draft", "lineup", "slots", "live", "idle"]);
  });

  it("keeps the input order among equals and never mutates the input", () => {
    const cards = [homeCard({ id: "a" }), homeCard({ id: "b" }), homeCard({ id: "c" })];
    expect(orderByNeed(cards).map((card) => card.id)).toEqual(["a", "b", "c"]);
    expect(cards.map((card) => card.id)).toEqual(["a", "b", "c"]);
  });
});

describe("verbFor gives an open one-time task ahead of Open the room", () => {
  it("sends a running draft into the draft room, in the words the server already put on the card", () => {
    const card = homeCard({ draftStatus: "in_progress", nextAction: { kind: "join-draft", label: "Join the draft" } });
    expect(verbFor(card)).toEqual({ label: "Join the draft", href: "/app/drafts/d1" });
  });

  it("sends an unset lineup to the editor", () => {
    expect(verbFor(homeCard({ lineupSet: false }))).toEqual({ label: "Set your lineup", href: "/app/leagues/l1/team#lineup" });
  });

  it("sends unranked slots to the room that holds the ranking panel", () => {
    expect(verbFor(homeCard({ draftStatus: "scheduled" }))).toEqual({ label: "Rank your draft slots", href: "/app/leagues/l1" });
  });

  it("offers a mock draft when a pre-draft league owes nothing", () => {
    expect(verbFor(homeCard({ draftStatus: "scheduled", slotsRanked: true }))).toEqual({
      label: "Run a mock draft",
      href: "/app/draft/mock-drafts?create=solo",
    });
  });

  it("falls back to the room for an in-season league with nothing owed", () => {
    expect(verbFor(homeCard({ weekStatus: "final" }))).toEqual({ label: "Open the room", href: "/app/leagues/l1" });
  });
});

describe("momentLine speaks in the league's voice", () => {
  it("names the opponent and states the only lock clock this product owns", () => {
    const line = momentLine(homeCard({ weekNumber: 4, matchup: MATCHUP, opponentManagerName: "Rey Okafor" }), null);
    expect(line).toBe("Week 4, you play Rey. Lineups lock when week 4 starts.");
  });

  it("falls back to the opponent's TEAM when their seat does not resolve to a person", () => {
    expect(opponentOf(homeCard({ matchup: MATCHUP }))).toBe("Iron Owls");
  });

  it("omits the opponent clause entirely on a bye", () => {
    expect(momentLine(homeCard({ weekNumber: 6 }), null)).toBe("Week 6. Lineups lock when week 6 starts.");
  });

  it("says a filling room's own count and its fill trigger", () => {
    const line = momentLine(homeCard({ draftStatus: "scheduled", startTrigger: "when_full", teamCount: 12, filledTeams: 1, slotsRanked: true }), null);
    expect(line).toBe("Filling, 1 of 12. Drafts when full.");
  });

  it("names the draft's day and, when they are unranked, says the slots are not ranked yet", () => {
    const line = momentLine(homeCard({ draftStatus: "scheduled", startTrigger: "scheduled", kickoffAt: "2026-09-13T13:55:00.000Z" }), null);
    expect(line).toBe("Drafts Sunday. Your draft slots are not ranked yet.");
  });

  it("says you pick Nth only once the draw has actually given a slot", () => {
    expect(momentLine(homeCard({ draftStatus: "in_progress" }), null)).toBe("Your draft is running.");
    expect(momentLine(homeCard({ draftStatus: "in_progress", assignedSlot: 4 }), null)).toBe("Your draft is running. You pick 4th.");
  });
});

describe("figureFor prints one number and what it is", () => {
  it("prints the record and the week it is after", () => {
    expect(figureFor(homeCard({ record: { wins: 2, losses: 1, ties: 0 } }), null)).toEqual({ value: "2-1", basis: "your record, after week 3" });
  });

  it("holds a dash, with the reason, before a league has played anything", () => {
    expect(figureFor(homeCard({ record: { wins: 0, losses: 0, ties: 0 } }), null)).toEqual({ value: null, basis: "no games played yet" });
  });

  it("prints the seats to go for a filling room, singular at one", () => {
    expect(figureFor(homeCard({ draftStatus: "scheduled", startTrigger: "when_full", teamCount: 12, filledTeams: 1 }), null)).toEqual({
      value: "11",
      basis: "seats to go, of 12",
    });
    expect(figureFor(homeCard({ draftStatus: "scheduled", startTrigger: "when_full", teamCount: 12, filledTeams: 11 }), null)).toEqual({
      value: "1",
      basis: "seat to go, of 12",
    });
  });

  it("prints the distance to a scheduled draft over the exact instant it is measured to", () => {
    expect(
      figureFor(homeCard({ draftStatus: "scheduled", startTrigger: "scheduled", kickoffAt: "2026-09-13T13:55:00.000Z", kickoffRelative: "in 2 days" }), null),
    ).toEqual({ value: "In 2 days", basis: "Sunday 13 September, 1:55 PM UTC" });
  });
});

/**
 * FIX ROUND 1, HIGH 3. A kickoff at 01:55 UTC on Sunday the 13th begins Saturday EVENING on the
 * American west coast. The card used to print a UTC weekday with no zone word beside a UTC-
 * labelled date, so a Pacific manager read "Drafts Sunday" for a draft that starts on their
 * Saturday. Both halves take the same clock now, so the day and the date are derived from one
 * zone and can never disagree with each other.
 */
describe("the draft day and date are the READER's, and always name their zone", () => {
  const NEAR_MIDNIGHT = "2026-09-13T01:55:00.000Z";
  const card = homeCard({
    draftStatus: "scheduled",
    startTrigger: "scheduled",
    kickoffAt: NEAR_MIDNIGHT,
    kickoffRelative: "in 2 days",
    slotsRanked: true,
  });
  const pacific = { nowMs: Date.parse("2026-09-11T00:00:00.000Z"), locale: "en-US", timeZone: "America/Los_Angeles" };
  const london = { nowMs: Date.parse("2026-09-11T00:00:00.000Z"), locale: "en-GB", timeZone: "Europe/London" };

  it("says Sunday in UTC and Saturday on the Pacific coast, for the one instant", () => {
    expect(momentLine(card, null)).toBe("Drafts Sunday.");
    expect(momentLine(card, pacific)).toBe("Drafts Saturday.");
  });

  it("names the zone in the figure's basis in every branch, never an unlabelled time", () => {
    expect(figureFor(card, null).basis).toBe("Sunday 13 September, 1:55 AM UTC");
    expect(figureFor(card, pacific).basis).toBe("Saturday 12 September, 6:55 PM PDT");
    expect(figureFor(card, london).basis).toContain("BST");
  });

  it("never lets the weekday and the date disagree, in either zone", () => {
    for (const clock of [null, pacific, london]) {
      const day = momentLine(card, clock).replace(/^Drafts /, "").replace(/\.$/, "");
      expect(figureFor(card, clock).basis).toContain(day);
    }
  });

  it("holds the server render and the hydrating render to one string: both pass a null clock", () => {
    // `useReaderClock` returns `null` on the server AND on the client's first render, so this IS
    // the hydration contract, asserted rather than assumed.
    expect(momentLine(card, null)).toBe(momentLine(card, null));
    expect(figureFor(card, null).basis).toBe(figureFor(card, null).basis);
  });
});

/**
 * FIX ROUND 2, the founder's screenshot of production `/app` with three of his own filling
 * leagues: every one of them printed "Starting now" as its big number for a draft that was not
 * starting. A room that is not full does not draft at its scheduled instant — it ROLLS
 * (`nextKickoffAfter`, and the front door says so out loud in `rollBandConsequence`), so a
 * filling room's stored kickoff is a time already abandoned once per roll.
 */
describe("a filling room says seats, never a clock", () => {
  const PAST = "2026-09-01T00:00:00.000Z";
  const filling = homeCard({
    draftStatus: "scheduled",
    startTrigger: "scheduled",
    teamCount: 12,
    filledTeams: 3,
    kickoffAt: PAST,
    kickoffRelative: "starting now",
    slotsRanked: true,
    record: null,
    myRank: null,
  });
  const full = { ...filling, filledTeams: 12 };
  const fullAhead = { ...full, kickoffRelative: "in 2 days", kickoffAt: "2026-09-15T01:55:00.000Z" };

  it("ignores a PAST kickoff entirely while a seat is open", () => {
    expect(momentLine(filling, null)).toBe("Filling, 3 of 12. Drafts when full.");
    expect(figureFor(filling, null)).toEqual({ value: "9", basis: "seats to go, of 12" });
    // The defect, named: a past instant must never reach the card as a time.
    expect(figureFor(filling, null).value).not.toBe("Starting now");
    expect(momentLine(filling, null)).not.toContain("Starting now");
  });

  it("says Starting now, and offers the draft, only once the room is FULL", () => {
    expect(needFor(full)).toBe("draft-starting");
    expect(isOwed(needFor(full))).toBe(true);
    expect(momentLine(full, null)).toBe("Starting now.");
    // The one true number for a room whose seats stopped mattering: how full it is.
    expect(figureFor(full, null)).toEqual({ value: "12", basis: "seats filled, of 12" });
    expect(verbFor(full)).toEqual({ label: "Join the draft", href: "/app/drafts/d1" });
  });

  it("names the day, with the date as the number, for a full room whose time is still ahead", () => {
    expect(momentLine(fullAhead, null)).toBe("Drafts Tuesday.");
    expect(figureFor(fullAhead, null)).toEqual({ value: "In 2 days", basis: "Tuesday 15 September, 1:55 AM UTC" });
    // Not the starting-now verb: the room is full but its clock has not come.
    expect(verbFor(fullAhead).label).toBe("Run a mock draft");
  });

  it("puts a room that is starting above every other open task but a draft already running", () => {
    const ordered = orderByNeed([homeCard({ id: "lineup", lineupSet: false }), { ...full, id: "starting" }]);
    expect(ordered.map((card) => card.id)).toEqual(["starting", "lineup"]);
  });

  it("says the room is full without naming a clock it does not have, for a when_full room", () => {
    const whenFull = { ...full, startTrigger: "when_full" as const, kickoffRelative: null };
    expect(momentLine(whenFull, null)).toBe("The room is full. Drafts any minute.");
  });
});

describe("stackCaption names the people beside the faces", () => {
  it("puts the reader first and counts the rest", () => {
    const members = [
      { userId: "u1", name: "Justin Hunthrop", avatar: null, isSelf: true },
      { userId: "u2", name: "Rey Okafor", avatar: null, isSelf: false },
      { userId: "u3", name: "Dana Whitfield", avatar: null, isSelf: false },
      { userId: "u4", name: "Coach Parker", avatar: null, isSelf: false },
      ...Array.from({ length: 8 }, (_, index) => ({ userId: `x${index}`, name: `Manager ${index}`, avatar: null, isSelf: false })),
    ];
    expect(stackCaption(homeCard({ members }))).toBe("You, Rey, Dana, Coach and 8 more are in.");
  });

  it("says an empty room in the second person rather than reporting a zero", () => {
    expect(stackCaption(homeCard({ members: [{ userId: "u1", name: "Justin Hunthrop", avatar: null, isSelf: true }] }))).toBe(
      "You are in. Nobody else yet.",
    );
  });

  it("joins a short room without an overflow count", () => {
    const members = [
      { userId: "u1", name: "Justin Hunthrop", avatar: null, isSelf: true },
      { userId: "u2", name: "Rey Okafor", avatar: null, isSelf: false },
    ];
    expect(stackCaption(homeCard({ members }))).toBe("You and Rey are in.");
  });
});
