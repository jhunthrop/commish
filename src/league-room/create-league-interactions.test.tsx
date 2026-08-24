import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
import { WaitingRoom, type WaitingRoomLeague } from "./components/waiting-room";

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

  /**
   * THE COMPOSED PROOF, end to end through real components: a `when_full` league, created
   * through the ACTUAL create form (public visibility, the sit-and-go trigger, both reachable
   * only because this task promoted/wired them), and the room a member of that league lands in
   * while it is still filling. Task 8 shipped `WaitingRoom` with nothing that could ever produce
   * a `when_full` league to render it for (its own report: "No production code path currently
   * creates a `when_full` league through the ordinary UI"); this closes that gap.
   *
   * `WaitingRoom` is fed a hand-built `WaitingRoomLeague` rather than a second network round
   * trip: `CreateLeagueBody` (the route's real response shape, `../contract`) never carries
   * `startTrigger` or `kickoffAt` — a member's own `leagueHome`/`draftScheduleView` read hands
   * those back on the NEXT navigation, not on creation's response — so this composes the
   * commissioner's own submitted choices with the created ids exactly the way `test-fixtures.tsx`'s
   * own `DRAFT_SCHEDULE` is built by hand from `HOME`'s fields, for the identical reason.
   */
  it("creates a when_full public league through the real form, and a member's WaitingRoom shows it filling", async () => {
    const created = { leagueId: "l2", teamId: "t2", draftId: "d2" };
    const fixture = fixtureLeagueDeps({ ok: true, data: created });
    const bodies: unknown[] = [];
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    const onCreated = vi.fn();
    const view = renderInLeague(<CreateLeagueForm onCreated={onCreated} />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Sit and Go Sunday" } });
    fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });
    fireEvent.click(screen.getByText(/Advanced settings/));
    fireEvent.change(screen.getByLabelText("Draft start"), { target: { value: "when_full" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));

    const body = bodies[0] as { readonly visibility: string; readonly startTrigger: string; readonly teamCount: number };
    expect(body).toMatchObject({ visibility: "public", startTrigger: "when_full" });
    view.unmount();

    // What a member's own `leagueHome` read hands `WaitingRoom` for THIS league, on the very
    // next navigation: the fill trigger has not fired yet (`kickoffAt` is still the creation-time
    // placeholder `createLeague` writes for every league, `when_full` included), and only one of
    // the league's own seats is taken so far.
    const waitingRoomLeague: WaitingRoomLeague = {
      draftId: created.draftId,
      leagueId: created.leagueId,
      status: "scheduled",
      kickoffAt: "2026-09-01T00:00:00.000Z",
      isPublicMatchmade: true,
      startTrigger: body.startTrigger as "scheduled" | "when_full",
      kickoffRolls: 0,
      filledTeams: 1,
      teamCount: body.teamCount,
      slotPreference: null,
      authority: { kind: "member", userId: "commish_1" },
    };
    render(<WaitingRoom league={waitingRoomLeague} isCommissioner={true} />);
    expect(screen.getByText(`1 of ${body.teamCount} seats taken`)).toBeVisible();
    // The filling state's own promise: no countdown yet, because nothing has fired.
    expect(screen.queryByText(/Starts in/)).not.toBeInTheDocument();
  });
});
