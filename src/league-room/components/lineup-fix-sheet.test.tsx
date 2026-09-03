import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { LeagueRoomDepsProvider, type LeagueRoomDeps } from "../hooks/deps";
import type { LineupFixPlan } from "../lib/lineup-problems";
import { LINEUP } from "../test-fixtures";
import { LineupFixSheet } from "./lineup-fix-sheet";

function capturingDeps(response: unknown = { ok: true, data: {} }) {
  const calls: { url: string; body: unknown }[] = [];
  const deps: LeagueRoomDeps = {
    fetchJson: (url, init) => {
      calls.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      return Promise.resolve({ json: () => Promise.resolve(response) } as Response);
    },
    openEventSource: () => ({ addEventListener: () => undefined, close: () => undefined }),
  };
  return { deps, calls };
}

const PLAN: LineupFixPlan = {
  problem: { slot: "WR", slotIndex: 1, reason: "bye", severity: 2, playerId: "wr2", playerName: "Zay Flowers", position: "WR" },
  candidates: [
    {
      playerId: "wr3",
      playerName: "Romeo Doubs",
      position: "WR",
      nflTeam: "GB",
      projection: 9.8,
      adp: 90,
      fixture: { opp: "vs MIN", when: "Sun 1:00p", status: "scheduled" },
      delta: 9.8,
    },
    {
      playerId: "wr4",
      playerName: "Quentin Johnston",
      position: "WR",
      nflTeam: "LAC",
      projection: 6.4,
      adp: 120,
      fixture: { opp: "@ KC", when: "Sun 4:05p", status: "scheduled" },
      delta: 6.4,
    },
  ],
  hasProjections: true,
  totalBefore: 114.6,
  totalAfter: 124.4,
};

const LINEUP_WITH_WR: typeof LINEUP = {
  ...LINEUP,
  starters: [
    ...LINEUP.starters,
    { slot: "WR", slotIndex: 1, playerId: "wr2", playerName: "Zay Flowers", position: "WR", nflTeam: "BAL", headshotUrl: null, adp: null },
  ],
};

const sheet = (deps: LeagueRoomDeps, onFixed = vi.fn(), onClose = vi.fn()) => (
  <LeagueRoomDepsProvider deps={deps}>
    <LineupFixSheet
      leagueId="l1"
      weekNumber={5}
      lineup={LINEUP_WITH_WR}
      rosterSlots={STANDARD_ROSTER_SLOTS}
      plan={PLAN}
      onClose={onClose}
      onFixed={onFixed}
    />
  </LeagueRoomDepsProvider>
);

describe("LineupFixSheet", () => {
  it("leads with the recommendation, its evidence, and the priced delta", () => {
    render(sheet(capturingDeps().deps));
    expect(screen.getByRole("dialog", { name: "Fix your WR2" })).toBeTruthy();
    expect(screen.getByText("Start Romeo Doubs")).toBeTruthy();
    expect(screen.getByText("Projects 9.8 this week · plays Sun 1:00p vs MIN")).toBeTruthy();
    expect(screen.getByText("+9.8 over a player on bye")).toBeTruthy();
  });

  it("states the projected total before and after, and the alternatives one line each", () => {
    render(sheet(capturingDeps().deps));
    expect(screen.getByText("114.60")).toBeTruthy();
    expect(screen.getByText("124.40")).toBeTruthy();
    expect(screen.getByText("Quentin Johnston")).toBeTruthy();
  });

  it("commits the chosen start through the lineup endpoint, starters only", async () => {
    const { deps, calls } = capturingDeps({ ok: true, data: {} });
    const onFixed = vi.fn();
    render(sheet(deps, onFixed));
    fireEvent.click(screen.getByRole("button", { name: "Start Doubs" }));
    await waitFor(() => expect(onFixed).toHaveBeenCalledTimes(1));
    expect(calls[0]?.url).toBe("/api/leagues/l1/teams/me/lineup");
    expect(calls[0]?.body).toEqual({
      weekNumber: 5,
      slots: [
        { slot: "QB", slotIndex: 0, playerId: "qb1" },
        { slot: "RB", slotIndex: 0, playerId: "rb1" },
        { slot: "WR", slotIndex: 1, playerId: "wr3" },
      ],
    });
  });

  it("shows the service's refusal sentence and commits nothing", async () => {
    const { deps } = capturingDeps({ ok: false, error: "That lineup slot has already locked." });
    const onFixed = vi.fn();
    render(sheet(deps, onFixed));
    fireEvent.click(screen.getByRole("button", { name: "Start Doubs" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That lineup slot has already locked."));
    expect(onFixed).not.toHaveBeenCalled();
  });

  it("offers no invented fix when the bench has nobody", () => {
    render(
      <LeagueRoomDepsProvider deps={capturingDeps().deps}>
        <LineupFixSheet
          leagueId="l1"
          weekNumber={5}
          lineup={LINEUP_WITH_WR}
          rosterSlots={STANDARD_ROSTER_SLOTS}
          plan={{ ...PLAN, candidates: [], totalAfter: null }}
          onClose={vi.fn()}
          onFixed={vi.fn()}
        />
      </LeagueRoomDepsProvider>,
    );
    expect(screen.getByText(/No bench player fits this slot right now/)).toBeTruthy();
  });
});
