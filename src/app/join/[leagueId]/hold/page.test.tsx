import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fixtureLeagueDeps } from "@/league-room/test-fixtures";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/league-service/browse", () => ({ publicLeaguePreview: vi.fn() }));
vi.mock("@/league-service/join", () => ({ returnFromSignIn: vi.fn() }));
vi.mock("@/components/app-shell/shell-data", () => ({ shellData: vi.fn() }));
// `AppShell` itself (its `TopBar`, live notices and live scores) is tested on its own — this
// file is about the seat-hold page's own wiring, not `AppShell`'s internals, so it is stubbed to
// its children the same way a unit test stubs any collaborator it does not own.
vi.mock("@/components/app-shell/app-shell", () => ({
  AppShell: ({ children }: { readonly children: ReactNode }) => children,
}));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
class NotFound extends Error {}

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Redirected(to);
  }),
  notFound: vi.fn(() => {
    throw new NotFound();
  }),
  usePathname: () => "/join/lg1/hold",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { publicLeaguePreview } from "@/league-service/browse";
import { returnFromSignIn } from "@/league-service/join";
import { shellData } from "@/components/app-shell/shell-data";
import SeatHoldPage from "./page";

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
  vi.mocked(cookies).mockReset().mockResolvedValue({ get: () => undefined } as never);
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
  });

  it("answers not found for a private or missing league, never distinguishing the two", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(publicLeaguePreview).mockResolvedValue(null);

    await expect(SeatHoldPage({ params: Promise.resolve({ leagueId: "lg1" }) })).rejects.toBeInstanceOf(NotFound);
  });
});

describe("/join/[leagueId]/hold — signed in (the return, Task 6 Step 4, F4)", () => {
  it("redirects straight to the waiting room once seated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(returnFromSignIn).mockResolvedValue({ ok: true, seated: true, justSeated: true, expiredHold: false, leagueId: "lg1", teamId: "t1" });

    const redirected = await SeatHoldPage({ params: Promise.resolve({ leagueId: "lg1" }) }).catch((e: unknown) => e);
    expect(redirected).toBeInstanceOf(Redirected);
    expect((redirected as Redirected).to).toBe("/app/leagues/lg1");
  });

  it("redirects to the waiting room with holdExpired=1 when the hold had expired but a seat was still open", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(returnFromSignIn).mockResolvedValue({ ok: true, seated: true, justSeated: false, expiredHold: true, leagueId: "lg1", teamId: "t1" });

    const redirected = await SeatHoldPage({ params: Promise.resolve({ leagueId: "lg1" }) }).catch((e: unknown) => e);
    expect(redirected).toBeInstanceOf(Redirected);
    expect((redirected as Redirected).to).toBe("/app/leagues/lg1?holdExpired=1");
  });

  it("shows SeatTakenPanel, never a dead end, for the race loser", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(returnFromSignIn).mockResolvedValue({ ok: false, reason: SEAT_HOLD_REFUSALS.taken });
    vi.mocked(publicLeaguePreview).mockResolvedValue(PREVIEW);

    await renderPage(fixtureLeagueDeps().deps);
    expect(await screen.findByText(SEAT_HOLD_REFUSALS.taken)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /browse|closest to filling/i }).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the tier refusal distinct from the generic taken panel", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(returnFromSignIn).mockResolvedValue({ ok: false, reason: ENFORCEMENT_REFUSALS.join });

    await renderPage(fixtureLeagueDeps().deps);
    expect(await screen.findByText(ENFORCEMENT_REFUSALS.join)).toBeInTheDocument();
    expect(screen.queryByText(SEAT_HOLD_REFUSALS.taken)).not.toBeInTheDocument();
  });

  it("passes the hold cookie's token through to returnFromSignIn", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(USER);
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ name: "seat_hold", value: "hold_abc" }) } as never);
    vi.mocked(returnFromSignIn).mockResolvedValue({ ok: true, seated: true, justSeated: true, expiredHold: false, leagueId: "lg1", teamId: "t1" });

    await SeatHoldPage({ params: Promise.resolve({ leagueId: "lg1" }) }).catch(() => {});
    expect(vi.mocked(returnFromSignIn)).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ leagueId: "lg1", userId: "u1", holdToken: "hold_abc" }),
    );
  });
});
