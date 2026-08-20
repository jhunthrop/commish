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

import { getCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
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
};

async function renderPage(deps: Parameters<typeof LeagueRoomDepsProvider>[0]["deps"]) {
  const page = await JoinPage({ params: Promise.resolve({ code: "SUNDAY12" }) });
  return render(<LeagueRoomDepsProvider deps={deps}>{page}</LeagueRoomDepsProvider>);
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(readPreferences).mockReset();
});

/**
 * H2: `GET /api/invites/[code]` is unauthenticated on a documented ruling whose premise is that
 * a prospect sees the terms "before holding an account". That premise was false in the shipped
 * product — the route's only consumer rendered exclusively from a `requireCurrentUser()` page
 * behind `middleware.ts`'s /app redirect. These are the assertions that make it true.
 */
describe("/app/join/[code] — signed out", () => {
  it("renders the league terms and a sign-in call to action, with no join button", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    await renderPage(fixture.deps);

    expect(await screen.findByRole("heading", { name: "Sunday Money" })).toBeInTheDocument();
    expect(screen.getByText(TERMS.rosterLine)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to join Sunday Money" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("button", { name: /^Join/ })).not.toBeInTheDocument();
  });

  it("seeds no preferences row for a visitor who has no account", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    await renderPage(fixture.deps);
    expect(vi.mocked(readPreferences)).not.toHaveBeenCalled();
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
    const fixture = fixtureLeagueDeps({ ok: true, data: TERMS });
    await renderPage(fixture.deps);

    expect(await screen.findByRole("button", { name: "Join Sunday Money" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Sign in to join/ })).not.toBeInTheDocument();
    expect(vi.mocked(readPreferences)).toHaveBeenCalledWith({}, expect.objectContaining({ id: "u1" }));
  });
});
