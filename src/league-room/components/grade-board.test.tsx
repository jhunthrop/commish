import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { LeagueGradeRow } from "../contract";
import { GradeBoard } from "./grade-board";

const GRADES: readonly LeagueGradeRow[] = [
  {
    teamId: "t2",
    teamName: "Iron Owls",
    letter: "B",
    projectedRank: 2,
    components: { valueCaptured: -8.4, startingSlotsFilled: 8, startingSlotsTotal: 9, byeCollisions: 1, projectedPoints: 110.2 },
  },
  {
    teamId: "t1",
    teamName: "Bay Bandits",
    letter: "A",
    projectedRank: 1,
    components: { valueCaptured: -2.1, startingSlotsFilled: 9, startingSlotsTotal: 9, byeCollisions: 0, projectedPoints: 128.6 },
  },
];

describe("GradeBoard", () => {
  it("renders nothing for an empty board", () => {
    const { container } = render(<GradeBoard grades={[]} basis="August 1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("orders rows by projected rank, regardless of the order it was handed", () => {
    render(<GradeBoard grades={GRADES} basis="August 1" />);
    const teamCells = screen.getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(teamCells[0]).toContain("Bay Bandits");
    expect(teamCells[1]).toContain("Iron Owls");
  });

  it("names the letter, the value captured, and the projected finish for every team", () => {
    render(<GradeBoard grades={GRADES} basis="August 1" />);
    const rows = screen.getAllByRole("row");
    expect(rows[1]!.textContent).toContain("A");
    expect(rows[1]!.textContent).toContain("-2.1");
    expect(rows[1]!.textContent).toContain("1st");
    expect(rows[2]!.textContent).toContain("B");
    expect(rows[2]!.textContent).toContain("-8.4");
    expect(rows[2]!.textContent).toContain("2nd");
  });

  it("names the basis in the fine print", () => {
    render(<GradeBoard grades={GRADES} basis="August 1" />);
    expect(screen.getByText("Graded against our board of August 1")).toBeInTheDocument();
  });

  it("expands a row to its components on demand, and hides them again", () => {
    render(<GradeBoard grades={GRADES} basis="August 1" />);
    expect(screen.queryByText("Bye collisions")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Details for Bay Bandits/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Bye collisions")).toBeInTheDocument();
    expect(screen.getByText("9 of 9")).toBeInTheDocument();
    expect(screen.getByText("128.6")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Bye collisions")).not.toBeInTheDocument();
  });

  it("expands only the row asked for, never two at once", () => {
    render(<GradeBoard grades={GRADES} basis="August 1" />);
    fireEvent.click(screen.getByRole("button", { name: /Details for Bay Bandits/ }));
    expect(screen.getByRole("button", { name: /Hide for Bay Bandits/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Details for Iron Owls/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Details for Iron Owls/ }));
    expect(screen.getByRole("button", { name: /Details for Bay Bandits/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hide for Iron Owls/ })).toBeInTheDocument();
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<GradeBoard grades={GRADES} basis="August 1" />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
