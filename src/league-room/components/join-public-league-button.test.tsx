import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { JoinPublicLeagueButton } from "./join-public-league-button";
import { LeagueRoomDepsProvider } from "../hooks/deps";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

describe("JoinPublicLeagueButton", () => {
  it("names the league it joins, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <JoinPublicLeagueButton leagueId="p1" leagueName="Rookie Snake Room" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByRole("button", { name: "Join Rookie Snake Room" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("posts the join and lands the manager in their new league", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "p1", teamId: "t9", alreadyMember: false } });
    renderInLeague(<JoinPublicLeagueButton leagueId="p1" leagueName="Rookie Snake Room" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join Rookie Snake Room" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/leagues/p1"));
    expect(fixture.calls).toEqual(["POST /api/public/leagues/p1/join"]);
  });

  it("shows the server's plain-language refusal in place, and stays on the page", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "That league is already full." });
    renderInLeague(<JoinPublicLeagueButton leagueId="p2" leagueName="Sharks Only Auction" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join Sharks Only Auction" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That league is already full.");
    // Task 12 (persona checkpoint, adjudicated): the refusal carries its own measure. In
    // `LeagueRow`'s `max-content` action column an unmeasured paragraph sizes the track to the
    // whole sentence unwrapped, exploding the row's other five columns — the cap makes the
    // sentence wrap inside its own column in the row while changing nothing a card reader sees.
    expect(alert).toHaveClass("max-w-56");
  });

  it("says something useful when the server cannot be reached at all", async () => {
    const fixture = fixtureLeagueDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => {
        throw new Error("offline");
      },
    };
    renderInLeague(<JoinPublicLeagueButton leagueId="p1" leagueName="Rookie Snake Room" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join Rookie Snake Room" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  });
});
