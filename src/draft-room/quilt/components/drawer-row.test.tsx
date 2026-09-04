import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Player } from "@/domain/player";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { DrawerRow } from "./drawer-row";

const PLAYER: Player = { id: "wr1", name: "Puka Nacua", position: "WR", nflTeam: "LAR", headshotUrl: null, adp: 12 };

function mount(onPeek = vi.fn<(playerId: string) => void>()) {
  render(
    <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
      <PlayerPeekHost />
      <ul>
        <DrawerRow leagueId="l1" player={PLAYER} rank={1} onPeek={onPeek} actions={<button type="button">Draft</button>} />
      </ul>
    </LeagueRoomDepsProvider>,
  );
  return onPeek;
}

/**
 * Player-name adoption sweep (task 3): `DrawerRow` (shared by the POOL, MY SHEET and BYES tabs)
 * used to hang the room's own draft-context card (board rank, sheet rank, notes, Draft/Queue)
 * off the NAME itself — a second local peek implementation, and exactly what the sweep's "one
 * primitive" rule rules out. The name now goes through `PlayerName` (the season peek); the
 * row's own card is a sibling "Card" button, never nested inside another control.
 */
describe("DrawerRow — player-name adoption", () => {
  it("makes the name a pressable button that opens the season peek", async () => {
    mount();
    const name = screen.getByRole("button", { name: "Puka Nacua" });
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Puka Nacua" })).toBeInTheDocument();
  });

  it("keeps the room's own draft-context card one tap away, as a sibling control", () => {
    const onPeek = mount();
    fireEvent.click(screen.getByRole("button", { name: "Puka Nacua's draft card" }));
    expect(onPeek).toHaveBeenCalledWith("wr1");
  });

  it("is axe-clean with the name, the card button and a trailing action all present — no nested-interactive controls", async () => {
    const { container } = render(
      <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
        <ul>
          <DrawerRow leagueId="l1" player={PLAYER} rank={1} onPeek={vi.fn()} actions={<button type="button">Draft</button>} />
        </ul>
      </LeagueRoomDepsProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
