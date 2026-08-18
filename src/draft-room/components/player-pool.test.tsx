import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { PLAYERS, SNAKE_VIEW } from "../test-fixtures";
import { PlayerPool } from "./player-pool";

const props = {
  players: PLAYERS,
  view: SNAKE_VIEW,
  pendingPlayerId: null,
  canAct: true,
  actionLabel: "Draft",
  submitting: false,
  onAct: () => {},
  queuedPlayerIds: new Set<string>(),
  onQueue: () => {},
};

describe("PlayerPool", () => {
  it("lists every player in ranked order and is axe-clean in both themes", async () => {
    await inBothThemes(<PlayerPool {...props} />, async ({ container }) => {
      const rows = within(screen.getByRole("table", { name: /available players/i })).getAllByRole("row").slice(1);
      expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
        "Jalen Croft",
        "Marcus Reed",
        "Devon Marsh",
        "Andre Salas",
      ]);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("filters by name as you type", () => {
    render(<PlayerPool {...props} />);
    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "marc" } });
    expect(screen.getByText("Marcus Reed")).toBeInTheDocument();
    expect(screen.queryByText("Jalen Croft")).toBeNull();
  });

  it("filters by position", () => {
    render(<PlayerPool {...props} />);
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "RB" } });
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + two RBs
  });

  it("offers a way out when nothing matches", () => {
    render(<PlayerPool {...props} />);
    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "zzzz" } });
    expect(screen.getByRole("heading", { name: "No players match" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
  });

  it("marks drafted players and refuses to act on them", () => {
    render(<PlayerPool {...props} view={{ ...SNAKE_VIEW, availablePlayerIds: ["rb1", "rb2", "wr1"] }} />);
    const row = screen.getByText("Jalen Croft").closest("tr")!;
    expect(within(row).getByText("Drafted")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  // Before START_DRAFT the engine has no pool, so `availablePlayerIds` is empty. That means
  // "not known yet", not "all drafted" — the old room read it as the latter and told every
  // manager waiting on their commissioner that all 300 players were already gone.
  it("never says a player is drafted before the draft has started", () => {
    const scheduled = { ...SNAKE_VIEW, phase: "scheduled" as const, availablePlayerIds: [], onClockTeamId: null };
    render(<PlayerPool {...props} view={scheduled} canAct={false} />);
    expect(screen.queryByText("Drafted")).toBeNull();
    expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
  });

  it("shows a quiet dash instead of an action, and still lets you queue, before the draft starts", () => {
    const scheduled = { ...SNAKE_VIEW, phase: "scheduled" as const, availablePlayerIds: [], onClockTeamId: null };
    render(<PlayerPool {...props} view={scheduled} canAct={false} />);
    const row = screen.getByText("Jalen Croft").closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Draft" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Queue Jalen Croft" })).toBeInTheDocument();
  });

  it("shows each player's position as its sticker, not as bare text", () => {
    render(<PlayerPool {...props} />);
    const row = screen.getByText("Jalen Croft").closest("tr")!;
    expect(within(row).getByText("QB").className).toContain("bg-pos-qb");
  });

  it("disables acting when it is not your turn, and reports the player when it is", () => {
    const onAct = vi.fn();
    const { rerender } = render(<PlayerPool {...props} canAct={false} onAct={onAct} />);
    expect(screen.getAllByRole("button", { name: "Draft" })[0]).toBeDisabled();

    rerender(<PlayerPool {...props} canAct onAct={onAct} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Draft" })[0]!);
    expect(onAct).toHaveBeenCalledWith("qb1");
  });

  it("shows the in-flight player as pending", () => {
    render(<PlayerPool {...props} pendingPlayerId="qb1" submitting />);
    const row = screen.getByText("Jalen Croft").closest("tr")!;
    expect(within(row).getByRole("button", { name: "Draft" })).toHaveAttribute("aria-busy", "true");
  });

  it("says nothing when every match fits on the page", () => {
    render(<PlayerPool {...props} />);
    expect(screen.queryByText(/narrow your search/i)).toBeNull();
  });

  it("tells you when results are capped, and by how much, so narrowing the search isn't a mystery", () => {
    const manyPlayers = Array.from({ length: 75 }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, position: "WR" as const, nflTeam: "DAL" }));
    const view = { ...SNAKE_VIEW, availablePlayerIds: manyPlayers.map((player) => player.id) };
    render(<PlayerPool {...props} players={manyPlayers} view={view} />);
    expect(screen.getByText("Showing the top 60 of 75 — narrow your search to see more.")).toBeInTheDocument();
  });

  it("queues and un-queues a player from the pool", () => {
    const onQueue = vi.fn();
    render(<PlayerPool {...props} queuedPlayerIds={new Set(["rb1"])} onQueue={onQueue} />);
    fireEvent.click(screen.getByRole("button", { name: "Queue Jalen Croft" }));
    expect(onQueue).toHaveBeenCalledWith("qb1");
    expect(screen.getByRole("button", { name: "Remove Marcus Reed from your queue" })).toBeInTheDocument();
  });
});
