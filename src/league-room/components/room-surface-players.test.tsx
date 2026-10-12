import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { FreeAgentRow, PendingWaiverClaim } from "@/league-service/claims-contract";
import type { FixtureLabel } from "@research/reference/nfl-schedule";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { RoomSurfacePlayers } from "./room-surface-players";

/**
 * THE FREE-AGENT HALF OF THE WIRE. Real player shapes, never invented numbers: the names are the
 * nflverse slice the Sideline mocks are drawn from, and every figure in this file is supplied BY
 * the test as the projection read would supply it.
 */
const SHAKIR: FreeAgentRow = {
  id: "p_shakir",
  name: "Khalil Shakir",
  position: "WR",
  nflTeam: "BUF",
  headshotUrl: null,
  adp: 84,
};

const KINCAID: FreeAgentRow = {
  id: "p_kincaid",
  name: "Dalton Kincaid",
  position: "TE",
  nflTeam: "BUF",
  headshotUrl: null,
  adp: 96,
  onWaiversUntil: "2026-09-16T07:00:00.000Z",
};

const FIXTURES: ReadonlyMap<string, FixtureLabel> = new Map<string, FixtureLabel>([
  ["BUF", { when: "Sun 1:00p", opp: "@ MIA", status: "scheduled" }],
]);

const NO_CLAIMS: readonly PendingWaiverClaim[] = [];

function surface(overrides: Partial<React.ComponentProps<typeof RoomSurfacePlayers>> = {}) {
  return (
    <RoomSurfacePlayers
      leagueId="l1"
      canClaim
      projectionsByPlayerId={new Map([["p_shakir", 11.4]])}
      fixturesByNflTeam={FIXTURES}
      pendingClaims={NO_CLAIMS}
      searchFocusToken={0}
      onClaim={() => {}}
      {...overrides}
    />
  );
}

describe("RoomSurfacePlayers", () => {
  it("draws every free agent as a person with one number and one verb, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { agents: [SHAKIR, KINCAID] } });
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>{surface()}</LeagueRoomDepsProvider>,
      async ({ container }) => {
        // P1: the name is the row's own largest thing, and the face is on the row beside it.
        expect(await screen.findByText("Khalil Shakir")).toBeVisible();
        expect(screen.getByText("Dalton Kincaid")).toBeVisible();
        // P3: one control per row, and it is the act the row exists for.
        expect(screen.getAllByRole("button", { name: "Claim" })).toHaveLength(2);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("names the basis of the one number, and renders a dash rather than a zero for a player with no projection", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { agents: [SHAKIR, KINCAID] } });
    renderInLeague(surface(), fixture.deps);

    // P2/P11: the figure carries its own caption, and the player the projection read does not
    // cover says so rather than printing a zero somebody could mistake for a forecast.
    expect(await screen.findByText("11.4")).toBeVisible();
    expect(screen.getAllByText("projected this week").length).toBe(1);
    expect(screen.getByText("no projection this week")).toBeVisible();
  });

  it("says the waiver window on the row that has one, and free agent on the one that does not", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { agents: [SHAKIR, KINCAID] } });
    renderInLeague(surface(), fixture.deps);
    expect(await screen.findByText(/free agent · adds now/)).toBeVisible();
    expect(screen.getByText(/on waivers · clears/)).toBeVisible();
  });

  // FIX ROUND 1, M2. The old board carried a dedicated ADP column at `sm+`; migrating the row to
  // `PlayerRow` dropped the field on the floor with no note that it had gone. It rides the facts
  // line now, in the sanctioned ADP words, and an agent the feed does not rank says so rather
  // than printing a silent gap where a draft cost used to be.
  it("keeps the draft cost on the facts line, and names its absence rather than dropping it", async () => {
    const unranked: FreeAgentRow = { ...KINCAID, id: "p_unranked", name: "Ray Croft", adp: null };
    const fixture = fixtureLeagueDeps({ ok: true, data: { agents: [SHAKIR, unranked] } });
    renderInLeague(surface(), fixture.deps);
    expect(await screen.findByText(/ADP 84/)).toBeVisible();
    expect(screen.getByText(/no ADP/)).toBeVisible();
  });

  // ABSENCE IS ABSENCE. A wire with nobody on it says so in a sentence a person would say, and
  // draws no rows, no skeleton and no zero-filled placeholder.
  it("renders nothing at all when nobody is on the wire, and says so plainly", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { agents: [] } });
    renderInLeague(surface(), fixture.deps);
    // Fix round 1, L3: an UNFILTERED empty wire is a fact about the league, so "that" refers to
    // nothing and the sentence does not use it.
    expect(await screen.findByText("Nobody is on the wire right now.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Claim" })).toBeNull();
  });

  it("says the filter found nobody, rather than that the wire is empty, once something is typed", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { agents: [] } });
    renderInLeague(surface(), fixture.deps);
    fireEvent.change(screen.getByLabelText("Search free agents"), { target: { value: "zzzz" } });
    expect(await screen.findByText("Nobody on the wire matches that.")).toBeVisible();
  });

  it("shows a filed claim's place in line instead of a second Claim on the same player", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { agents: [SHAKIR] } });
    renderInLeague(
      surface({
        pendingClaims: [{ claimId: "c1", playerId: "p_shakir", playerName: "Khalil Shakir", queuePosition: 2 } as PendingWaiverClaim],
      }),
      fixture.deps,
    );
    expect(await screen.findByText("filed · 2nd")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Claim" })).toBeNull();
  });

  it("offers no verb at all to a viewer who cannot claim", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { agents: [SHAKIR] } });
    renderInLeague(surface({ canClaim: false }), fixture.deps);
    expect(await screen.findByText("Khalil Shakir")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Claim" })).toBeNull();
  });

  it("opens the claim sheet through its one verb rather than acting on the spot", async () => {
    const onClaim = vi.fn();
    const fixture = fixtureLeagueDeps({ ok: true, data: { agents: [SHAKIR] } });
    renderInLeague(surface({ onClaim }), fixture.deps);
    (await screen.findByRole("button", { name: "Claim" })).click();
    await waitFor(() => expect(onClaim).toHaveBeenCalledWith(SHAKIR));
  });

  it("says the board did not load, honestly, rather than showing an empty wire", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "nope" });
    renderInLeague(surface(), fixture.deps);
    expect(await screen.findByText("The player pool did not load. Try again in a moment.")).toBeVisible();
    expect(screen.queryByText("Nobody on the wire matches that.")).toBeNull();
  });
});
