import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import type { DraftRoom as DraftRoomState } from "../hooks/use-draft-room";
import { PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { SnakeRoom } from "./snake-room";

const room: DraftRoomState = {
  status: "ready",
  error: null,
  view: SNAKE_VIEW,
  players: PLAYERS,
  teams: TEAMS,
  myTeamId: "t1",
  isCommissioner: false,
  connection: "live",
  pendingPlayerId: null,
  submitting: false,
  lastPick: null,
  submit: async () => ({ ok: true }),
  refresh: async () => {},
};

describe("SnakeRoom", () => {
  it("lays out the clock, player pool, rosters, and pick history — both themes, axe-clean", async () => {
    await inBothThemes(<SnakeRoom room={room} playersById={playersById(PLAYERS)} onAct={() => {}} />, async ({ container }) => {
      expect(screen.getByText("You're on the clock")).toBeInTheDocument();
      expect(screen.getByRole("table", { name: /available players/i })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "Bay Bandits" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("lets the team on the clock draft a player", () => {
    render(<SnakeRoom room={room} playersById={playersById(PLAYERS)} onAct={() => {}} />);
    expect(screen.getAllByRole("button", { name: "Draft" })[0]).toBeEnabled();
  });
});
