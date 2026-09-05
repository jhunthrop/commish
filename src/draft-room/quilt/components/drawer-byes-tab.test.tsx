import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { PLAYERS } from "../../test-fixtures";
import { DrawerByesTab } from "./drawer-byes-tab";

function mount() {
  render(
    <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
      <PlayerPeekHost />
      <DrawerByesTab
        leagueId="l1"
        players={PLAYERS}
        available={new Set(PLAYERS.map((player) => player.id))}
        byeWeeks={new Map([["KC", 10]])}
        canDraft
        submitting={false}
        onDraft={vi.fn()}
        onPeek={vi.fn()}
      />
    </LeagueRoomDepsProvider>,
  );
}

describe("DrawerByesTab — player-name adoption (task 3)", () => {
  it("makes every banded row's name a pressable button that opens the season peek", async () => {
    mount();
    const name = screen.getByRole("button", { name: "Jalen Croft" });
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Jalen Croft" })).toBeInTheDocument();
  });

  it("is axe-clean", async () => {
    const { container } = render(
      <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
        <DrawerByesTab
          leagueId="l1"
          players={PLAYERS}
          available={new Set(PLAYERS.map((player) => player.id))}
          byeWeeks={new Map([["KC", 10]])}
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
