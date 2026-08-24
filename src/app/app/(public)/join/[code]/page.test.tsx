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

import { getCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { invitePreview } from "@/league-service/invites";
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
  commissionerName: "Alex Rivera",
  commissionerAvatar: null,
  draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)",
  formatNotes: [],
};

async function renderPage(deps: Parameters<typeof LeagueRoomDepsProvider>[0]["deps"]) {
  const page = await JoinPage({ params: Promise.resolve({ code: "SUNDAY12" }) });
  return render(<LeagueRoomDepsProvider deps={deps}>{page}</LeagueRoomDepsProvider>);
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(readPreferences).mockReset();
  vi.mocked(invitePreview).mockReset();
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
  it("still renders the join button and reads the caller's own help level", async () => {
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
    expect(vi.mocked(readPreferences)).toHaveBeenCalledWith({}, expect.objectContaining({ id: "u1" }));
  });
});
