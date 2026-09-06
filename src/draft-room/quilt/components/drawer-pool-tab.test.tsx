import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { PLAYERS } from "../../test-fixtures";
import { DrawerPoolTab } from "./drawer-pool-tab";

function mount() {
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
    expect(note.textContent).toContain("usually drafted");
  });

  it("shows nothing when a projected position's filter is on", () => {
    mount();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show WR only" }));
    });
    expect(screen.queryByTestId("market-order-note")).not.toBeInTheDocument();
  });
});
