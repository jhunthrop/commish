import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { PLAYERS, SNAKE_VIEW } from "../test-fixtures";
import { PlayerPool } from "./player-pool";

const props = {
  players: PLAYERS,
  view: SNAKE_VIEW,
  pendingPlayerId: null,
  canAct: true,
  myTeamId: "t1",
  actionLabel: "Draft",
  submitting: false,
  onAct: () => {},
  queuedPlayerIds: new Set<string>(),
  onQueue: () => {},
};

const poolRows = () => within(screen.getByRole("list", { name: /available players/i })).getAllByRole("listitem");
const rowFor = (name: string) => screen.getByText(name).closest("li")!;

describe("PlayerPool", () => {
  it("lists every player in ranked order and is axe-clean in both themes", async () => {
    await renderSurface(<PlayerPool {...props} />, async ({ container }) => {
      expect(poolRows().map((row) => within(row).getByRole("button", { name: /queue/i }).closest("li")!.textContent)).toHaveLength(4);
      expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
      expect(screen.getByText("Andre Salas")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("keeps the server's ranking, numbered, without re-ranking anything", () => {
    render(<PlayerPool {...props} />);
    expect(poolRows().map((row) => within(row).getByText(/^[0-9]+$/).textContent)).toEqual(["1", "2", "3", "4"]);
  });

  it("filters by name as you type", () => {
    render(<PlayerPool {...props} />);
    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "marc" } });
    expect(screen.getByText("Marcus Reed")).toBeInTheDocument();
    expect(screen.queryByText("Jalen Croft")).toBeNull();
  });

  it("filters by position from the sticker toggles, and toggles back off", () => {
    render(<PlayerPool {...props} />);
    const rbFilter = screen.getByRole("button", { name: "Show RB only" });
    fireEvent.click(rbFilter);
    expect(rbFilter).toHaveAttribute("aria-pressed", "true");
    expect(poolRows()).toHaveLength(2);
    fireEvent.click(rbFilter);
    expect(poolRows()).toHaveLength(4);
  });

  it("offers a way out when nothing matches", () => {
    render(<PlayerPool {...props} />);
    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "zzzz" } });
    expect(screen.getByRole("heading", { name: "No players match" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
  });

  it("hides drafted players by default — the pool's job is who you can still take", () => {
    render(<PlayerPool {...props} view={{ ...SNAKE_VIEW, availablePlayerIds: ["rb1", "rb2", "wr1"] }} />);
    expect(screen.queryByText("Jalen Croft")).toBeNull();
    expect(screen.getByText("Marcus Reed")).toBeInTheDocument();
  });

  it("shows drafted players behind the toggle, marked and inert", () => {
    render(<PlayerPool {...props} view={{ ...SNAKE_VIEW, availablePlayerIds: ["rb1", "rb2", "wr1"] }} />);
    fireEvent.click(screen.getByLabelText("Show drafted players"));
    const row = rowFor("Jalen Croft");
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
    const row = rowFor("Jalen Croft");
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Draft" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Queue Jalen Croft" })).toBeInTheDocument();
  });

  it("shows each player's position as its sticker, not as bare text", () => {
    render(<PlayerPool {...props} />);
    expect(within(rowFor("Jalen Croft")).getByText("QB").className).toContain("bg-pos-qb");
  });

  it("shows no act button while waiting — the star is the action — and reports the player on your turn", () => {
    const onAct = vi.fn();
    const { rerender } = render(<PlayerPool {...props} canAct={false} onAct={onAct} />);
    // Waiting mode: queue stars only. A disabled "Draft" would be a lie-in-waiting.
    expect(screen.queryByRole("button", { name: "Draft" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /queue/i }).length).toBeGreaterThan(0);

    rerender(<PlayerPool {...props} canAct onAct={onAct} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Draft" })[0]!);
    expect(onAct).toHaveBeenCalledWith("qb1");
  });

  it("shows the in-flight player as pending", () => {
    render(<PlayerPool {...props} pendingPlayerId="qb1" submitting />);
    expect(within(rowFor("Jalen Croft")).getByRole("button", { name: "Draft" })).toHaveAttribute("aria-busy", "true");
  });

  it("says nothing when every match fits on the page", () => {
    render(<PlayerPool {...props} />);
    expect(screen.queryByText(/narrow your search/i)).toBeNull();
  });

  it("tells you when results are capped, and by how much, so narrowing the search isn't a mystery", () => {
    const manyPlayers = Array.from({ length: 75 }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, position: "WR" as const, nflTeam: "DAL" }));
    const view = { ...SNAKE_VIEW, availablePlayerIds: manyPlayers.map((player) => player.id) };
    render(<PlayerPool {...props} players={manyPlayers} view={view} />);
    expect(screen.getByText("Showing the top 60 of 75. Narrow your search to see more.")).toBeInTheDocument();
  });

  // Task 5, Phase 3.5: the Draft buttons live on your turn AND off it, for a team that owes a
  // pick from an earlier skip — it may make it any time.
  it("lights up the Draft button off your own turn when you owe a pick (Task 5)", () => {
    const onAct = vi.fn();
    const view = { ...SNAKE_VIEW, owedPicks: { t1: [1] } };
    render(<PlayerPool {...props} view={view} canAct={false} onAct={onAct} />);
    const button = screen.getAllByRole("button", { name: "Draft" })[0]!;
    fireEvent.click(button);
    expect(onAct).toHaveBeenCalledWith("qb1");
  });

  it("shows no act button for an owed pick that belongs to a different team", () => {
    const view = { ...SNAKE_VIEW, owedPicks: { t2: [1] } };
    render(<PlayerPool {...props} view={view} canAct={false} />);
    expect(screen.queryByRole("button", { name: "Draft" })).toBeNull();
  });

  it("shows no act button for a commissioner with no team at all, even if somebody owes a pick", () => {
    const view = { ...SNAKE_VIEW, owedPicks: { t1: [1] } };
    render(<PlayerPool {...props} view={view} canAct={false} myTeamId={null} />);
    expect(screen.queryByRole("button", { name: "Draft" })).toBeNull();
  });

  it("queues and un-queues a player from the pool", () => {
    const onQueue = vi.fn();
    render(<PlayerPool {...props} queuedPlayerIds={new Set(["rb1"])} onQueue={onQueue} />);
    fireEvent.click(screen.getByRole("button", { name: "Queue Jalen Croft" }));
    expect(onQueue).toHaveBeenCalledWith("qb1");
    expect(screen.getByRole("button", { name: "Remove Marcus Reed from your queue" })).toBeInTheDocument();
  });
});
