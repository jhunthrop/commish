import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { LeagueMemberCard } from "../contract";
import { RoomRoster } from "./room-roster";

const TEAMS: readonly LeagueMemberCard[] = [
  { id: "t1", name: "Bay Bandits", ownerDisplayName: "Alex Rivera", ownerAvatarUrl: null, ownerUserId: "u1" },
  { id: "t2", name: "Iron Owls", ownerDisplayName: "Jordan Lee", ownerAvatarUrl: null, ownerUserId: "u2" },
];

describe("RoomRoster", () => {
  it("lists every seated manager and every open seat, in both themes, axe-clean", async () => {
    await renderSurface(
      <RoomRoster leagueId="l1" teams={TEAMS} teamCount={4} myTeamId="t1" compositionCategory="open" canInvite={true} />,
      async ({ container }) => {
        expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
        expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
        expect(screen.getAllByText("Open seat")).toHaveLength(2);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("marks the caller's own seat, without marking anybody else's", () => {
    render(<RoomRoster leagueId="l1" teams={TEAMS} teamCount={2} myTeamId="t1" compositionCategory="open" canInvite={false} />);
    const list = screen.getByRole("list", { name: "Seated managers" });
    expect(within(list).getAllByText("You")).toHaveLength(1);
  });

  // Ruling 19: the room's own coarse fact, never a per-manager history tag.
  it("carries the room's coarse composition line, and nothing about any one manager's history", () => {
    render(<RoomRoster leagueId="l1" teams={TEAMS} teamCount={2} myTeamId={null} compositionCategory="all_newcomers" canInvite={false} />);
    expect(screen.getByText("All newcomers")).toBeInTheDocument();
    expect(screen.queryByText(/season/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it("offers no share link to a member-only surface when the caller cannot invite", () => {
    render(<RoomRoster leagueId="l1" teams={TEAMS} teamCount={2} myTeamId={null} compositionCategory="open" canInvite={false} />);
    expect(screen.queryByRole("link", { name: "Invite someone" })).not.toBeInTheDocument();
  });

  it("links the share control at the room's own invite section", () => {
    render(<RoomRoster leagueId="l1" teams={TEAMS} teamCount={2} myTeamId={null} compositionCategory="open" canInvite={true} />);
    expect(screen.getByRole("link", { name: "Invite someone" })).toHaveAttribute("href", "/app/leagues/l1#invite-managers");
  });
});
