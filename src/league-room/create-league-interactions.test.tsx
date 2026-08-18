import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
/**
 * Test-only cross-check that the create+invite flow stays within the spec's interaction
 * budget; this file never ships to the browser bundle, so the "no server-only values in
 * league-room client code" rule doesn't apply to the risk it guards against — same pattern as
 * `src/draft-room/state/format.test.ts`'s cross-check against `@/draft-engine`.
 */
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { LEAGUE_CONFIG } from "@/league";
import { fixtureLeagueDeps, renderInLeague } from "./test-fixtures";
import { CreateLeagueForm } from "./components/create-league-form";
import { InvitePanel } from "./components/invite-panel";

/**
 * The spec's exit criterion, made mechanical: "a user can go from logged in to a created,
 * invitable league in a small number of interactions by accepting defaults — verified by a
 * test that counts the interactions." Every user gesture goes through these two helpers, so
 * the count cannot drift out of the assertion.
 */
let interactions = 0;
const type = (element: HTMLElement, value: string) => {
  interactions += 1;
  fireEvent.change(element, { target: { value } });
};
const click = (element: HTMLElement) => {
  interactions += 1;
  fireEvent.click(element);
};

describe("signed in to an invitable league", () => {
  it(`takes no more than ${LEAGUE_CONFIG.maxCreateInteractions} interactions when defaults are accepted`, async () => {
    interactions = 0;
    const created = { leagueId: "l1", teamId: "t1", draftId: "d1" };
    const fixture = fixtureLeagueDeps({ ok: true, data: created });
    const onCreated = vi.fn();

    const view = renderInLeague(<CreateLeagueForm onCreated={onCreated} />, fixture.deps);
    type(screen.getByLabelText("League name"), "Sunday Money");
    click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));

    // The advanced disclosure was never opened: format, team count, scoring preset and
    // budget all came from the server's defaults.
    expect(view.container.querySelector("details")).not.toHaveAttribute("open");
    expect(fixture.calls).toEqual(["POST /api/leagues"]);
    view.unmount();

    fixture.response = { ok: true, data: { code: "SUNDAY12", path: "/app/join/SUNDAY12", expiresAt: "2026-08-31T12:00:00.000Z", maxUses: 32 } };
    renderInLeague(<InvitePanel leagueId={created.leagueId} />, fixture.deps);
    click(screen.getByRole("button", { name: "Create invite link" }));
    await waitFor(() => expect(screen.getByText("SUNDAY12")).toBeInTheDocument());

    expect(interactions).toBeLessThanOrEqual(LEAGUE_CONFIG.maxCreateInteractions);
  });
});
