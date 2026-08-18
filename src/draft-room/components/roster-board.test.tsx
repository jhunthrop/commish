import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { RosterBoard } from "./roster-board";

const filled = { ...SNAKE_VIEW, rosters: { t1: [{ slot: "QB" as const, slotIndex: 0, playerId: "qb1" }], t2: [] } };

describe("RosterBoard", () => {
  it("draws every configured slot, filled and empty, in both themes with no axe violations", async () => {
    await inBothThemes(<RosterBoard view={filled} teams={TEAMS} playersById={playersById(PLAYERS)} myTeamId="t1" />, async ({ container }) => {
      const mine = screen.getByRole("group", { name: "Bay Bandits" });
      expect(within(mine).getByText("Jalen Croft")).toBeInTheDocument();
      // QB×1 + RB×2 = three slots, two of them still empty.
      expect(within(mine).getAllByText("Empty")).toHaveLength(2);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("marks your own team so you can find it at a glance", () => {
    render(<RosterBoard view={filled} teams={TEAMS} playersById={playersById(PLAYERS)} myTeamId="t1" />);
    expect(within(screen.getByRole("group", { name: "Bay Bandits" })).getByText("Your team")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Iron Owls" })).queryByText("Your team")).toBeNull();
  });
});
