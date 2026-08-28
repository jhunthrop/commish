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

  /**
   * THE INK MOVED (the fun pass, Task 8). This test used to be "keeps every pool control quiet —
   * no ink pill ever renders here, even on your turn (D3)". D3 (2026-08-26) read rule 5 as
   * binding on this surface and made the row's own act button `secondary` so it would not shout
   * over the dock. Rule 5 was amended on 2026-08-27 (`docs/design-system.md`, "The fun-pass
   * amendments") to hold everywhere EXCEPT surfaces whose entire purpose is repeated action, and
   * the draft room is the first surface it names. The row is where a manager drafts, so the row
   * is where the ink goes.
   *
   * What did NOT change, and is what the second half still pins: every OTHER control here stays
   * quiet. The filters and the empty state are not the act, and rule 5 still binds them.
   */
  it("gives the row's own Draft button the ink, and nothing else in the pool", () => {
    const { container } = render(<PlayerPool {...props} />);
    const draft = screen.getAllByRole("button", { name: "Draft" })[0]!;
    expect(draft.className).toMatch(/bg-text-primary/);

    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "zzzz" } });
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(container.querySelector(".bg-text-primary")).toBeNull();
  });

  it("keeps the position filters quiet — a filter is not the act, and rule 5 still binds them", () => {
    const { container } = render(<PlayerPool {...props} canAct={false} />);
    // Nobody's turn: no act button at all, so nothing in the pool may wear ink.
    expect(container.querySelector(".bg-text-primary")).toBeNull();
  });

  /**
   * RULE 4'S AMENDED TEST, at the row: *a thing you act on or compare against its neighbours may
   * be a card.* A pool row is both. `interactive` is the depth response — never a heavier line,
   * and never a `role` or `tabindex`, so the card does not become a second click target beside
   * the button inside it.
   */
  describe("the row is a card (Task 8)", () => {
    it("carries the card's own surface and its interactive depth", () => {
      render(<PlayerPool {...props} />);
      const row = rowFor("Jalen Croft");
      expect(row.className).toMatch(/bg-surface-elevated/);
      expect(row.className).toMatch(/shadow-card/);
      expect(row.className).toMatch(/hover:bg-surface-raised/);
      expect(row.className).toMatch(/focus-within:bg-surface-raised/);
    });

    it("is still a list item, and still not a control of its own", () => {
      render(<PlayerPool {...props} />);
      const row = rowFor("Jalen Croft");
      expect(row.tagName).toBe("LI");
      expect(row).not.toHaveAttribute("role");
      expect(row).not.toHaveAttribute("tabindex");
    });

    it("does not lift a drafted row — there is nothing there to act on", () => {
      render(<PlayerPool {...props} view={{ ...SNAKE_VIEW, availablePlayerIds: ["rb1", "rb2", "wr1"] }} />);
      fireEvent.click(screen.getByLabelText("Show drafted players"));
      expect(rowFor("Jalen Croft").className).not.toMatch(/hover:bg-surface-raised/);
    });
  });

  /**
   * RULE 1'S TEAM-IDENTITY AMENDMENT: a club's colour, behind a face and nowhere else. The tile
   * is decorative and `aria-hidden`; the team code two lines below is the same fact in text,
   * which is what keeps it from being colour-only information.
   */
  describe("the face on the club's colour (Task 8)", () => {
    it("puts a team-coloured tile behind the face, and nothing behind the name", () => {
      render(<PlayerPool {...props} />);
      const row = rowFor("Jalen Croft");
      const tile = within(row).getByTestId("player-face-team");
      expect(tile).toHaveAttribute("data-team", "KC");
      expect(tile).toHaveAttribute("aria-hidden", "true");
      expect(tile.getAttribute("style")).toMatch(/background-color/);
      // The name is the row's own ink on the row's own surface, never on a club colour.
      expect(tile).not.toContainElement(within(row).getByTestId("pool-player-name"));
    });

    it("renders a bare face for a team it has no colour for, rather than a grey rectangle", () => {
      const free = [{ id: "fa1", name: "Rory Vance", position: "WR" as const, nflTeam: "FA", headshotUrl: null }];
      render(<PlayerPool {...props} players={free} view={{ ...SNAKE_VIEW, availablePlayerIds: ["fa1"] }} />);
      expect(within(rowFor("Rory Vance")).queryByTestId("player-face-team")).toBeNull();
      expect(within(rowFor("Rory Vance")).getByText("RV")).toBeInTheDocument();
    });
  });

  /**
   * TASK 7, THE VERDICT, in the pool. Steals only: at any slot everybody ranked below it is
   * trivially a "reach", so sixty red chips would say nothing sixty times. A player still
   * sitting there LATER than his own rank is the fact a manager scanning the pool is hunting for.
   */
  describe("the verdict on a prospect (Task 7)", () => {
    // Three picks straight down the board, then the room is at pick 12 with wr1 (board rank 4)
    // still available: eight picks later than his rank.
    const picks = [
      { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
      { pickNumber: 2, round: 1, teamId: "t2", playerId: "rb1", slot: "RB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
      { pickNumber: 3, round: 1, teamId: "t1", playerId: "rb2", slot: "RB" as const, slotIndex: 1, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
    ];
    const view = { ...SNAKE_VIEW, picks, pickNumber: 12, availablePlayerIds: ["wr1"] };

    it("calls out the player who has lasted past his own rank", () => {
      render(<PlayerPool {...props} view={view} />);
      const row = rowFor("Andre Salas");
      expect(within(row).getByText("+8")).toBeInTheDocument();
      expect(within(row).getByText("steal")).toBeInTheDocument();
    });

    it("says nothing about a prospect who is merely ranked below the slot", () => {
      // At pick 1 nobody has lasted anywhere; every row below the slot is a trivial "reach" and
      // none of them earns a chip.
      render(<PlayerPool {...props} view={{ ...SNAKE_VIEW, pickNumber: 1 }} />);
      expect(screen.queryByText("reach")).toBeNull();
      expect(screen.queryByText("steal")).toBeNull();
    });

    it("judges nothing at all before the draft has started", () => {
      const scheduled = { ...SNAKE_VIEW, phase: "scheduled" as const, availablePlayerIds: [], onClockTeamId: null, pickNumber: 0 };
      render(<PlayerPool {...props} view={scheduled} canAct={false} />);
      expect(screen.queryByText("steal")).toBeNull();
    });
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
