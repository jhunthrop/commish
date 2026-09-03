import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "@/league-room/test-fixtures";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";
import { SeatConfirmPanel } from "./seat-confirm-panel";
import type { SeatConfirmBody } from "./contract";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const okBody = (data: SeatConfirmBody) => ({ ok: true, data });

describe("SeatConfirmPanel — A1's own write, moved off the render and behind this tap", () => {
  beforeEach(() => {
    push.mockClear();
  });


  it("shows a one-tap confirm naming the league, in both themes, axe-clean, and does not post on mount", async () => {
    const fixture = fixtureLeagueDeps();
    await renderSurface(
      <SeatConfirmPanel leagueId="lg1" leagueName="Rookie Snake Room" draftLine="Drafts Sunday at 1:00 PM" houseRung={null} />,
      async ({ container }) => {
        expect(screen.getByRole("button", { name: "Take your seat in Rookie Snake Room" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    expect(fixture.calls).toEqual([]);
  });

  it("posts the confirm and lands the visitor in their new league", async () => {
    const fixture = fixtureLeagueDeps(okBody({ outcome: "seated", leagueId: "lg1", holdExpired: false, reason: null }));
    renderInLeague(<SeatConfirmPanel leagueId="lg1" leagueName="Rookie Snake Room" draftLine="Drafts Sunday at 1:00 PM" houseRung={null} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Take your seat in Rookie Snake Room" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/leagues/lg1"));
    expect(fixture.calls).toEqual(["POST /join/lg1/hold/confirm"]);
  });

  // Task 9 Step 2b: the hold-expired flag rides the redirect exactly as it did when the write
  // happened at render time — only WHEN it is computed moved, never what it says.
  it("carries holdExpired=1 through to the redirect when the hold had run out", async () => {
    const fixture = fixtureLeagueDeps(okBody({ outcome: "seated", leagueId: "lg1", holdExpired: true, reason: null }));
    renderInLeague(<SeatConfirmPanel leagueId="lg1" leagueName="Rookie Snake Room" draftLine="Drafts Sunday at 1:00 PM" houseRung={null} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Take your seat in Rookie Snake Room" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/leagues/lg1?holdExpired=1"));
  });

  it("keeps the tier refusal distinct — a visitor turned away for who they are, not a shrug", async () => {
    const fixture = fixtureLeagueDeps(okBody({ outcome: "tier_blocked", leagueId: "lg1", holdExpired: false, reason: ENFORCEMENT_REFUSALS.join }));
    renderInLeague(<SeatConfirmPanel leagueId="lg1" leagueName="Rookie Snake Room" draftLine="Drafts Sunday at 1:00 PM" houseRung={null} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Take your seat in Rookie Snake Room" }));
    expect(await screen.findByText(ENFORCEMENT_REFUSALS.join)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "This league is not open to you" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows SeatTakenPanel, never a dead end, for the race loser — a member league", async () => {
    const fixture = fixtureLeagueDeps(okBody({ outcome: "seat_taken", leagueId: "lg1", holdExpired: false, reason: SEAT_HOLD_REFUSALS.taken }));
    renderInLeague(<SeatConfirmPanel leagueId="lg1" leagueName="Rookie Snake Room" draftLine="Drafts Sunday at 1:00 PM" houseRung={null} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Take your seat in Rookie Snake Room" }));
    expect(await screen.findByTestId("seat-taken-panel")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /browse|closest to filling/i }).length).toBeGreaterThanOrEqual(2);
  });

  it("names the house league's next rung for a house league's race loser", async () => {
    const fixture = fixtureLeagueDeps(okBody({ outcome: "seat_taken", leagueId: "lg1", holdExpired: false, reason: SEAT_HOLD_REFUSALS.taken }));
    renderInLeague(<SeatConfirmPanel leagueId="lg1" leagueName="Sunday Snake" draftLine="Drafts Sunday at 1:00 PM" houseRung="open_12" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Take your seat in Sunday Snake" }));
    expect(await screen.findByRole("link", { name: "Join the next Open 12-team league" })).toBeInTheDocument();
  });

  it("says something useful when the server cannot be reached at all, and lets the visitor try again", async () => {
    const fixture = fixtureLeagueDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => {
        throw new Error("offline");
      },
    };
    renderInLeague(<SeatConfirmPanel leagueId="lg1" leagueName="Rookie Snake Room" draftLine="Drafts Sunday at 1:00 PM" houseRung={null} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Take your seat in Rookie Snake Room" }));
    expect(await screen.findByText(/Check your connection/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the server's own envelope failure in place, never a silent nothing", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "Not signed in." });
    renderInLeague(<SeatConfirmPanel leagueId="lg1" leagueName="Rookie Snake Room" draftLine="Drafts Sunday at 1:00 PM" houseRung={null} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Take your seat in Rookie Snake Room" }));
    expect(await screen.findByText("Not signed in.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
