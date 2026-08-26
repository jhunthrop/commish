import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { renderSurface } from "@/components/ui/test-utils";
import { SNAKE_VIEW, playersById } from "../test-fixtures";
import { RosterRail } from "./roster-rail";

// PLAYERS: qb1 (headshot), rb1/rb2/wr1 (no headshot — initials fallback).
const VIEW: DraftStateView = {
  ...SNAKE_VIEW,
  slotConfig: [
    { slot: "QB", count: 1, eligiblePositions: ["QB"] },
    { slot: "RB", count: 2, eligiblePositions: ["RB"] },
    { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
    { slot: "BENCH", count: 2, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
  ],
  rosters: {
    t1: [
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "RB", slotIndex: 0, playerId: "rb1" },
      { slot: "FLEX", slotIndex: 0, playerId: "wr1" },
    ],
  },
};

describe("RosterRail", () => {
  it("states the heading and one row per configured spot, in slot order, axe-clean in both themes", async () => {
    await renderSurface(
      <RosterRail view={VIEW} myTeamId="t1" playersById={playersById()} slotConfig={VIEW.slotConfig} />,
      async ({ container }) => {
        expect(screen.getByRole("heading", { name: "Your roster" })).toBeInTheDocument();
        const roster = screen.getByRole("list", { name: "Your roster" });
        const rows = within(roster).getAllByRole("listitem");
        expect(rows).toHaveLength(6); // QB, RB x2, FLEX, BENCH x2
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows a filled spot as the player's own face, name and true position — even a FLEX slot holding a WR", () => {
    render(<RosterRail view={VIEW} myTeamId="t1" playersById={playersById()} slotConfig={VIEW.slotConfig} />);
    const roster = screen.getByRole("list", { name: "Your roster" });
    expect(within(roster).getByText("Andre Salas")).toBeInTheDocument();
    expect(within(roster).getAllByText("WR")).not.toHaveLength(0);
  });

  it("shows an open spot as its own slot chip and a quiet placeholder, no player name", () => {
    render(<RosterRail view={VIEW} myTeamId="t1" playersById={playersById()} slotConfig={VIEW.slotConfig} />);
    const roster = screen.getByRole("list", { name: "Your roster" });
    // The second RB spot and both bench spots are open — their own slot letters show as chips.
    expect(within(roster).getAllByText("RB").length).toBeGreaterThan(0);
    expect(within(roster).getAllByText("BENCH").length).toBeGreaterThan(0);
    expect(within(roster).queryByText("Open")).not.toBeInTheDocument();
  });

  it("falls back to initials when a filled player has no headshot", () => {
    render(<RosterRail view={VIEW} myTeamId="t1" playersById={playersById()} slotConfig={VIEW.slotConfig} />);
    // rb1 (Marcus Reed) carries no headshotUrl in the fixture — Avatar's initials fallback.
    expect(screen.getByText("MR")).toBeInTheDocument();
  });
});
