import { describe, expect, it } from "vitest";
import type { HomeLeagueCard, MatchupSummary } from "../contract";
import { homeCard } from "../test-fixtures";
import { orderByUrgency, railPageLine, railStateFor, railStateLine, needsYouKindFor } from "./rail-line";

const BASE: HomeLeagueCard = homeCard({
  name: "Sunday Money",
  teamCount: 12,
  filledTeams: 12,
  record: { wins: 8, losses: 6, ties: 0 },
  weekNumber: 4,
  myTeamName: "Bay Bandits Team",
  myRank: 4,
});

function matchup(overrides: Partial<MatchupSummary> = {}): MatchupSummary {
  return {
    weekNumber: 4,
    homeTeamId: "t1",
    awayTeamId: "t2",
    homeTeamName: "Bay Bandits Team",
    awayTeamName: "Mudville Nine",
    homeScore: null,
    awayScore: null,
    final: false,
    weekStatus: "scheduled",
    ...overrides,
  };
}

describe("railStateFor", () => {
  it("needs-you for exactly the two kinds the attention set has always meant", () => {
    expect(railStateFor("fix-lineup", "scheduled")).toBe("needs-you");
    expect(railStateFor("join-draft", "scheduled")).toBe("needs-you");
  });
  it("live for an in-progress week that does not need the manager", () => {
    expect(railStateFor("watch-scores", "in_progress")).toBe("live");
    expect(railStateFor(undefined, "in_progress")).toBe("live");
  });
  it("quiet for everything else, including no action at all", () => {
    expect(railStateFor("review-week", "final")).toBe("quiet");
    expect(railStateFor(undefined, "scheduled")).toBe("quiet");
  });
});

describe("needsYouKindFor", () => {
  it("names the kind for the two needs-you kinds and null for the rest", () => {
    expect(needsYouKindFor("fix-lineup")).toBe("fix-lineup");
    expect(needsYouKindFor("join-draft")).toBe("join-draft");
    expect(needsYouKindFor("watch-scores")).toBeNull();
    expect(needsYouKindFor(undefined)).toBeNull();
  });
});

describe("orderByUrgency", () => {
  const quiet = { ...BASE, id: "l_quiet", name: "Quiet" };
  const quietTwo = { ...BASE, id: "l_quiet2", name: "Quiet II" };
  const live: HomeLeagueCard = { ...BASE, id: "l_live", name: "Live", weekStatus: "in_progress", nextAction: { kind: "watch-scores", label: "Watch the scores" } };
  const fix: HomeLeagueCard = { ...BASE, id: "l_fix", name: "Fix", nextAction: { kind: "fix-lineup", label: "Fix your lineup" }, lineupSet: false };
  const draft: HomeLeagueCard = { ...BASE, id: "l_draft", name: "Draft", draftStatus: "in_progress", nextAction: { kind: "join-draft", label: "Join the draft" } };

  it("orders needs-you first (a live draft before a lineup fix), live second, quiet last", () => {
    const ordered = orderByUrgency([quiet, live, fix, draft]);
    expect(ordered.map((league) => league.id)).toEqual(["l_draft", "l_fix", "l_live", "l_quiet"]);
  });

  it("keeps the input order within a tier — the stable secondary order", () => {
    const ordered = orderByUrgency([quietTwo, quiet, live]);
    expect(ordered.map((league) => league.id)).toEqual(["l_live", "l_quiet2", "l_quiet"]);
  });

  it("returns a new array and never mutates its input", () => {
    const input = [quiet, live];
    const ordered = orderByUrgency(input);
    expect(input.map((league) => league.id)).toEqual(["l_quiet", "l_live"]);
    expect(ordered).not.toBe(input);
  });
});

