import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { LeagueTerms } from "@/league";
import { fixtureLeagueDeps } from "@/league-room/test-fixtures";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/identity-service/preferences", () => ({ readPreferences: vi.fn() }));
vi.mock("@/league-service/invites", () => ({ invitePreview: vi.fn() }));
vi.mock("@/money-service/read", () => ({ walletSummary: vi.fn() }));

import { getCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { invitePreview } from "@/league-service/invites";
import { walletSummary } from "@/money-service/read";
import JoinPage from "./page";

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

// Phase 4, Task 13: the live branch, proven through injection — no invite this platform mints
// can carry a paid league's terms while `moneyIsLive()` stays false.
const PAID_TERMS: LeagueTerms = {
  ...TERMS,
  stakeDisclosure: MATCHMAKING_CONFIG.liveStakeDisclosure,
  entryFeeCents: 5_000,
  entryFeeUsd: "$50.00",
  platformFeeUsd: "$5.00",
  prizeTable: [{ place: 1, amountUsd: "$45.00" }],
};

const CURRENT_USER = {
  id: "u1",
  email: "u1@test.local",
  displayName: "Ada",
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  isAdmin: false,
};

async function renderPage(deps: Parameters<typeof LeagueRoomDepsProvider>[0]["deps"]) {
  const page = await JoinPage({ params: Promise.resolve({ code: "SUNDAY12" }) });
  return render(<LeagueRoomDepsProvider deps={deps}>{page}</LeagueRoomDepsProvider>);
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(readPreferences).mockReset();
  vi.mocked(invitePreview).mockReset();
  vi.mocked(walletSummary).mockReset();
});

/**
 * H2: `GET /api/invites/[code]` is unauthenticated on a documented ruling whose premise is that
 * a prospect sees the terms "before holding an account". That premise was false in the shipped
 * product — the route's only consumer rendered exclusively from a `requireCurrentUser()` page
 * behind `middleware.ts`'s /app redirect. These are the assertions that make it true.
 *
 * Phase 3.6, Task 20: `invitePreview` is now called server-side, by this page, once — so these
 * assertions read straight off the rendered `InviteLanding`, with no client fetch to await first.
 */
describe("/app/join/[code] — signed out", () => {
  it("renders the league terms and a sign-in call to action, with no join button", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(invitePreview).mockResolvedValue({ ok: true, terms: TERMS });
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    await renderPage(fixture.deps);

    expect(screen.getByRole("heading", { name: "Sunday Money" })).toBeInTheDocument();
    expect(screen.getByText(TERMS.rosterLine)).toBeInTheDocument();
    // Two "Sign in" links render on this page signed out — `PublicBar`'s own header one (Task
    // 16) and `InviteLanding`'s contextual one, right where the "Join" button would be — both
    // must carry this exact invite's own intent.
    const signInLinks = screen.getAllByRole("link", { name: "Sign in" });
    expect(signInLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of signInLinks) expect(link).toHaveAttribute("href", "/sign-in?returnTo=%2Fapp%2Fjoin%2FSUNDAY12");
    expect(screen.queryByRole("button", { name: /^Join/ })).not.toBeInTheDocument();
  });

  it("seeds no preferences row for a visitor who has no account", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(invitePreview).mockResolvedValue({ ok: true, terms: TERMS });
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    await renderPage(fixture.deps);
    expect(vi.mocked(readPreferences)).not.toHaveBeenCalled();
  });

  it("offers a real action for a dead code, never a dead end, before anybody signs in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(invitePreview).mockResolvedValue({
      ok: false,
      reason: "That invite link has expired. Ask your commissioner for a new one.",
    });
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    await renderPage(fixture.deps);
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sunday Money" })).not.toBeInTheDocument();
  });
});

describe("/app/join/[code] — signed in", () => {
  it("still renders the join button, and never reads preferences (the retired helpLevel read stays retired)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "u1",
      email: "u1@test.local",
      displayName: "Ada",
      experienceTier: "beginner",
      avatarUrl: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      isAdmin: false,
    });
    vi.mocked(readPreferences).mockResolvedValue({ helpLevel: "standard", draftTourDismissedAt: null });
    vi.mocked(invitePreview).mockResolvedValue({ ok: true, terms: TERMS });
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    await renderPage(fixture.deps);

    expect(screen.getByRole("button", { name: "Join Sunday Money" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    // Sunday v5, the no-tips ruling: the `readPreferences` read is GONE from this page.
    expect(vi.mocked(readPreferences)).not.toHaveBeenCalled();
  });

  // Phase 4, Task 13: the free-season reality check — this is every signed-in join that exists
  // today, and it must never read the wallet at all.
  it("never reads the wallet for a free join — every join this season", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(CURRENT_USER);
    vi.mocked(readPreferences).mockResolvedValue({ helpLevel: "standard", draftTourDismissedAt: null });
    vi.mocked(invitePreview).mockResolvedValue({ ok: true, terms: TERMS });
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    await renderPage(fixture.deps);

    expect(vi.mocked(walletSummary)).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("State of entry")).not.toBeInTheDocument();
  });

  // Phase 4, Task 13: the live branch, proven through injection — no invite this platform mints
  // can carry `PAID_TERMS` while `moneyIsLive()` stays false.
  it("reads the wallet server-side for a paid join, and states the balance after the fee", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(CURRENT_USER);
    vi.mocked(readPreferences).mockResolvedValue({ helpLevel: "standard", draftTourDismissedAt: null });
    vi.mocked(invitePreview).mockResolvedValue({ ok: true, terms: PAID_TERMS });
    vi.mocked(walletSummary).mockResolvedValue({ availableCents: 12_000, escrowCents: 0, heldCents: 0, owedCents: 0 });
    const fixture = fixtureLeagueDeps({ ok: true, data: PAID_TERMS });
    await renderPage(fixture.deps);

    expect(vi.mocked(walletSummary)).toHaveBeenCalledWith({}, "u1");
    expect(screen.getByText("This league charges $50.00 to join.")).toBeInTheDocument();
    expect(screen.getByText("$70.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join Sunday Money" })).toBeDisabled();
  });
});
