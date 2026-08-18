import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { JoinForm } from "./join-form";
import { LeagueRoomDepsProvider } from "../hooks/deps";

// `JoinForm` navigates via `next/navigation`'s `useRouter` after a successful join, which
// throws outside a mounted App Router. Stubbing the hook — not the component — keeps this a
// real render of `JoinForm`'s own markup and logic.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("JoinForm", () => {
  it("shows the code it is about to accept, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", teamId: "t2", alreadyMember: false } });
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <JoinForm code="SUNDAY12" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("SUNDAY12")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Join this league" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("accepts the invite and reports where to go next", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", teamId: "t2", alreadyMember: false } });
    renderInLeague(<JoinForm code="SUNDAY12" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join this league" }));
    await waitFor(() => expect(fixture.calls).toEqual(["POST /api/invites/SUNDAY12/accept"]));
  });

  it("shows an actionable reason for a dead link", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "That invite link has expired. Ask your commissioner for a new one." });
    renderInLeague(<JoinForm code="SUNDAY12" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join this league" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ask your commissioner for a new one."));
  });
});
