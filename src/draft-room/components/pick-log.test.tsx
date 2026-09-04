import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { CompletedPick } from "@/draft-engine";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { PLAYERS, SNAKE_VIEW, TEAMS, playersById } from "../test-fixtures";
import { PickLog } from "./pick-log";

const PICKS: readonly CompletedPick[] = [
  { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false },
];

/**
 * The auction room's own history band (`auction-room.tsx`) — the "room furniture" surfaces the
 * player-name adoption sweep found alongside `PickWire`. No other control sits in a pick-log row,
 * so the name goes straight through `PlayerName` with no restructuring needed.
 */
describe("PickLog — player-name adoption", () => {
  it("makes every logged pick's name a pressable button that opens the season peek, axe-clean", async () => {
    const { container } = render(
      <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
        <PlayerPeekHost />
        <PickLog view={{ ...SNAKE_VIEW, picks: PICKS }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} myTeamId="t1" />
      </LeagueRoomDepsProvider>,
    );
    const name = screen.getByRole("button", { name: "Jalen Croft" });
    expect(await axe(container)).toHaveNoViolations();
    await act(async () => {
      fireEvent.click(name);
    });
    expect(screen.getByRole("dialog", { name: "Jalen Croft" })).toBeInTheDocument();
  });
});
