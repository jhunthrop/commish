import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { HomeLeagueCard } from "../contract";
import { LeagueRows } from "./league-rows";

const BASE: HomeLeagueCard = {
  id: "l_base",
  name: "Sunday Money",
  format: "snake",
  teamCount: 12,
  filledTeams: 12,
  isCommissioner: false,
  myTeamId: "t1",
  draftId: "d1",
  draftStatus: "complete",
  record: { wins: 8, losses: 6, ties: 0 },
  weekNumber: 4,
  weekStatus: "scheduled",
  matchup: {
    weekNumber: 4,
    homeTeamId: "t1",
    awayTeamId: "t2",
    homeTeamName: "Sunday Money Team",
    awayTeamName: "Mudville Nine",
    homeScore: null,
    awayScore: null,
    final: false,
    weekStatus: "scheduled",
  },
  nextAction: null,
  lineupSet: true,
  medianGame: false,
  medianScore: null,
  kickoffAt: null,
  startTrigger: null,
  kickoffRolls: 0,
  myTeamName: "Sunday Money Team",
  myRank: 4,
};

const QUIET: HomeLeagueCard = { ...BASE, id: "l_quiet", name: "Quiet Harbor" };
const FIX: HomeLeagueCard = {
  ...BASE,
  id: "l_fix",
  name: "Backyard Bandits",
  nextAction: { kind: "fix-lineup", label: "Fix your lineup" },
  lineupSet: false,
};
const SECOND_FIX: HomeLeagueCard = {
  ...BASE,
  id: "l_fix2",
  name: "Volt Kings",
  nextAction: { kind: "fix-lineup", label: "Fix your lineup" },
  lineupSet: false,
};
const LIVE: HomeLeagueCard = {
  ...BASE,
  id: "l_live",
  name: "Monday Maulers",
  weekStatus: "in_progress",
  nextAction: { kind: "watch-scores", label: "Watch the scores" },
  matchup: { ...BASE.matchup!, homeScore: 84.2, awayScore: 71.6, weekStatus: "in_progress" },
};

// Deliberately seeded in the WRONG order — quiet first — so the ordering is the component's.
const MIXED: readonly HomeLeagueCard[] = [QUIET, LIVE, FIX, SECOND_FIX];

describe("LeagueRows", () => {
  it("orders rows by urgency and draws one divider before the quiet leagues, axe-clean in both themes", async () => {
    await renderSurface(<LeagueRows leagues={MIXED} />, async ({ container }) => {
      const rows = screen.getAllByRole("listitem");
      expect(rows.map((row) => row.querySelector("a")?.getAttribute("href"))).toEqual([
        "/app/leagues/l_fix",
        "/app/leagues/l_fix2",
        "/app/leagues/l_live",
        "/app/leagues/l_quiet",
      ]);
      // The divider: exactly one row carries the heavier boundary, and it is the quiet one.
      const divided = rows.filter((row) => row.className.includes("border-t-2"));
      expect(divided).toHaveLength(1);
      expect(divided[0]!.querySelector("a")?.getAttribute("href")).toBe("/app/leagues/l_quiet");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("spends exactly ONE solid amber verb — the single most-urgent row — however many need the manager", () => {
    const { container } = render(<LeagueRows leagues={MIXED} />);
    const solids = Array.from(container.querySelectorAll("a")).filter((a) => a.className.includes("bg-accent"));
    expect(solids).toHaveLength(1);
    expect(solids[0]).toHaveAccessibleName("Fix your lineup for Backyard Bandits");
    // The second needs-you row keeps the same real words in the quiet outline.
    const second = screen.getByRole("link", { name: "Fix your lineup for Volt Kings" });
    expect(second.className).toContain("bg-transparent");
    expect(second.className).not.toContain("bg-accent");
  });

  it("gives a live row the red channel's outline verb, never a fill, with the copy's own words", () => {
    render(<LeagueRows leagues={MIXED} />);
    const watch = screen.getByRole("link", { name: "Watch the scores for Monday Maulers" });
    expect(watch.className).toContain("border-negative");
    expect(watch.className).toContain("text-negative");
    expect(watch.className).not.toContain("bg-negative");
  });

  it("gives a quiet row a plain Open affordance and its standing in the state line", () => {
    render(<LeagueRows leagues={MIXED} />);
    expect(screen.getByRole("link", { name: "Open Quiet Harbor" })).toBeInTheDocument();
    // The standing and next fixture, in words — the old board's columns folded in (law 4).
    expect(screen.getByRole("link", { name: "Quiet Harbor. 4th of 12 · next: vs Mudville Nine." })).toBeInTheDocument();
  });

  it("speaks a live row's real margin in the state line — this page's read carries the score cache", () => {
    render(<LeagueRows leagues={MIXED} />);
    expect(screen.getByRole("link", { name: "Monday Maulers. Live · you lead 84.20 to 71.60." })).toBeInTheDocument();
  });

  it("folds the record and rank into the name line, and never prints a rank twice on one row", () => {
    // A LIVE row's line is the margin, so its name detail carries record AND rank.
    const live = render(<LeagueRows leagues={[LIVE]} />);
    expect(live.container.textContent).toContain("8-6 · 4th of 12");
    live.unmount();
    // A needs-you row's LINE already carries the standing (`railPageLine`), so its name detail
    // is the record alone — the same figure never lands twice on one row.
    const { container } = render(<LeagueRows leagues={[FIX]} />);
    expect(screen.getByRole("link", { name: "Backyard Bandits. 4th of 12 · next: vs Mudville Nine." })).toBeInTheDocument();
    expect(container.textContent).toContain("8-6");
    expect(container.textContent).not.toContain("8-6 · 4th of 12");
  });

  it("renders unique monograms for colliding names, from the same rule the rail chips use", () => {
    const twins: readonly HomeLeagueCard[] = [
      { ...BASE, id: "l_dire", name: "Dire Straits" },
      { ...BASE, id: "l_dark", name: "Dark Skies" },
    ];
    const { container } = render(<LeagueRows leagues={twins} />);
    const marks = Array.from(container.querySelectorAll("span[aria-hidden]")).map((span) => span.textContent);
    expect(marks).toContain("DS");
    expect(marks).toContain("DS2");
  });
});
