import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { CompletedPick } from "@/draft-engine";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../../test-fixtures";
import { DrawerPicksTab } from "./drawer-picks-tab";

const PICKS: readonly CompletedPick[] = [
  { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
];

function mount(onPeek = vi.fn<(playerId: string) => void>()) {
  render(
    <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
      <PlayerPeekHost />
      <DrawerPicksTab view={{ ...SNAKE_VIEW, picks: PICKS }} teams={TEAMS} playersById={playersById(PLAYERS)} myTeamId="t1" onPeek={onPeek} />
    </LeagueRoomDepsProvider>,
  );
  return onPeek;
}

describe("DrawerPicksTab — player-name adoption (task 3)", () => {
  it("makes the picked player's name a pressable button that opens the season peek", async () => {
    mount();
    const name = screen.getByRole("button", { name: "Jalen Croft" });
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Jalen Croft" })).toBeInTheDocument();
  });

  it("keeps the room's own draft-context card one tap away, as a sibling control", () => {
    const onPeek = mount();
    fireEvent.click(screen.getByRole("button", { name: "Jalen Croft's draft card" }));
    expect(onPeek).toHaveBeenCalledWith("qb1");
  });

  it("is axe-clean — no nested-interactive controls between the name and the card button", async () => {
    const { container } = render(
      <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
        <DrawerPicksTab view={{ ...SNAKE_VIEW, picks: PICKS }} teams={TEAMS} playersById={playersById(PLAYERS)} myTeamId="t1" onPeek={vi.fn()} />
      </LeagueRoomDepsProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
