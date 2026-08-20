import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { LeagueTerms } from "@/league";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { JoinForm } from "./join-form";
import { LeagueRoomDepsProvider } from "../hooks/deps";

// `JoinForm` navigates via `next/navigation`'s `useRouter` after a successful join, which
// throws outside a mounted App Router. Stubbing the hook — not the component — keeps this a
// real render of `JoinForm`'s own markup and logic.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const TERMS: LeagueTerms = {
  name: "Sunday Money",
  format: "snake",
  teamCount: 12,
  filledTeams: 8,
  scoringLabel: "PPR",
  rosterLine: "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench",
  stakeLabel: "Friendly",
  stakeDisclosure: MATCHMAKING_CONFIG.stakeDisclosure,
  commissionerName: "Alex Rivera",
  commissionerAvatar: null,
};

describe("JoinForm", () => {
  it("names the league before asking anyone to join it, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <JoinForm code="SUNDAY12" />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(await screen.findByRole("heading", { name: "Sunday Money" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Join Sunday Money" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    expect(fixture.calls.every((call) => call === "GET /api/invites/SUNDAY12")).toBe(true);
  });

  // First-timer persona review, fix round 1: nothing anywhere in the invite flow said what
  // JOINING MEANS. Lives in JoinForm, not the shared `LeagueTermsPanel` — see the sibling
  // assertion in `league-home.test.tsx` that this sentence does NOT appear post-join.
  it("says what joining means before asking anyone to do it", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    renderInLeague(<JoinForm code="SUNDAY12" />, fixture.deps);
    expect(
      await screen.findByText("Joining puts you in the draft and the season that follows. You'll set a lineup every week."),
    ).toBeInTheDocument();
  });

  it("shows the same terms with a sign-in call to action when nobody is signed in", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    renderInLeague(<JoinForm code="SUNDAY12" signedIn={false} />, fixture.deps);

    // The terms themselves are identical — an account changes the ACTION, never the facts.
    expect(await screen.findByRole("heading", { name: "Sunday Money" })).toBeInTheDocument();
    expect(screen.getByText(TERMS.rosterLine)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to join Sunday Money" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("button", { name: /^Join/ })).not.toBeInTheDocument();
  });

  it("shows a loading skeleton before the preview resolves", () => {
    const fixture = fixtureLeagueDeps(undefined, { deferred: true });
    renderInLeague(<JoinForm code="SUNDAY12" />, fixture.deps);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("accepts the invite and reports where to go next", async () => {
    const fixture = fixtureLeagueDeps(undefined, { deferred: true });
    renderInLeague(<JoinForm code="SUNDAY12" />, fixture.deps);
    await fixture.settle(0, { ok: true, data: TERMS });

    const button = await screen.findByRole("button", { name: "Join Sunday Money" });
    fireEvent.click(button);
    await waitFor(() => expect(fixture.pending()).toBe(1));
    await fixture.settle(1, { ok: true, data: { leagueId: "l1", teamId: "t2", alreadyMember: false } });

    await waitFor(() =>
      expect(fixture.calls).toEqual(["GET /api/invites/SUNDAY12", "POST /api/invites/SUNDAY12/accept"]),
    );
  });

  it("offers a way back to Commish, never a dead end, when the code itself is invalid", async () => {
    const fixture = fixtureLeagueDeps({
      ok: false,
      error: "That invite link isn't valid. Ask your commissioner for a new one.",
    });
    renderInLeague(<JoinForm code="NOPE9999" />, fixture.deps);
    expect(await screen.findByText("Ask your commissioner for a new one.", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Join/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Commish" })).toHaveAttribute("href", "/app");
  });

  it("shows an actionable reason for a dead link at accept time", async () => {
    const fixture = fixtureLeagueDeps(undefined, { deferred: true });
    renderInLeague(<JoinForm code="SUNDAY12" />, fixture.deps);
    await fixture.settle(0, { ok: true, data: TERMS });

    const button = await screen.findByRole("button", { name: "Join Sunday Money" });
    fireEvent.click(button);
    await waitFor(() => expect(fixture.pending()).toBe(1));
    await fixture.settle(1, { ok: false, error: "That invite link has expired. Ask your commissioner for a new one." });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ask your commissioner for a new one."));
  });
});
