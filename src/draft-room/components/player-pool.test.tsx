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

  it("never dims an unselected sticker, because opacity is what washed RB/TE below AA in light", () => {
    // P13's axe battery caught opacity-80 on unselected filters dropping sticker contrast below
    // 4.5:1 in the light theme; selection is signaled by the ring, never by dimming a readable
    // label. This pins the fix at vitest speed rather than only at the next e2e axe run.
    render(<PlayerPool {...props} />);
    for (const button of screen.getAllByRole("button", { name: /^Show .* only$/ })) {
      expect(button.className).not.toMatch(/opacity/);
    }
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

  // E11 (2026-08-26 design review): the pre-start pool printed a 60-row column of "—"
  // placeholders — sixty dashes saying nothing sixty times. Dropped outright: no action slot
  // renders at all before kickoff, and the star is still the whole story.
  it("shows no action slot at all — not even a dash — and still lets you queue, before the draft starts (E11)", () => {
    const scheduled = { ...SNAKE_VIEW, phase: "scheduled" as const, availablePlayerIds: [], onClockTeamId: null };
    render(<PlayerPool {...props} view={scheduled} canAct={false} />);
    const row = rowFor("Jalen Croft");
    expect(within(row).queryByText("—")).toBeNull();
    expect(within(row).queryByRole("button", { name: "Draft" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Queue Jalen Croft" })).toBeInTheDocument();
  });

  it("shows each player's position as its sticker, not as bare text", () => {
    render(<PlayerPool {...props} />);
    expect(within(rowFor("Jalen Croft")).getByText("QB").className).toContain("bg-pos-qb");
  });

  // Founder directive 2026-08-26 ("why aren't we showing the players picture?"): qb1 (Jalen
  // Croft) carries a headshot in the shared PLAYERS fixture; rb1 (Marcus Reed) is null.
  it("renders the player's headshot when the pool has one, and the initials fallback when it doesn't", () => {
    render(<PlayerPool {...props} />);
    // Decorative (`Avatar` gets no `label` here), so the <img> carries alt="" and role
    // "presentation" — found by its src, not by an accessible role.
    const withPhoto = rowFor("Jalen Croft").querySelector("img");
    expect(withPhoto).toHaveAttribute("src", "https://a.espncdn.com/i/headshots/nfl/players/full/qb1.png");
    expect(rowFor("Marcus Reed").querySelector("img")).toBeNull();
    expect(within(rowFor("Marcus Reed")).getByText("MR")).toBeInTheDocument();
  });

  // V-04 (veteran journey, BLOCKER): the name used to sit in the same flex row as the rank,
  // sticker, avatar, team code, queue star AND the Draft button — the only element with
  // `min-w-0` (so the only one that could shrink), it absorbed the whole width deficit and
  // truncated to 3-4 characters the instant the on-turn Draft button appeared. jsdom performs no
  // real layout, so this cannot assert pixel width — it asserts the STRUCTURAL fix instead: the
  // name's own row no longer contains the act button (or the "Drafted" badge) at all, on your
  // turn, at the exact width the bug reproduced at.
  it("keeps the Draft button off the name's own row, so nothing there competes with the name for width (V-04)", () => {
    render(<PlayerPool {...props} canAct />);
    const nameRow = screen.getByText("Jalen Croft").closest("div")!;
    expect(within(nameRow).queryByRole("button", { name: "Draft" })).toBeNull();
    const draftButton = screen.getAllByRole("button", { name: "Draft" })[0]!;
    expect(nameRow).not.toContainElement(draftButton);
  });

  it("shows the team code on its own meta line under the name, unconditionally rather than gated on a wide viewport", () => {
    render(<PlayerPool {...props} canAct />);
    const nameRow = screen.getByText("Jalen Croft").closest("div")!;
    const teamCode = screen.getByText(PLAYERS[0]!.nflTeam);
    expect(nameRow).not.toContainElement(teamCode);
    expect(teamCode.className).not.toMatch(/\bhidden\b/);
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

  // D3 (2026-08-26 design review, rule 5): on your turn the pool used to fill the view with
  // up to sixty solid ink "Draft" pills against a one-ink law — the row act button, the "All"
  // filter and the empty-state button all took `Button`'s default primary. The pool is now
  // quiet by construction: the dock's one confirmed pick affordance is the room's single ink
  // action, and nothing in this component may ever wear the ink fill.
  it("keeps every pool control quiet — no ink pill ever renders here, even on your turn (D3)", () => {
    const { container } = render(<PlayerPool {...props} />);
    expect(screen.getAllByRole("button", { name: "Draft" }).length).toBeGreaterThan(0);
    expect(container.querySelector(".bg-text-primary")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "zzzz" } });
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(container.querySelector(".bg-text-primary")).toBeNull();
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
    const manyPlayers = Array.from({ length: 75 }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, position: "WR" as const, nflTeam: "DAL", headshotUrl: null }));
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
