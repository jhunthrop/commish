import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { TeamNameField } from "./team-name-field";

const MAX = 40;

describe("TeamNameField", () => {
  it("shows the stored name and writes the caller's own team", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { name: "Bay Bandits" } });
    renderInLeague(<TeamNameField leagueId="l1" initialName="Team One" maxLength={MAX} />, fixture.deps);

    const field = screen.getByLabelText("Team name");
    expect(field).toHaveValue("Team One");
    fireEvent.change(field, { target: { value: "Bay Bandits" } });
    fireEvent.submit(screen.getByRole("form", { name: "Name your team" }));

    await waitFor(() => expect(fixture.calls).toContain("PUT /api/leagues/l1/team-name"));
    // The STORED name, not the typed one — the schema trims, and the field shows what the room
    // will actually call this manager all season.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved. The room calls you Bay Bandits now."));
  });

  /**
   * FIX ROUND 1, MEDIUM 6. Without this an over-length name only failed on the round trip, which
   * is a refusal the field could have made before the manager finished typing. The number is
   * `LEAGUE_CONFIG.maxNameLength`, threaded from the server page rather than retyped here: the
   * client boundary forbids a value import of `@/league` from a room directory.
   */
  it("caps the field at the same length the schema enforces", () => {
    renderInLeague(<TeamNameField leagueId="l1" initialName="Team One" maxLength={MAX} />, fixtureLeagueDeps().deps);
    expect(screen.getByLabelText("Team name")).toHaveAttribute("maxLength", String(MAX));
  });

  it("says the server's own refusal in place, and keeps what was typed", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "Please use only characters people can see." });
    renderInLeague(<TeamNameField leagueId="l1" initialName="Team One" maxLength={MAX} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "Bay Bandits" } });
    fireEvent.submit(screen.getByRole("form", { name: "Name your team" }));

    await waitFor(() => expect(screen.getByText("Please use only characters people can see.")).toBeInTheDocument());
    expect(screen.getByLabelText("Team name")).toHaveValue("Bay Bandits");
  });

  it("refuses to submit an empty name at all, rather than asking the server", () => {
    renderInLeague(<TeamNameField leagueId="l1" initialName="Team One" maxLength={MAX} />, fixtureLeagueDeps().deps);
    fireEvent.change(screen.getByLabelText("Team name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("is accessible in both themes", async () => {
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>
        <TeamNameField leagueId="l1" initialName="Team One" maxLength={MAX} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
