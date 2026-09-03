import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { UI_CONFIG } from "@/components/ui/config";
import { renderSurface } from "@/components/ui/test-utils";
import type { TeamStandingsRow } from "../contract";
import { ALL_CLINCHED_STANDINGS, STANDINGS } from "../test-fixtures";
import { StandingsTable } from "./standings-table";

describe("StandingsTable", () => {
  it("shows each team's record and both points columns, in both themes, axe-clean", async () => {
    await renderSurface(<StandingsTable rows={STANDINGS} myTeamId="t1" />, async ({ container }) => {
      const rows = screen.getAllByRole("row").slice(1);
      expect(within(rows[0]!).getByText("9-4")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("1,412.50".replace(",", ""))).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Step 15's audit: a standings row named the team but never showed a face. `Avatar` falls
  // back to initials with no `ownerAvatar` on the row, so the owner's initials sit beside the
  // team name rather than a blank space.
  it("puts the owner's face beside the team name", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByText("AR")).toBeInTheDocument();
  });

  // Sunday v5 (founder ruling 2026-08-28, "the UX should explain itself — we shouldn't need
  // tips"): the Record header's `InfoTip` is gone outright. "W-L-T" reads as itself.
  it("heads the record column with a plain W-L-T label, no tip", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByRole("columnheader", { name: "W-L-T" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  /**
   * The persona pass (2026-08-30) dropped the heat map's magnitude colouring from the points
   * columns — "a 2% spread painted like a blowout" — so every number in this table, the record
   * included, is plain tabular ink rather than a `Stat`.
   */
  it("keeps every number tabular so a re-sort never shifts a column's digits sideways", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByText("9-4").className).toContain("tabular-nums");
    expect(screen.getByText("1412.50").className).toContain("tabular-nums");
  });

  it("renders dense, at whatever vertical cell padding the density token carries", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    const headerCell = screen.getByRole("columnheader", { name: "Team" });
    // Gameday law 4, density is respect (2026-08-28): v3 set this at 11px, which was the
    // Sunday Standard mock's own figure and airier than a fantasy table wants. A manager on a
    // Sunday reads more rows, not calmer ones. Read from `UI_CONFIG.table` rather than pinned as a
    // literal twice over.
    const dense = `${UI_CONFIG.table.denseRowPaddingPx}px`;
    expect(headerCell).toHaveStyle({ paddingTop: dense, paddingBottom: dense });
  });

  // Law 3 (the tab loop, 2026-08-30): the sport's own "x-" clinch notation replaces the column
  // of identical "Clinched" pills, printed inline before the team name.
  it("marks the clinched teams with the x- notation, and the caller's own row", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByText("x-")).toBeInTheDocument();
    expect(screen.getByText("Bay Bandits").closest("tr")).toHaveAttribute("data-own", "true");
  });

  // Law 4, the amber rail: the caller's own row carries the accent border, and no other row does.
  it("renders the amber rail on the caller's own row only", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByText("Bay Bandits").closest("tr")!.className).toContain("border-l-accent");
    expect(screen.getByText("Iron Owls").closest("tr")!.className).not.toContain("border-l-accent");
  });

  // Law 1 and law 2: the rank numeral leads, and the movement column states what happened to it
  // in real, server-computed terms (`previousRank - rank`) — never re-derived from the visible
  // order. `t1` rose from 2nd to 1st, `t2` fell from 1st to 2nd, `t3` is unchanged.
  it("renders the rank numeral and the real movement against last week", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("1")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("▲ 1")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("▼ 1")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("—")).toBeInTheDocument();
  });

  // The tab loop's two new facts, both derived from settled results already in hand: the current
  // streak and games back of the leader (`t1` is the leader and prints a dash for GB).
  it("renders each team's streak and games back of the leader", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("W3")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("L1")).toBeInTheDocument();
    // t1 (leader, 9-4) vs t3 (5-8): (9-5 + 8-4)/2 = 4 games back.
    expect(within(rows[2]!).getByText("4")).toBeInTheDocument();
  });

  it("offers a next action before any week has been scored", async () => {
    await renderSurface(<StandingsTable rows={[]} myTeamId={null} />, async ({ container }) => {
      expect(screen.getByText("No results yet")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Task 5 carry: `clinchedTeamIds` reports every team clinched from week 1 whenever the
  // playoff field is as big as the league itself (`playoffTeams >= teamCount`) — a signal with
  // no information in it. Twelve meaningless badges are worse than none.
  it("suppresses the x- clinch notation for every row when the whole league is (degenerately) clinched", async () => {
    await renderSurface(<StandingsTable rows={ALL_CLINCHED_STANDINGS} myTeamId="t1" />, async ({ container }) => {
      expect(screen.queryByText("x-")).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Step 2: the playoff cut, drawn as a hairline between two rows — never a colored row, which
  // would be a WCAG 1.4.1 color-only-boundary failure. `STANDINGS` has three teams; a
  // `playoffTeams` of 2 draws the cut above the third (`t3`, "Comet Crew").
  it("draws the playoff cut as a border-top hairline above the first team out, when playoffTeams is given", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" playoffTeams={2} />);
    const cutRow = screen.getByText("Comet Crew").closest("tr")!;
    expect(cutRow.className).toContain("border-t-edge");
    const inRow = screen.getByText("Iron Owls").closest("tr")!;
    expect(inRow.className).not.toContain("border-t-edge");
  });

  it("draws no cut at all without a playoffTeams prop, or when the field covers the whole league", () => {
    const { rerender } = render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(document.querySelector("tr.border-t-edge")).toBeNull();
    rerender(<StandingsTable rows={STANDINGS} myTeamId="t1" playoffTeams={STANDINGS.length} />);
    expect(document.querySelector("tr.border-t-edge")).toBeNull();
  });

  // Task 3 (Phase 3.5): the standings surface that says the record itself is a two-games-a-week
  // one. Inverted assertion — a non-median league (the default, `medianGame` omitted) never
  // shows the caption note. `formatRecord`/`computeStandings` themselves are unchanged (one
  // column, because the median game IS a game); this only adds context around it.
  it("adds no caption note for a non-median league", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.queryByText(/median game/)).not.toBeInTheDocument();
  });

  it("names the median game in a caption note, in both themes, axe-clean", async () => {
    await renderSurface(<StandingsTable rows={STANDINGS} myTeamId="t1" medianGame />, async ({ container }) => {
      expect(screen.getByText(/Records include each week's median game\./)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("keeps the tiebreak sentence and appends the clinch and median notes to the SAME line, not a second paragraph", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" medianGame />);
    expect(
      screen.getByText("Ties in the standings break on points for. x- means a clinched playoff spot. Records include each week's median game."),
    ).toBeInTheDocument();
  });

  /**
   * THE PLAYOFF PICTURE (the tab loop, 2026-08-30): the bracket the current standings imply,
   * shown only once the field is bigger than the cut (`rows.length > 6`) — `STANDINGS`' three
   * teams never trigger it (asserted above, implicitly, by every other test's absence of the
   * heading), and a seven-team league does.
   */
  describe("the playoff picture", () => {
    const SEVEN: readonly TeamStandingsRow[] = [1400, 1300, 1200, 1100, 1000, 900, 800].map((pointsFor, index) => ({
      teamId: `x${index}`,
      teamName: `Team ${index}`,
      wins: 10 - index,
      losses: index,
      ties: 0,
      pointsFor,
      pointsAgainst: 900 + index * 100,
      clinched: false,
      ownerDisplayName: `Owner ${index}`,
      ownerAvatar: null,
      rank: index + 1,
      previousRank: index + 1,
      streak: null,
    }));

    it("names the byes and both first-round games for a league bigger than the cut", () => {
      render(<StandingsTable rows={SEVEN} myTeamId="x0" />);
      expect(screen.getByText("Playoff picture")).toBeInTheDocument();
      const byes = screen.getByText("First-round byes").closest("div")!;
      expect(within(byes).getByText("Team 0")).toBeInTheDocument();
      expect(within(byes).getByText("Team 1")).toBeInTheDocument();
      const threeVsSix = screen.getByText("3 vs 6").closest("div")!;
      expect(within(threeVsSix).getByText("Team 2")).toBeInTheDocument();
      expect(within(threeVsSix).getByText("Team 5")).toBeInTheDocument();
      const fourVsFive = screen.getByText("4 vs 5").closest("div")!;
      expect(within(fourVsFive).getByText("Team 3")).toBeInTheDocument();
      expect(within(fourVsFive).getByText("Team 4")).toBeInTheDocument();
    });

    it("says nothing about the playoff picture for a league at or under the cut", () => {
      render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
      expect(screen.queryByText("Playoff picture")).not.toBeInTheDocument();
    });

    it("is axe-clean with the playoff picture showing, in both themes", async () => {
      await renderSurface(<StandingsTable rows={SEVEN} myTeamId="x0" />, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    });
  });
});
