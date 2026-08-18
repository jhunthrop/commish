import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
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
