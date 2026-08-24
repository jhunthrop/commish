import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps, PROFILE } from "@/account-room/test-fixtures";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { fixtureLeagueDeps } from "@/league-room/test-fixtures";

// Route-level: every read `AppHome` makes is mocked, same discipline `admin/queue/page.test.tsx`
// uses for its own Server Component page. `HomeBoard` embeds `CreateLeaguePanel`/
// `JoinLeagueEntry`, both of which navigate via `next/navigation`'s `useRouter` when the manager
// is first-run — stubbed the same way `first-run-panel.test.tsx` does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/identity-service/preferences", () => ({ readPreferences: vi.fn() }));
vi.mock("@/identity-service/profile", () => ({ readProfile: vi.fn() }));
vi.mock("@/league-service", () => ({ crossLeagueHome: vi.fn() }));
vi.mock("@/league-service/browse", () => ({ listPublicLeagues: vi.fn() }));
vi.mock("@/league-service/score-cache-instance", () => ({ getScoreCache: () => ({}) }));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { readProfile } from "@/identity-service/profile";
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
  leagues: [
    {
      id: "l1",
      name: "Bay Bandits",
      format: "snake" as const,
      teamCount: 10,
      filledTeams: 10,
      isCommissioner: false,
      myTeamId: "t1",
      draftId: "d1",
      draftStatus: "complete" as const,
      record: { wins: 5, losses: 2, ties: 0 },
      weekNumber: 4,
      weekStatus: "scheduled" as const,
      matchup: null,
      nextAction: { kind: "set-lineup" as const, label: "Set your lineup" },
      lineupSet: true,
      medianGame: false,
      medianScore: null,
      kickoffAt: null,
      startTrigger: null,
      kickoffRolls: 0,
      myTeamName: "Bay Bandits Team",
    },
  ],
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
  vi.mocked(readPreferences).mockReset().mockResolvedValue({ helpLevel: "guided", draftTourDismissedAt: null });
  vi.mocked(readProfile).mockReset().mockResolvedValue(PROFILE);
  vi.mocked(crossLeagueHome).mockReset().mockResolvedValue(NO_LEAGUES);
  vi.mocked(listPublicLeagues).mockReset().mockResolvedValue({ leagues: [], house: [] });
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

describe("AppHome — first-run wiring (Task 17, Step 2)", () => {
  it("reads the caller's profile and renders the identity card first, when the caller has zero leagues", async () => {
    const page = await AppHome();
    await renderSurface(
      <AccountRoomDepsProvider deps={fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } }).deps}>
        <LeagueRoomDepsProvider deps={fixtureLeagueDeps({ ok: true, data: {} }).deps}>{page}</LeagueRoomDepsProvider>
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
        expect(headings[0]).toBe("Set up your manager profile");
        expect(screen.getByLabelText("Display name")).toHaveValue(PROFILE.displayName);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    expect(vi.mocked(readProfile)).toHaveBeenCalledWith(expect.anything(), USER.id);
  });

  it("never reads the profile for a manager who already has a league — no new cost for the common case", async () => {
    vi.mocked(crossLeagueHome).mockResolvedValue(ONE_LEAGUE);
    const page = await AppHome();
    renderPage(page);
    expect(vi.mocked(readProfile)).not.toHaveBeenCalled();
  });
});
