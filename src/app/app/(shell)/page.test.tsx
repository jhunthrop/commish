import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { fixtureLeagueDeps, homeCard, PUBLIC_LEAGUES } from "@/league-room/test-fixtures";

// Route-level: every read `AppHome` makes is mocked, same discipline `admin/queue/page.test.tsx`
// uses for its own Server Component page. The lobby's join button navigates via
// `next/navigation`'s `useRouter` — stubbed the same way `create-league-panel.test.tsx` does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@research/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/league-service", () => ({ crossLeagueHome: vi.fn() }));
vi.mock("@/league-service/browse", () => ({ listPublicLeagues: vi.fn() }));
vi.mock("@/league-service/score-cache-instance", () => ({ getScoreCache: () => ({}) }));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { crossLeagueHome } from "@/league-service";
import { listPublicLeagues } from "@/league-service/browse";
import AppHome from "./page";

const USER = {
  id: "u_ada",
  email: "ada@test.local",
  displayName: "Ada Lovelace",
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  isAdmin: false,
};

const NO_LEAGUES = { leagues: [], liveState: null };
const ONE_LEAGUE = {
  leagues: [homeCard({ name: "Bay Bandits", myTeamName: "Bay Bandits Team", lineupSet: false, weekNumber: 4 })],
  liveState: null,
};

function renderPage(page: Awaited<ReturnType<typeof AppHome>>) {
  const accountFixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  const leagueFixture = fixtureLeagueDeps({ ok: true, data: {} });
  return render(
    <AccountRoomDepsProvider deps={accountFixture.deps}>
      <LeagueRoomDepsProvider deps={leagueFixture.deps}>{page}</LeagueRoomDepsProvider>
    </AccountRoomDepsProvider>,
  );
}

beforeEach(() => {
  vi.mocked(requireCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(crossLeagueHome).mockReset().mockResolvedValue(NO_LEAGUES);
  vi.mocked(listPublicLeagues).mockReset().mockResolvedValue({ leagues: [], house: PUBLIC_LEAGUES });
});

describe("AppHome — the seat-hold arrival guard (Task 17, Step 3)", () => {
  // A visitor holding a seat never reaches this page at all: Task 16's `safeReturnTo` seals
  // `/join/[leagueId]/hold` into the sign-in state, which beats the callback's `/app` fallback
  // before this component is ever invoked. The guarantee that makes that true is that THIS page
  // has no way to read a query string or a cookie in the first place — pinned here as an arity
  // check, so a future change that adds `searchParams` (the mechanism a "route around the hold
  // page toward /app" regression would need) fails this test immediately, rather than silently
  // becoming the bug Task 16 would own.
  it("takes no arguments — nothing here could special-case a visitor arriving with an intent", () => {
    expect(AppHome.length).toBe(0);
  });
});

describe("AppHome renders the leagues and the lobby", () => {
  it("makes the lobby the page for a manager with no leagues", async () => {
    const page = await AppHome();
    await renderSurface(page, async ({ container }) => {
      expect(screen.getByRole("heading", { level: 1, name: "Your leagues" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Open rooms" })).toBeInTheDocument();
      expect(container.querySelectorAll("[data-testid='home-league-card']")).toHaveLength(0);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("renders one card per league, with the lobby beneath it", async () => {
    vi.mocked(crossLeagueHome).mockResolvedValue(ONE_LEAGUE);
    const page = await AppHome();
    const { container } = renderPage(page);
    expect(container.querySelectorAll("[data-testid='home-league-card']")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Bay Bandits" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Open rooms" })).toBeInTheDocument();
  });

  // The first-run fork this page used to carry is deleted with the two panels it chose between:
  // no preferences read, no profile read, no second shape of this page.
  it("reads exactly two things: the cross-league home and the open rooms", async () => {
    await AppHome();
    expect(vi.mocked(crossLeagueHome)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listPublicLeagues)).toHaveBeenCalledTimes(1);
  });
});

/**
 * FIX ROUNDS 1 AND 3. The door used to live only inside `OpenRooms`, which renders nothing when
 * the lobby is empty, so a manager with no leagues AND no open rooms had no route anywhere in the
 * product to create one (round 1). Round 1's fix then put a second door beside the page heading
 * and the page showed "Create a league" twice (round 3). The ruling is one door per page, and
 * `HomeBoard` decides which: the lobby's heading owns it whenever the lobby renders, the page's
 * heading when it does not. Either way the literal `#create-league` anchor rides the one that
 * renders, which is what keeps `link-integrity.source.test.ts` green.
 */
describe("AppHome offers exactly one create door", () => {
  it("renders one, beside the heading, in the state where the lobby renders nothing at all", async () => {
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: [], house: [] });
    const { container } = renderPage(await AppHome());
    expect(container.querySelector("[data-testid='open-rooms']")).toBeNull();
    expect(container.querySelectorAll("#create-league")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Create a league" })).toBeInTheDocument();
  });

  it("renders one, inside the lobby, when the lobby has rooms to show", async () => {
    const { container } = renderPage(await AppHome());
    expect(container.querySelectorAll("#create-league")).toHaveLength(1);
    expect(screen.getByTestId("open-rooms").querySelector("#create-league")).not.toBeNull();
  });

  it("carries the anchor on a real control, whichever door renders", async () => {
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: [], house: [] });
    expect(renderPage(await AppHome()).container.querySelector("#create-league")).toBeInstanceOf(HTMLButtonElement);
  });

  it("is quiet, so it never competes with the page's one solid verb", async () => {
    vi.mocked(crossLeagueHome).mockResolvedValue(ONE_LEAGUE);
    const { container } = renderPage(await AppHome());
    expect(container.querySelector("#create-league")?.className).not.toContain("shadow-verb-glow");
  });
});
