import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { LeagueTerms } from "@/league";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { InviteLanding } from "./invite-landing";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

beforeEach(() => push.mockReset());

const TERMS: LeagueTerms = {
  name: "Sunday Money",
  format: "snake",
  teamCount: 12,
  filledTeams: 8,
  scoringLabel: "PPR",
  rosterLine: "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench",
  stakeLabel: "Friendly",
  stakeDisclosure: MATCHMAKING_CONFIG.stakeDisclosure,
  entryFeeCents: 0,
  commissionerName: "Alex Rivera",
  commissionerAvatar: null,
  draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)",
  formatNotes: [],
};

describe("InviteLanding", () => {
  // The two dead-code-adjacent states this task's own test names call out (expired, and — by the
  // same code path — invalid/exhausted): a real action, never an apology.
  it("renders a real action for a code that has expired, not an apology", () => {
    renderSurface(<InviteLanding state={{ kind: "expired" }} />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Browse open leagues" })).toBeInTheDocument();
    });
  });

  it("renders the same real action for an invalid code and for one already used up", () => {
    for (const kind of ["invalid", "exhausted"] as const) {
      const { unmount } = renderInLeague(<InviteLanding state={{ kind }} />, fixtureLeagueDeps().deps);
      expect(screen.getByRole("link", { name: "Browse open leagues" })).toBeInTheDocument();
      unmount();
    }
  });

  it("tells a visitor who is already in this league that they are, and takes them there", () => {
    renderSurface(<InviteLanding state={{ kind: "already-member", leagueId: "lg_1", name: "Bay Bandits" }} />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Go to Bay Bandits" })).toHaveAttribute("href", "/app/leagues/lg_1");
    });
  });

  it("shows a signed-out visitor the terms and one way in, with their place kept", () => {
    renderSurface(<InviteLanding state={{ kind: "open", terms: TERMS }} signedIn={false} code="abc" />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?returnTo=%2Fapp%2Fjoin%2Fabc");
      expect(getByRole("heading", { name: "Sunday Money" })).toBeInTheDocument();
    });
  });

  it("offers no join button to a signed-out visitor, only the sign-in call to action", () => {
    renderInLeague(<InviteLanding state={{ kind: "open", terms: TERMS }} signedIn={false} code="abc" />, fixtureLeagueDeps().deps);
    expect(screen.queryByRole("button", { name: /^Join/ })).not.toBeInTheDocument();
  });

  it("gives a signed-in visitor the real Join action, terms named first, axe-clean in both themes", async () => {
    await renderSurface(<InviteLanding state={{ kind: "open", terms: TERMS }} code="SUNDAY12" />, async ({ container, getByRole }) => {
      expect(getByRole("heading", { name: "Sunday Money" })).toBeInTheDocument();
      expect(getByRole("button", { name: "Join Sunday Money" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // The seat's own two losing states — the friend who arrived a minute late, and the friend
  // whose invite named a league whose draft had already started. Both reuse `SeatTakenPanel`
  // (F15) rather than a second hand-written "sorry" screen — but a started draft is never a
  // seat-hold race (the invite path takes no hold), so it gets its own reason and its own true
  // title rather than borrowing the capacity panel's wording (fix round 1, review MEDIUM).
  it("renders SeatTakenPanel for a league that filled, with the real capacity title", () => {
    renderInLeague(<InviteLanding state={{ kind: "league-full", name: "Bay Bandits" }} />, fixtureLeagueDeps().deps);
    expect(screen.getByTestId("seat-taken-panel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bay Bandits filled up" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toBeInTheDocument();
  });

  it("renders SeatTakenPanel for a league whose draft already started, with its own accurate title — never the capacity claim", () => {
    renderInLeague(<InviteLanding state={{ kind: "draft-started", name: "Bay Bandits" }} />, fixtureLeagueDeps().deps);
    expect(screen.getByTestId("seat-taken-panel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bay Bandits already started its draft" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bay Bandits filled up" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toBeInTheDocument();
  });

  it("tells a tier-refused visitor why, in the platform's own words, with a way to the shelf", () => {
    renderInLeague(<InviteLanding state={{ kind: "tier-refused" }} />, fixtureLeagueDeps().deps);
    expect(
      screen.getByText(
        "This league is reserved for newer players so everyone starts on a level footing. Browse the open leagues to find one you can join.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toBeInTheDocument();
  });

  // The plumbing behind the four terminal outcomes `JoinForm`'s own accept call can report
  // upward — proven end to end here, through a real click, rather than only as isolated renders
  // of each resulting state above.
  it("switches to the already-member state when a signed-in visitor's own invite says so", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "lg_1", teamId: "t9", alreadyMember: true } });
    renderInLeague(<InviteLanding state={{ kind: "open", terms: TERMS }} code="SUNDAY12" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join Sunday Money" }));
    expect(await screen.findByRole("link", { name: "Go to Sunday Money" })).toHaveAttribute("href", "/app/leagues/lg_1");
    expect(push).not.toHaveBeenCalled();
  });

  it("switches to the league-full state instead of showing an inline error for that one refusal", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "That league is already full." });
    renderInLeague(<InviteLanding state={{ kind: "open", terms: TERMS }} code="SUNDAY12" />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Join Sunday Money" }));
    await waitFor(() => expect(screen.getByTestId("seat-taken-panel")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // A5's nine states, axe-clean, in both themes — every terminal screen this task adds is new
  // UI, none of it covered by a pre-existing sweep.
  it("is axe-clean on every one of its nine states, in both themes", async () => {
    const states = [
      { kind: "open" as const, terms: TERMS, signedIn: true },
      { kind: "open" as const, terms: TERMS, signedIn: false },
      { kind: "invalid" as const },
      { kind: "expired" as const },
      { kind: "exhausted" as const },
      { kind: "already-member" as const, leagueId: "lg_1", name: "Bay Bandits" },
      { kind: "league-full" as const, name: "Bay Bandits" },
      { kind: "draft-started" as const, name: "Bay Bandits" },
      { kind: "tier-refused" as const },
    ];
    for (const { signedIn, ...state } of states) {
      await renderSurface(<InviteLanding state={state} signedIn={signedIn ?? true} code="SUNDAY12" />, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    }
  });
});
