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

  it("renders tv variant with large-type columns and non-interactive empty action", async () => {
    await inBothThemes(
      <PickHistory view={withPicks} teams={TEAMS} playersById={playersById(PLAYERS)} variant="tv" emptyAction={<span>Waiting...</span>} />,
      async ({ container }) => {
        expect(screen.getByRole("columnheader", { name: "Rd" })).toBeInTheDocument();
        const rows = screen.getAllByRole("row").slice(1);
        expect(rows[0]).toHaveTextContent("Marcus Reed");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("tv variant empty state has no button when emptyAction is non-interactive", () => {
    render(<PickHistory view={SNAKE_VIEW} teams={TEAMS} playersById={playersById(PLAYERS)} variant="tv" emptyAction={<span className="text-text-muted">Waiting for the first pick</span>} />);
    expect(screen.getByRole("heading", { name: "The board is empty" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
