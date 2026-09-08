import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { PLAYERS } from "../../test-fixtures";
import { DrawerPoolTab } from "./drawer-pool-tab";

interface MountOptions {
  readonly odds?: Parameters<typeof DrawerPoolTab>[0]["odds"];
  readonly tiers?: Parameters<typeof DrawerPoolTab>[0]["tiers"];
}

function mount(options: MountOptions = {}) {
  render(
    <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
      <PlayerPeekHost />
      <DrawerPoolTab
        leagueId="l1"
        players={PLAYERS}
        available={new Set(PLAYERS.map((player) => player.id))}
        byeWeeks={new Map()}
        reasons={new Map()}
        focusSearch={false}
        odds={options.odds}
        tiers={options.tiers}
        canDraft
        submitting={false}
        queuedPlayerIds={new Set()}
        onDraft={vi.fn()}
        onQueueToggle={vi.fn()}
        onPeek={vi.fn()}
      />
    </LeagueRoomDepsProvider>,
  );
}

describe("DrawerPoolTab — player-name adoption (task 3)", () => {
  it("makes every pool row's name a pressable button that opens the season peek, axe-clean", async () => {
    const { container } = render(
      <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
        <PlayerPeekHost />
        <DrawerPoolTab
          leagueId="l1"
          players={PLAYERS}
          available={new Set(PLAYERS.map((player) => player.id))}
          byeWeeks={new Map()}
          reasons={new Map()}
          focusSearch={false}
          canDraft
          submitting={false}
          queuedPlayerIds={new Set()}
          onDraft={vi.fn()}
          onQueueToggle={vi.fn()}
          onPeek={vi.fn()}
        />
      </LeagueRoomDepsProvider>,
    );
    const name = screen.getByRole("button", { name: PLAYERS[0]!.name });
    expect(await axe(container)).toHaveNoViolations();
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: PLAYERS[0]!.name })).toBeInTheDocument();
  });

  it("still reaches the room's own card button beside the name", () => {
    mount();
    expect(screen.getByRole("button", { name: `${PLAYERS[0]!.name}'s draft card` })).toBeInTheDocument();
  });
});

/**
 * THE MARKET-ORDER NOTE (the 2026-09-05 kicker and team defence round). Both positions failed their
 * preregistered gates, so the engine publishes no projection for either. A tab of rows with no
 * numbers and no sentence saying why reads as a bug, and this is the sentence.
 */
describe("DrawerPoolTab — a position with no projection says so", () => {
  it("shows nothing over the mixed list, where the claim would not be about the rows", () => {
    mount();
    expect(screen.queryByTestId("market-order-note")).not.toBeInTheDocument();
  });

  it("shows the note when the kicker filter is on, and names the position in full", () => {
    mount();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show K only" }));
    });
    const note = screen.getByTestId("market-order-note");
    expect(note.textContent).toContain("Kickers");
    expect(note.textContent).toContain("ranked by ADP");
  });

  it("shows nothing when a projected position's filter is on", () => {
    mount();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show WR only" }));
    });
    expect(screen.queryByTestId("market-order-note")).not.toBeInTheDocument();
  });
});

describe("DrawerPoolTab — the advisor's odds on every row (simplification round)", () => {
  const odds = { pickNumber: 20, runs: 200, survived: Object.fromEntries(PLAYERS.map((player, index) => [player.id, index === 0 ? 40 : 180])) };

  it("prints no odds and no tier headers until the advisor has some", () => {
    mount();
    expect(screen.queryAllByTestId("advisor-odds-pct")).toHaveLength(0);
    expect(screen.queryAllByTestId("advisor-tier-header")).toHaveLength(0);
  });

  it("prints a banded percentage on every row with the runs in its tooltip", () => {
    mount({ odds });
    const chips = screen.getAllByTestId("advisor-odds-pct");
    expect(chips).toHaveLength(PLAYERS.length);
    expect(chips[0]).toHaveTextContent("20%");
    expect(chips[0]).toHaveAttribute("data-band", "reach");
    expect(chips[0]).toHaveAttribute("title", "still there at your next pick, 40 of 200 runs");
    expect(chips[1]).toHaveAttribute("data-band", "safe");
  });

  it("groups one position under its tier headers, board order kept inside a tier, and none over the mixed list", () => {
    const position = PLAYERS[0]!.position;
    const same = PLAYERS.filter((player) => player.position === position);
    const tiers = Object.fromEntries(same.map((player, index) => [player.id, { tier: index === 0 ? 2 : 1, left: 1, size: 2 }]));
    mount({ odds, tiers });
    expect(screen.queryAllByTestId("advisor-tier-header")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: `Show ${position} only` }));
    const headers = screen.getAllByTestId("advisor-tier-header");
    expect(headers.map((header) => header.textContent)).toEqual(same.length > 1 ? ["Tier 1, 1 of 2 left", "Tier 2, 1 of 2 left"] : ["Tier 2, 1 of 2 left"]);
    const list = screen.getByRole("list", { name: "Available players, best first" });
    const order = [...list.querySelectorAll('[data-testid="drawer-row"], [data-testid="advisor-tier-header"]')].map((node) => node.getAttribute("data-testid"));
    expect(order[0]).toBe("advisor-tier-header");
  });
});
