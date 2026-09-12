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
      href: "/app/mock-drafts?create=solo",
    });
  });

  it("falls back to the room for an in-season league with nothing owed", () => {
    expect(verbFor(homeCard({ weekStatus: "final" }))).toEqual({ label: "Open the room", href: "/app/leagues/l1" });
  });
});

describe("momentLine speaks in the league's voice", () => {
  it("names the opponent and states the only lock clock this product owns", () => {
    const line = momentLine(homeCard({ weekNumber: 4, matchup: MATCHUP, opponentManagerName: "Rey Okafor" }));
    expect(line).toBe("Week 4, you play Rey. Lineups lock when week 4 starts.");
  });

  it("falls back to the opponent's TEAM when their seat does not resolve to a person", () => {
    expect(opponentOf(homeCard({ matchup: MATCHUP }))).toBe("Iron Owls");
  });

  it("omits the opponent clause entirely on a bye", () => {
    expect(momentLine(homeCard({ weekNumber: 6 }))).toBe("Week 6. Lineups lock when week 6 starts.");
  });

  it("says a filling room's own count and its fill trigger", () => {
    const line = momentLine(homeCard({ draftStatus: "scheduled", startTrigger: "when_full", teamCount: 12, filledTeams: 1, slotsRanked: true }));
    expect(line).toBe("Filling, 1 of 12. Drafts when full.");
  });

  it("names the draft's day and, when they are unranked, says the slots are not ranked yet", () => {
    const line = momentLine(homeCard({ draftStatus: "scheduled", startTrigger: "scheduled", kickoffAt: "2026-09-13T13:55:00.000Z" }));
    expect(line).toBe("Drafts Sunday. Your draft slots are not ranked yet.");
  });

  it("says you pick Nth only once the draw has actually given a slot", () => {
    expect(momentLine(homeCard({ draftStatus: "in_progress" }))).toBe("Your draft is running.");
    expect(momentLine(homeCard({ draftStatus: "in_progress", assignedSlot: 4 }))).toBe("Your draft is running. You pick 4th.");
  });
});

describe("figureFor prints one number and what it is", () => {
  it("prints the record and the week it is after", () => {
    expect(figureFor(homeCard({ record: { wins: 2, losses: 1, ties: 0 } }))).toEqual({ value: "2-1", basis: "your record, after week 3" });
  });

  it("holds a dash, with the reason, before a league has played anything", () => {
    expect(figureFor(homeCard({ record: { wins: 0, losses: 0, ties: 0 } }))).toEqual({ value: null, basis: "no games played yet" });
  });

  it("prints the seats to go for a filling room, singular at one", () => {
    expect(figureFor(homeCard({ draftStatus: "scheduled", startTrigger: "when_full", teamCount: 12, filledTeams: 1 }))).toEqual({
      value: "11",
      basis: "seats to go, of 12",
    });
    expect(figureFor(homeCard({ draftStatus: "scheduled", startTrigger: "when_full", teamCount: 12, filledTeams: 11 }))).toEqual({
      value: "1",
      basis: "seat to go, of 12",
    });
  });

  it("prints the distance to a scheduled draft over the exact instant it is measured to", () => {
    expect(
      figureFor(homeCard({ draftStatus: "scheduled", startTrigger: "scheduled", kickoffAt: "2026-09-13T13:55:00.000Z", kickoffRelative: "in 2 days" })),
    ).toEqual({ value: "In 2 days", basis: "Sunday 13 September, 1:55 PM UTC" });
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
