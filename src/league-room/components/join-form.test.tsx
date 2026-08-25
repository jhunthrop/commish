import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { LeagueTerms } from "@/league";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { JoinForm } from "./join-form";

// `JoinForm` navigates via `next/navigation`'s `useRouter` after a successful NEW join, which
// throws outside a mounted App Router. Stubbing the hook — not the component — keeps this a
// real render of `JoinForm`'s own markup and logic.
// `push` is a shared spy rather than a fresh throwaway, so a test can assert WHERE a successful
// join actually sends somebody.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
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
  entryFeeCents: 0,
  commissionerName: "Alex Rivera",
  commissionerAvatar: null,
  draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)",
  formatNotes: [],
};

// Phase 4, Task 13: the live branch, proven through injection — no invite can carry a paid
// league's terms while `moneyIsLive()` stays false, so this fixture is the only way to exercise
// `JoinForm`'s state-attestation step ahead of that day.
const PAID_TERMS: LeagueTerms = {
  ...TERMS,
  stakeDisclosure: MATCHMAKING_CONFIG.liveStakeDisclosure,
  entryFeeCents: 5_000,
  entryFeeUsd: "$50.00",
  platformFeeUsd: "$5.00",
  prizeTable: [{ place: 1, amountUsd: "$45.00" }],
};

/** Every test passes all four terminal callbacks — most only care that theirs fires, or that
 *  none of them does. Reset between tests so a leftover call from one test can never explain a
 *  later assertion. */
const NOOP = {
  onAlreadyMember: vi.fn(),
  onLeagueFull: vi.fn(),
  onDraftStarted: vi.fn(),
  onTierRefused: vi.fn(),
};

beforeEach(() => {
  push.mockReset();
  for (const fn of Object.values(NOOP)) fn.mockReset();
});

