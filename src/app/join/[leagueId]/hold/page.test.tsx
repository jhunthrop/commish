import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fixtureLeagueDeps } from "@/league-room/test-fixtures";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/league-service/browse", () => ({ publicLeaguePreview: vi.fn() }));
// A1's own regression backstop, pinned at the module boundary rather than merely by absence of
// an assertion: if anything in this render path ever imports `returnFromSignIn` again, this
// mock — never given an implementation — throws the instant it is called, failing every test in
// this file loudly rather than one silently starting to write again.
vi.mock("@/league-service/join", () => ({ returnFromSignIn: vi.fn() }));
// A-3's own read: the page asks whether this visitor already holds a team before offering them a
// seat. A pure SELECT, mocked here the same way every other read on this page is.
vi.mock("@/lib/leagues/membership", () => ({ resolveLeagueMembership: vi.fn() }));
vi.mock("@/components/app-shell/shell-data", () => ({ shellData: vi.fn() }));
// `AppShell` itself (its `TopBar`, live notices and live scores) is tested on its own — this
// file is about the seat-hold page's own wiring, not `AppShell`'s internals, so it is stubbed to
// its children the same way a unit test stubs any collaborator it does not own.
vi.mock("@/components/app-shell/app-shell", () => ({
  AppShell: ({ children }: { readonly children: ReactNode }) => children,
}));

class NotFound extends Error {}

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new NotFound();
  }),
  usePathname: () => "/join/lg1/hold",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { publicLeaguePreview } from "@/league-service/browse";
import { returnFromSignIn } from "@/league-service/join";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import { shellData } from "@/components/app-shell/shell-data";
import SeatHoldPage from "./page";

/** A signed-in visitor who holds NO team here — the only state that is offered a seat. */
const NOT_A_MEMBER = {
  ok: true as const,
  membership: { leagueId: "lg_1", teamId: null, isCommissioner: false, authority: { kind: "house" as const, rung: "open_12" as const } },
};

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

const PREVIEW = {
  id: "lg1", name: "Rookie Snake Room", teamCount: 12, filledTeams: 9, heldSeats: 1,
  draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)", startTrigger: "scheduled" as const, houseRung: null,
};

async function renderPage(deps: Parameters<typeof LeagueRoomDepsProvider>[0]["deps"]) {
  const page = await SeatHoldPage({ params: Promise.resolve({ leagueId: "lg1" }) });
  return render(<LeagueRoomDepsProvider deps={deps}>{page}</LeagueRoomDepsProvider>);
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(publicLeaguePreview).mockReset();
  vi.mocked(returnFromSignIn).mockReset();
  vi.mocked(shellData).mockReset().mockResolvedValue({ rail: [], liveState: null });
});

describe("/join/[leagueId]/hold — signed out (the interstitial)", () => {
  it("shows the league's own facts and holds a seat through SeatHoldPanel", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(publicLeaguePreview).mockResolvedValue(PREVIEW);
    const fixture = fixtureLeagueDeps({ ok: true, data: { expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() } });

    await renderPage(fixture.deps);

    expect(await screen.findByRole("heading", { name: "Rookie Snake Room" })).toBeInTheDocument();
    expect(screen.getByText(/9 of 12 seated/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to finish joining Rookie Snake Room" })).toHaveAttribute(
      "href",
      "/sign-in?returnTo=%2Fjoin%2Flg1%2Fhold",
    );
    expect(vi.mocked(returnFromSignIn)).not.toHaveBeenCalled();
  });

  it("answers not found for a private or missing league, never distinguishing the two", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(publicLeaguePreview).mockResolvedValue(null);

    await expect(SeatHoldPage({ params: Promise.resolve({ leagueId: "lg1" }) })).rejects.toBeInstanceOf(NotFound);
    expect(vi.mocked(notFound)).toHaveBeenCalled();
  });
});

describe("/join/[leagueId]/hold — signed in (A1: a read, never a write)", () => {
  it("renders the league's own facts and a one-tap confirm, and calls returnFromSignIn NOT ONCE", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(publicLeaguePreview).mockResolvedValue(PREVIEW);
    vi.mocked(resolveLeagueMembership).mockResolvedValue(NOT_A_MEMBER);

    await renderPage(fixtureLeagueDeps().deps);

    // `level: 1` disambiguates from `SeatConfirmPanel`'s own `Panel` title, which renders the
    // SAME league name as an h2 right beside the page's h1.
    expect(await screen.findByRole("heading", { level: 1, name: "Rookie Snake Room" })).toBeInTheDocument();
    expect(screen.getByText(/9 of 12 seated/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take your seat in Rookie Snake Room" })).toBeInTheDocument();
    // A1's own pin: rendering this page as a signed-in visitor must NEVER reach the writer —
    // the exact bug (`returnFromSignIn` called during render) this fix closes.
    expect(vi.mocked(returnFromSignIn)).not.toHaveBeenCalled();
  });

  it("answers not found for a private or missing league even when signed in — the same collapse the signed-out branch already commits to", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(publicLeaguePreview).mockResolvedValue(null);

    await expect(SeatHoldPage({ params: Promise.resolve({ leagueId: "lg1" }) })).rejects.toBeInstanceOf(NotFound);
    expect(vi.mocked(returnFromSignIn)).not.toHaveBeenCalled();
  });

  it("sends a member who already holds a team straight to their league, and offers no seat (A-3)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(publicLeaguePreview).mockResolvedValue(PREVIEW);
    vi.mocked(resolveLeagueMembership).mockResolvedValue({
      ...NOT_A_MEMBER,
      membership: { ...NOT_A_MEMBER.membership, teamId: "team_already" },
    });

    await expect(renderPage(fixtureLeagueDeps().deps)).rejects.toThrow(/NEXT_REDIRECT|redirect/i);
    // The read decides it — the writer is still never reached on a render.
    expect(vi.mocked(returnFromSignIn)).not.toHaveBeenCalled();
  });
});
