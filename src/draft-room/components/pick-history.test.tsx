import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { PickHistory } from "./pick-history";

const withPicks = {
  ...SNAKE_VIEW,
  picks: [
    { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:05:00.000Z", auto: false },
    { pickNumber: 2, round: 1, teamId: "t2", playerId: "rb1", slot: "RB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:06:00.000Z", auto: true },
  ],
};

describe("PickHistory", () => {
  it("lists picks newest first, flags autopicks, and is axe-clean in both themes", async () => {
    await inBothThemes(<PickHistory view={withPicks} teams={TEAMS} playersById={playersById(PLAYERS)} />, async ({ container }) => {
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows[0]).toHaveTextContent("Marcus Reed");
      expect(rows[0]).toHaveTextContent("Auto");
      expect(rows[1]).toHaveTextContent("Jalen Croft");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("says nothing has happened yet rather than showing an empty table", () => {
    render(<PickHistory view={SNAKE_VIEW} teams={TEAMS} playersById={playersById(PLAYERS)} />);
    expect(screen.getByRole("heading", { name: "No picks yet" })).toBeInTheDocument();
  });
});
