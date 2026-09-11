import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { FreeAgentRow } from "@/league-service/claims-contract";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "../hooks/deps";
import { PlayerPeekHost } from "./player-peek";
import { RoomSurfacePlayers } from "./room-surface-players";

const AGENT: FreeAgentRow = { id: "wr1", name: "Puka Nacua", position: "WR", nflTeam: "LAR", headshotUrl: null, adp: 12 };

function fixtureDeps(agents: readonly FreeAgentRow[] = [AGENT]): LeagueRoomDeps {
  return {
    // The season-peek fetch (`/player-season`) answers `ok: false` — this fixture cares only
    // about the free-agent list's own envelope shape, and the peek's own degrade-gracefully
    // path is `player-peek.tsx`'s to prove.
    fetchJson: (url) =>
      Promise.resolve(
        new Response(JSON.stringify(url.includes("/player-season") ? { ok: false, error: "not available" } : { ok: true, data: { agents } })),
      ),
    openEventSource: () => ({ addEventListener: () => {}, close: () => {} }),
  };
}

/** The players surface's own row — task 4's straggler audit found the free-agent name a bare
 *  `<span>` with no other control on the row, so it goes straight through `PlayerName`. */
describe("RoomSurfacePlayers — player-name adoption (task 4)", () => {
  it("makes every free agent's name a pressable button that opens the season peek, axe-clean", async () => {
    const { container } = render(
      <LeagueRoomDepsProvider deps={fixtureDeps()}>
        <PlayerPeekHost />
        <RoomSurfacePlayers
          leagueId="l1"
          canClaim
          projectionsByPlayerId={new Map()}
          fixturesByNflTeam={new Map()}
          pendingClaims={[]}
          searchFocusToken={0}
          onClaim={vi.fn()}
        />
      </LeagueRoomDepsProvider>,
    );
    const name = await screen.findByRole("button", { name: "Puka Nacua" });
    expect(await axe(container)).toHaveNoViolations();
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Puka Nacua" })).toBeInTheDocument();
  });

  it("still offers the Claim verb as a sibling control, never nested inside the name", async () => {
    render(
      <LeagueRoomDepsProvider deps={fixtureDeps()}>
        <RoomSurfacePlayers
          leagueId="l1"
          canClaim
          projectionsByPlayerId={new Map()}
          fixturesByNflTeam={new Map()}
          pendingClaims={[]}
          searchFocusToken={0}
          onClaim={vi.fn()}
        />
      </LeagueRoomDepsProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Claim" })).toBeInTheDocument());
  });
});
