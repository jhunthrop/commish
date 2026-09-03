import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TeamCard } from "@/domain/league";
import { avatarRefValue } from "@/identity/avatars";
import { ManagerRow } from "./manager-row";

const TEAMS: readonly TeamCard[] = [
  { id: "t1", name: "Bay Bandits", ownerDisplayName: "Dana Whitfield", ownerAvatarUrl: avatarRefValue("shield") },
  { id: "t2", name: "Iron Owls", ownerDisplayName: "Rey Okafor", ownerAvatarUrl: null },
  { id: "t3", name: "Turf Burners", ownerDisplayName: "Coach Parker", ownerAvatarUrl: null },
];

const COLUMNS = { gridTemplateColumns: "44px repeat(3, minmax(0, 1fr))" };

function renderRow(overrides: Partial<Parameters<typeof ManagerRow>[0]> = {}) {
  return render(
    <ManagerRow
      draftOrder={["t1", "t2", "t3"]}
      teams={TEAMS}
      myTeamId="t2"
      onClockTeamId="t1"
      columns={COLUMNS}
      {...overrides}
    />,
  );
}

describe("ManagerRow", () => {
  it("gives every swimlane a column head on the board's own grid columns", () => {
    renderRow();
    const row = screen.getByTestId("manager-row");
    expect(row.style.gridTemplateColumns).toBe(COLUMNS.gridTemplateColumns);
    expect(screen.getAllByTestId("manager-head")).toHaveLength(3);
  });

  it("rings the on-the-clock manager in the live channel, never amber", () => {
    renderRow();
    const heads = screen.getAllByTestId("manager-head");
    const live = heads.find((head) => head.dataset.state === "live");
    expect(live).toBeDefined();
    expect(live!.innerHTML).toContain("ring-live");
    expect(live!.innerHTML).not.toContain("ring-accent");
  });

  it("rings YOUR head amber with the soft glow token, and labels it YOU", () => {
    renderRow();
    const heads = screen.getAllByTestId("manager-head");
    const you = heads.find((head) => head.dataset.state === "you");
    expect(you).toBeDefined();
    expect(you!.innerHTML).toContain("ring-accent");
    expect(you!.innerHTML).toContain("shadow-verb-glow");
    expect(you!).toHaveTextContent("YOU");
  });

  it("keeps everyone else quiet: line ring, no glow, the team's code as the label", () => {
    renderRow();
    const heads = screen.getAllByTestId("manager-head");
    const quiet = heads.find((head) => head.dataset.state === "quiet");
    expect(quiet).toBeDefined();
    expect(quiet!.innerHTML).toContain("ring-line");
    expect(quiet!.innerHTML).not.toContain("shadow-verb-glow");
    expect(quiet!).toHaveTextContent("TB");
  });

  it("your own turn is live AND yours: the live ring wins the ring, the label stays YOU", () => {
    renderRow({ onClockTeamId: "t2" });
    const heads = screen.getAllByTestId("manager-head");
    const mine = heads.find((head) => head.textContent?.includes("YOU"));
    expect(mine).toBeDefined();
    expect(mine!.dataset.state).toBe("live");
    expect(mine!.innerHTML).toContain("ring-live");
  });

  it("a manager with no avatar gets the team's crest monogram; a stored ref renders the avatar", () => {
    renderRow();
    // t3 "Turf Burners" has no avatar ref: the Crest primitive's own mark for the name.
    expect(screen.getByText("TB", { selector: "span span" })).toBeInTheDocument();
    // t1 stored the shield preset — the Avatar primitive's preset tile, not a crest mark.
    const heads = screen.getAllByTestId("manager-head");
    const live = heads.find((head) => head.dataset.state === "live");
    expect(live!.querySelector("svg")).not.toBeNull();
  });

  it("every head still carries the full team name for a screen reader", () => {
    renderRow();
    expect(screen.getByTitle("Bay Bandits")).toBeInTheDocument();
    expect(screen.getByTitle("Iron Owls")).toBeInTheDocument();
    expect(screen.getByTitle("Turf Burners")).toBeInTheDocument();
  });
});
