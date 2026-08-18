import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AUCTION_VIEW, TEAMS } from "../test-fixtures";
import { BudgetTable } from "./budget-table";

describe("BudgetTable", () => {
  it("shows every team's remaining budget and ceiling straight off the view — both themes, axe-clean", async () => {
    await inBothThemes(<BudgetTable view={AUCTION_VIEW} teams={TEAMS} myTeamId="t1" />, async ({ container }) => {
      const table = screen.getByRole("table", { name: /budgets/i });
      const row = within(table).getByText("Bay Bandits").closest("tr")!;
      expect(row).toHaveTextContent("$100");
      expect(row).toHaveTextContent("$97");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("marks your own team, with a badge and a highlighted row", () => {
    render(<BudgetTable view={AUCTION_VIEW} teams={TEAMS} myTeamId="t1" />);
    const table = screen.getByRole("table", { name: /budgets/i });
    const mine = within(table).getByText("Bay Bandits").closest("tr")!;
    expect(within(mine).getByText("You")).toBeInTheDocument();
    expect(mine.className).toContain("border-accent");
    const theirs = within(table).getByText("Iron Owls").closest("tr")!;
    expect(within(theirs).queryByText("You")).toBeNull();
    expect(theirs.className).not.toContain("border-accent");
  });
});