describe("JoinForm", () => {
  // Task 20: the terms themselves are `InviteLanding`'s job now (`LeagueTermsPanel`, rendered
  // once regardless of session) — this component's whole surface is the button and the action
  // that follows pressing it.
  it("offers the one real action, named after the league, axe-clean in both themes", async () => {
    await renderSurface(<JoinForm code="SUNDAY12" terms={TERMS} {...NOOP} />, async ({ container, getByRole }) => {
      expect(getByRole("button", { name: "Join Sunday Money" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("accepts the invite and sends the new member into the league they just joined", async () => {
    const fixture = fixtureLeagueDeps(undefined, { deferred: true });
    renderInLeague(<JoinForm code="SUNDAY12" terms={TERMS} {...NOOP} />, fixture.deps);

    const button = screen.getByRole("button", { name: "Join Sunday Money" });
    fireEvent.click(button);
    await waitFor(() => expect(fixture.pending()).toBe(1));
    await fixture.settle(0, { ok: true, data: { leagueId: "l1", teamId: "t2", alreadyMember: false } });

    await waitFor(() => expect(fixture.calls).toEqual(["POST /api/invites/SUNDAY12/accept"]));
    // The half this test's name always claimed and never checked: a wrong destination used to
    // ship green, because nothing ever observed `router.push`.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/leagues/l1"));
  });

  it("reports already-member upward instead of navigating there itself", async () => {
    const onAlreadyMember = vi.fn();
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", teamId: "t2", alreadyMember: true } });
    renderInLeague(<JoinForm code="SUNDAY12" terms={TERMS} {...NOOP} onAlreadyMember={onAlreadyMember} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Join Sunday Money" }));
    await waitFor(() => expect(onAlreadyMember).toHaveBeenCalledWith("l1"));
    expect(push).not.toHaveBeenCalled();
  });

  it("reports league-full upward instead of showing an inline alert for that one refusal", async () => {
    const onLeagueFull = vi.fn();
    const fixture = fixtureLeagueDeps({ ok: false, error: "That league is already full." });
    renderInLeague(<JoinForm code="SUNDAY12" terms={TERMS} {...NOOP} onLeagueFull={onLeagueFull} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Join Sunday Money" }));
    await waitFor(() => expect(onLeagueFull).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports draft-started upward instead of showing an inline alert for that one refusal", async () => {
    const onDraftStarted = vi.fn();
    const fixture = fixtureLeagueDeps({ ok: false, error: "That league's draft has already started. Try another open league." });
    renderInLeague(<JoinForm code="SUNDAY12" terms={TERMS} {...NOOP} onDraftStarted={onDraftStarted} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Join Sunday Money" }));
    await waitFor(() => expect(onDraftStarted).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports tier-refused upward instead of showing an inline alert for that one refusal", async () => {
    const onTierRefused = vi.fn();
    const fixture = fixtureLeagueDeps({
      ok: false,
      error: "This league is reserved for newer players so everyone starts on a level footing. Browse the open leagues to find one you can join.",
    });
    renderInLeague(<JoinForm code="SUNDAY12" terms={TERMS} {...NOOP} onTierRefused={onTierRefused} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Join Sunday Money" }));
    await waitFor(() => expect(onTierRefused).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an actionable reason for a dead link at accept time, unmatched by any of the four terminal outcomes", async () => {
    const fixture = fixtureLeagueDeps(undefined, { deferred: true });
    renderInLeague(<JoinForm code="SUNDAY12" terms={TERMS} {...NOOP} />, fixture.deps);

    const button = screen.getByRole("button", { name: "Join Sunday Money" });
    fireEvent.click(button);
    await waitFor(() => expect(fixture.pending()).toBe(1));
    await fixture.settle(0, { ok: false, error: "That invite link has expired. Ask your commissioner for a new one." });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ask your commissioner for a new one."));
    expect(NOOP.onAlreadyMember).not.toHaveBeenCalled();
    expect(NOOP.onLeagueFull).not.toHaveBeenCalled();
    expect(NOOP.onDraftStarted).not.toHaveBeenCalled();
    expect(NOOP.onTierRefused).not.toHaveBeenCalled();
  });

  it("shows a network failure inline without crashing", async () => {
    const deps = {
      fetchJson: async () => {
        throw new Error("network down");
      },
      openEventSource: fixtureLeagueDeps().deps.openEventSource,
    };
    renderInLeague(<JoinForm code="SUNDAY12" terms={TERMS} {...NOOP} />, deps);
    fireEvent.click(screen.getByRole("button", { name: "Join Sunday Money" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("We could not reach the server."));
  });

  // Phase 4, Task 13: the paid join's own confirmation and state-attestation gate — proven
  // through injection (`PAID_TERMS`), since no invite this platform mints can carry a paid
  // league's terms while `moneyIsLive()` stays false.
  describe("a paid league's join", () => {
    it("renders no confirmation, and never gates the button, for a free join", () => {
      renderInLeague(<JoinForm code="SUNDAY12" terms={TERMS} {...NOOP} />, fixtureLeagueDeps().deps);
      expect(screen.queryByLabelText("State of entry")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Join Sunday Money" })).not.toBeDisabled();
    });

    it("states the fee, the balance after and the refund rule, and gates Join on a chosen state", () => {
      renderInLeague(
        <JoinForm code="SUNDAY12" terms={PAID_TERMS} balanceAfterUsd="$70.00" {...NOOP} />,
        fixtureLeagueDeps().deps,
      );
      expect(screen.getByText("This league charges $50.00 to join.")).toBeInTheDocument();
      expect(screen.getByText("$70.00")).toBeInTheDocument();
      expect(
        screen.getByText("Refunded in full if you leave before the draft or the league dissolves before it starts."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Join Sunday Money" })).toBeDisabled();
    });

    it("un-gates Join once a state is chosen, and sends it on the accept request", async () => {
      const calls: { readonly url: string; readonly body: unknown }[] = [];
      const deps = {
        fetchJson: async (url: string, init?: RequestInit) => {
          calls.push({ url, body: init?.body === undefined ? undefined : JSON.parse(init.body as string) });
          return { json: async () => ({ ok: true, data: { leagueId: "l1", teamId: "t2", alreadyMember: false } }) } as unknown as Response;
        },
        openEventSource: fixtureLeagueDeps().deps.openEventSource,
      };
      renderInLeague(<JoinForm code="SUNDAY12" terms={PAID_TERMS} balanceAfterUsd="$70.00" {...NOOP} />, deps);

      const button = screen.getByRole("button", { name: "Join Sunday Money" });
      expect(button).toBeDisabled();

      fireEvent.change(screen.getByLabelText("State of entry"), { target: { value: "TX" } });
      expect(button).not.toBeDisabled();

      fireEvent.click(button);
      await waitFor(() => expect(calls).toEqual([{ url: "/api/invites/SUNDAY12/accept", body: { stateOfEntry: "TX" } }]));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/app/leagues/l1"));
    });
  });
});
