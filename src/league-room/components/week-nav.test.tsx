import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { WeekNav } from "./week-nav";

describe("WeekNav", () => {
  it("links to the previous and next week, in both themes, axe-clean", async () => {
    await inBothThemes(<WeekNav leagueId="l1" weekNumber={5} totalWeeks={14} />, async ({ container }) => {
      expect(screen.getByRole("link", { name: /Week 4/ })).toHaveAttribute("href", "/app/leagues/l1/matchups/4");
      expect(screen.getByRole("link", { name: /Week 6/ })).toHaveAttribute("href", "/app/leagues/l1/matchups/6");
      expect(screen.getByText("Week 5 of 14")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("clamps at the first week", () => {
    render(<WeekNav leagueId="l1" weekNumber={1} totalWeeks={14} />);
    expect(screen.queryByRole("link", { name: /Week 0/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Week 2/ })).toBeInTheDocument();
  });

  it("clamps at the last week", () => {
    render(<WeekNav leagueId="l1" weekNumber={14} totalWeeks={14} />);
    expect(screen.queryByRole("link", { name: /Week 15/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Week 13/ })).toBeInTheDocument();
  });
});
