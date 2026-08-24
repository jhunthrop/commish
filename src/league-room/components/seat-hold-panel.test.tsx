import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { SeatHoldPanel } from "./seat-hold-panel";

describe("SeatHoldPanel", () => {
  it("claims a hold on mount and shows the countdown plus the way in, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() } });
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <SeatHoldPanel leagueId="lg1" leagueName="Rookie Snake Room" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(await screen.findByText("Rookie Snake Room")).toBeInTheDocument();
        expect(screen.getByTestId("seat-hold-countdown")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Sign in to finish joining Rookie Snake Room" })).toHaveAttribute(
          "href",
          "/sign-in?returnTo=%2Fjoin%2Flg1%2Fhold",
        );
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    expect(fixture.calls).toEqual(["POST /api/public/leagues/lg1/hold", "POST /api/public/leagues/lg1/hold"]);
  });

  // Gauntlet fix wave, item 11 (JF-H4): C3's safety-net sentence reaches the join flow's own
  // first screen now — the hold page is where a first-timer first asks "what if I miss it".
  it("answers the first-timer's own question, verbatim, once the hold lands", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() } });
    renderInLeague(<SeatHoldPanel leagueId="lg1" leagueName="Rookie Snake Room" />, fixture.deps);
    expect(await screen.findByText("The room picks for you from your queue if your clock runs out.")).toBeInTheDocument();
  });

  it("shows a loading skeleton before the claim resolves", () => {
    const fixture = fixtureLeagueDeps(undefined, { deferred: true });
    renderInLeague(<SeatHoldPanel leagueId="lg1" leagueName="Rookie Snake Room" />, fixture.deps);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("offers a way to browse rather than a dead end when the seat could not be held", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "That league is already full." });
    renderInLeague(<SeatHoldPanel leagueId="lg1" leagueName="Rookie Snake Room" />, fixture.deps);
    expect(await screen.findByText("That league is already full.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
  });

  it("re-claims when the league changes under it", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() } });
    const view = renderInLeague(<SeatHoldPanel leagueId="lg1" leagueName="First League" />, fixture.deps);
    await waitFor(() => expect(fixture.calls).toEqual(["POST /api/public/leagues/lg1/hold"]));

    view.rerender(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <SeatHoldPanel leagueId="lg2" leagueName="Second League" />
      </LeagueRoomDepsProvider>,
    );
    await waitFor(() => expect(fixture.calls).toEqual(["POST /api/public/leagues/lg1/hold", "POST /api/public/leagues/lg2/hold"]));
  });
});
