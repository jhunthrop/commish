import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { inBothThemes } from "@/components/ui/test-utils";
import { ALL_CLINCHED_STANDINGS, STANDINGS } from "../test-fixtures";
import { StandingsTable } from "./standings-table";

describe("StandingsTable", () => {
  it("shows each team's record and both points columns, in both themes, axe-clean", async () => {
    await inBothThemes(<StandingsTable rows={STANDINGS} myTeamId="t1" />, async ({ container }) => {
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

  it("carries an InfoTip on the Record column header", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByRole("button", { name: "What is a record?" })).toBeInTheDocument();
  });

  // FIX 1 (HIGH): helpLevel must actually reach a wired InfoTip, not just be accepted and
  // dropped — a guided caller sees the short line without clicking; a standard caller (or one
  // this prop is simply omitted for, the default) only gets the click-to-reveal trigger.
  it("threads helpLevel into its InfoTip: guided shows the short line inline, standard doesn't", () => {
    const { rerender } = render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.queryByText(GLOSSARY["standings-record"].short)).not.toBeInTheDocument();
    rerender(<StandingsTable rows={STANDINGS} myTeamId="t1" helpLevel="standard" />);
    expect(screen.queryByText(GLOSSARY["standings-record"].short)).not.toBeInTheDocument();
    rerender(<StandingsTable rows={STANDINGS} myTeamId="t1" helpLevel="guided" />);
    expect(screen.getByText(GLOSSARY["standings-record"].short)).toBeInTheDocument();
  });

  it("marks the clinched teams and the caller's own row", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    expect(screen.getByText("Clinched")).toBeInTheDocument();
    expect(screen.getByText("Bay Bandits").closest("tr")).toHaveAttribute("data-own", "true");
  });

  it("re-orders by a column when its header button is pressed, keeping the server's ranking for ties", () => {
    render(<StandingsTable rows={STANDINGS} myTeamId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Sort by points against" }));
    const names = screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(names[0]).toContain("Iron Owls");
  });

  it("a GENUINE tie keeps the server's order through a sort round-trip — the client never restates a tiebreak", () => {
    // Two rows identical on every sortable number; the server ranked t_b above t_c
    // (its tiebreak is teamId — a rule this component must never re-derive).
    const tied = [
      { teamId: "t_a", teamName: "Front Runners", wins: 8, losses: 5, ties: 0, pointsFor: 1400, pointsAgainst: 1200, clinched: false, ownerDisplayName: "A", ownerAvatar: null },
      { teamId: "t_b", teamName: "Twin Alpha", wins: 6, losses: 7, ties: 0, pointsFor: 1234.5, pointsAgainst: 1300, clinched: false, ownerDisplayName: "B", ownerAvatar: null },
      { teamId: "t_c", teamName: "Twin Beta", wins: 6, losses: 7, ties: 0, pointsFor: 1234.5, pointsAgainst: 1300, clinched: false, ownerDisplayName: "C", ownerAvatar: null },
    ];
    render(<StandingsTable rows={tied} myTeamId={null} />);
    const namesAfter = (label: string) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
      return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent ?? "");
    };
    const byPointsFor = namesAfter("Sort by points for");
    expect(byPointsFor.findIndex((n) => n.includes("Twin Alpha"))).toBeLessThan(byPointsFor.findIndex((n) => n.includes("Twin Beta")));
    const byWins = namesAfter("Sort by standing");
    expect(byWins.findIndex((n) => n.includes("Twin Alpha"))).toBeLessThan(byWins.findIndex((n) => n.includes("Twin Beta")));
  });

  it("offers a next action before any week has been scored", async () => {
    await inBothThemes(<StandingsTable rows={[]} myTeamId={null} />, async ({ container }) => {
      expect(screen.getByText("No results yet")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Task 5 carry: `clinchedTeamIds` reports every team clinched from week 1 whenever the
  // playoff field is as big as the league itself (`playoffTeams >= teamCount`) — a signal with
  // no information in it. Twelve meaningless badges are worse than none.
  it("suppresses the clinched badge for every row when the whole league is (degenerately) clinched", async () => {
    await inBothThemes(<StandingsTable rows={ALL_CLINCHED_STANDINGS} myTeamId="t1" />, async ({ container }) => {
      expect(screen.queryByText("Clinched")).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
