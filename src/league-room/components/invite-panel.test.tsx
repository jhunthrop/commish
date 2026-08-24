import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { InvitePanel } from "./invite-panel";
import { LeagueRoomDepsProvider } from "../hooks/deps";

const INVITE = { ok: true, data: { code: "SUNDAY12", path: "/app/join/SUNDAY12", expiresAt: "2026-08-31T12:00:00.000Z", maxUses: 32 } };

describe("InvitePanel", () => {
  it("offers a single next action before any invite exists, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps(INVITE);
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <InvitePanel leagueId="l1" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByRole("button", { name: "Create invite link" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows the link and the short code after minting one", async () => {
    const fixture = fixtureLeagueDeps(INVITE);
    renderInLeague(<InvitePanel leagueId="l1" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    await waitFor(() => expect(screen.getByText("SUNDAY12")).toBeInTheDocument());
    expect(fixture.calls).toEqual(["POST /api/leagues/l1/invites"]);
    expect(screen.getByLabelText("Invite link")).toHaveValue("/app/join/SUNDAY12");
    expect(screen.getByText(/Good for up to 32 people/)).toBeInTheDocument();
  });

  it("shows the server's reason when minting fails", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "We could not create an invite just now. Please try again." });
    renderInLeague(<InvitePanel leagueId="l1" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We could not create an invite"));
  });
});
