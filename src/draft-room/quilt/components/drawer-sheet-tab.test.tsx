import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { PLAYERS, playersById } from "../../test-fixtures";
import { DrawerSheetTab } from "./drawer-sheet-tab";

const SHEET = { order: PLAYERS.map((player) => player.id), notes: {} };

function mount() {
  render(
    <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
      <PlayerPeekHost />
      <DrawerSheetTab
        leagueId="l1"
        sheet={SHEET}
        playersById={playersById(PLAYERS)}
        boardRanks={new Map()}
        available={new Set(PLAYERS.map((player) => player.id))}
        onMove={vi.fn()}
        onSeedQueue={vi.fn()}
        onReset={vi.fn()}
        canDraft
        submitting={false}
        onDraft={vi.fn()}
        onPeek={vi.fn()}
      />
    </LeagueRoomDepsProvider>,
  );
}

describe("DrawerSheetTab — player-name adoption (task 3)", () => {
  it("makes every sheet row's name a pressable button that opens the season peek", async () => {
    mount();
    const name = screen.getByRole("button", { name: "Jalen Croft" });
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Jalen Croft" })).toBeInTheDocument();
  });

  it("is axe-clean with the name, the card button and the reorder verbs all present", async () => {
    const { container } = render(
      <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
        <DrawerSheetTab
          leagueId="l1"
          sheet={SHEET}
          playersById={playersById(PLAYERS)}
          boardRanks={new Map()}
          available={new Set(PLAYERS.map((player) => player.id))}
          onMove={vi.fn()}
          onSeedQueue={vi.fn()}
          onReset={vi.fn()}
          canDraft
          submitting={false}
          onDraft={vi.fn()}
          onPeek={vi.fn()}
        />
      </LeagueRoomDepsProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