describe("railStateLine", () => {
  it("a needs-you league speaks its own action's words", () => {
    const fix: HomeLeagueCard = { ...BASE, nextAction: { kind: "fix-lineup", label: "Fix your lineup" }, lineupSet: false };
    expect(railStateLine(fix, "shell")).toBe("Fix your lineup");
    expect(railStateLine(fix, "rich")).toBe("Fix your lineup");
  });

  it("a live league degrades to 'Live now' in the shell tier — no margin without the score cache", () => {
    const live: HomeLeagueCard = {
      ...BASE,
      weekStatus: "in_progress",
      matchup: matchup({ homeScore: 84.2, awayScore: 71.6, weekStatus: "in_progress" }),
    };
    expect(railStateLine(live, "shell")).toBe("Live now");
  });

  it("a live league with both scores speaks the margin in the rich tier, from the manager's seat", () => {
    const leading: HomeLeagueCard = {
      ...BASE,
      weekStatus: "in_progress",
      matchup: matchup({ homeScore: 84.2, awayScore: 71.6, weekStatus: "in_progress" }),
    };
    expect(railStateLine(leading, "rich")).toBe("Live · you lead 84.20 to 71.60");
    const trailing: HomeLeagueCard = {
      ...BASE,
      myTeamId: "t2",
      weekStatus: "in_progress",
      matchup: matchup({ homeScore: 84.2, awayScore: 71.6, weekStatus: "in_progress" }),
    };
    expect(railStateLine(trailing, "rich")).toBe("Live · you trail 71.60 to 84.20");
  });

  it("a live tie says so, and missing scores stay 'Live now' even in the rich tier", () => {
    const tied: HomeLeagueCard = {
      ...BASE,
      weekStatus: "in_progress",
      matchup: matchup({ homeScore: 80, awayScore: 80, weekStatus: "in_progress" }),
    };
    expect(railStateLine(tied, "rich")).toBe("Live · tied at 80.00");
    const scoreless: HomeLeagueCard = { ...BASE, weekStatus: "in_progress", matchup: matchup({ weekStatus: "in_progress" }) };
    expect(railStateLine(scoreless, "rich")).toBe("Live now");
  });

  it("a scheduled draft names its kickoff, and a when-full draft its trigger", () => {
    const dated: HomeLeagueCard = { ...BASE, draftStatus: "scheduled", startTrigger: "scheduled", kickoffAt: "2026-09-10T20:30:00.000Z", record: null, myRank: null };
    expect(railStateLine(dated, "shell")).toBe("Drafts Thursday 10 September, 8:30 PM UTC");
    const whenFull: HomeLeagueCard = { ...dated, startTrigger: "when_full" };
    expect(railStateLine(whenFull, "shell")).toBe("Drafts when the room fills");
  });

  it("a quiet league gets its standing and next fixture — no filler", () => {
    const quiet: HomeLeagueCard = { ...BASE, matchup: matchup() };
    expect(railStateLine(quiet, "shell")).toBe("4th of 12 · next: vs Mudville Nine");
  });

  it("a quiet league on a settled week states the result beside the standing", () => {
    const won: HomeLeagueCard = {
      ...BASE,
      weekStatus: "final",
      matchup: matchup({ homeScore: 101.2, awayScore: 88.4, final: true, weekStatus: "final" }),
    };
    expect(railStateLine(won, "shell")).toBe("4th of 12 · won 101.20 to 88.40");
    const lost: HomeLeagueCard = { ...won, myTeamId: "t2" };
    expect(railStateLine(lost, "shell")).toBe("4th of 12 · lost 88.40 to 101.20");
  });

  it("a quiet league with no standing speaks its real next action, else its seat fact", () => {
    const invite: HomeLeagueCard = { ...BASE, record: null, myRank: null, filledTeams: 8, nextAction: { kind: "invite-managers", label: "Invite managers" } };
    expect(railStateLine(invite, "shell")).toBe("Invite managers");
    const bare: HomeLeagueCard = { ...BASE, record: null, myRank: null, filledTeams: 8, nextAction: null };
    expect(railStateLine(bare, "shell")).toBe("8 of 12 seats filled");
  });

  it("the page line trades a needs-you row's verb words for its facts — the button beside it already says the act", () => {
    const fix: HomeLeagueCard = {
      ...BASE,
      matchup: matchup(),
      nextAction: { kind: "fix-lineup", label: "Fix your lineup" },
      lineupSet: false,
    };
    expect(railPageLine(fix)).toBe("4th of 12 · next: vs Mudville Nine");
    // A pre-draft join-draft league has no honest standing (a 0-0 rank says nothing), so the
    // action words stand — the same sentence twice beats an invented one.
    const drafting: HomeLeagueCard = { ...BASE, draftStatus: "in_progress", record: null, myRank: null, nextAction: { kind: "join-draft", label: "Join the draft" } };
    expect(railPageLine(drafting)).toBe("Join the draft");
    // Everything not needs-you reads exactly the rich tier.
    const live: HomeLeagueCard = { ...BASE, weekStatus: "in_progress", matchup: matchup({ homeScore: 84.2, awayScore: 71.6, weekStatus: "in_progress" }) };
    expect(railPageLine(live)).toBe("Live · you lead 84.20 to 71.60");
  });

  it("never emits an em-dash in any line", () => {
    const leagues: readonly HomeLeagueCard[] = [
      BASE,
      { ...BASE, weekStatus: "in_progress", matchup: matchup({ homeScore: 1, awayScore: 2, weekStatus: "in_progress" }) },
      { ...BASE, draftStatus: "scheduled", startTrigger: "when_full" },
    ];
    for (const league of leagues) {
      expect(railStateLine(league, "shell")).not.toMatch(/—/);
      expect(railStateLine(league, "rich")).not.toMatch(/—/);
    }
  });
});
