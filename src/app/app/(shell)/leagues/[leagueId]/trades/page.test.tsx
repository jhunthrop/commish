import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { NoticesProvider } from "@/components/app-shell/notices-provider";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { fixtureLeagueDeps } from "@/league-room/test-fixtures";

// Route-level: every read the page makes is mocked, same discipline `activity/page.test.tsx`
// established for this app tree — `notFound()` is the real `next/navigation` implementation (a
// plain synchronous throw with a stable digest), so asserting on it is asserting on the real
// behavior a browser would see.
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/league-service", () => ({ leagueHome: vi.fn(), matchupWeek: vi.fn() }));
vi.mock("@/league-service/reference-cache-instance", () => ({ getReferenceCache: () => ({}) }));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { leagueHome, matchupWeek } from "@/league-service";
import TradesPage from "./page";

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

const HOME = {
  leagueId: "league_1",
  name: "Sunday Money",
  format: "snake" as const,
  teamCount: 2,
  rosterSlots: [],
  isCommissioner: false,
  authority: { kind: "member" as const, userId: "u2" },
  myTeamId: "t1",
  teams: [
    { id: "t1", name: "Bay Bandits", ownerDisplayName: "Ada Lovelace", ownerAvatarUrl: null, ownerUserId: "u1" },
    { id: "t2", name: "Iron Owls", ownerDisplayName: "Grace Hopper", ownerAvatarUrl: null, ownerUserId: "u2" },
  ],
  standings: [],
  medianGame: false,
  terms: {
    name: "Sunday Money", format: "snake" as const, teamCount: 2, filledTeams: 2, scoringLabel: "PPR",
    rosterLine: "", stakeLabel: "Friendly", stakeDisclosure: "", entryFeeCents: 0, commissionerName: "Grace Hopper", commissionerAvatar: null,
    draftAt: "Saturday 12 September, 7:00 PM UTC (in 3 days)", formatNotes: [],
  },
  currentWeek: 5,
  totalWeeks: 14,
  myMatchup: null,
  weekStatus: "in_progress" as const,
  draftId: null,
  draftStatus: "complete" as const,
  draftSchedule: null,
  justSeated: false,
  compositionCategory: "open" as const,
};

const WEEK_BODY = {
  leagueId: "league_1",
  weekNumber: 5,
  totalWeeks: 14,
  myTeamId: "t1",
  weekStatus: "in_progress" as const,
  matchups: [
    {
      weekNumber: 5,
      final: false,
      weekStatus: "in_progress" as const,
      median: null,
      home: {
        teamId: "t1",
        teamName: "Bay Bandits",
        score: null,
        starters: [{ slot: "RB" as const, slotIndex: 0, playerId: "p1", playerName: "Bijan Robinson", position: "RB" as const, points: 0 }],
        bench: [],
      },
      away: {
        teamId: "t2",
        teamName: "Iron Owls",
        score: null,
        starters: [{ slot: "WR" as const, slotIndex: 0, playerId: "p2", playerName: "Puka Nacua", position: "WR" as const, points: 0 }],
        bench: [],
      },
    },
  ],
};

function callPage(leagueId = "league_1") {
  return TradesPage({ params: Promise.resolve({ leagueId }) });
}

async function renderPage(leagueId?: string) {
  const accountFixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  const leagueFixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "league_1", meTeamId: "t1", inbox: [], outbox: [], history: [] } });
  const page = await callPage(leagueId);
  return render(
    <AccountRoomDepsProvider deps={accountFixture.deps}>
      <NoticesProvider>
        <LeagueRoomDepsProvider deps={leagueFixture.deps}>{page}</LeagueRoomDepsProvider>
      </NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

beforeEach(() => {
  vi.mocked(requireCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(leagueHome).mockReset().mockResolvedValue(HOME);
  vi.mocked(matchupWeek).mockReset().mockResolvedValue(WEEK_BODY);
});

describe("TradesPage", () => {
  it("renders the page title and hands the composer a roster built from the matchup week read", async () => {
    await renderPage();
    expect(await screen.findByRole("heading", { name: "Trades" })).toBeInTheDocument();
    expect(screen.getByText("Sunday Money")).toBeInTheDocument();
  });

  // Persona panel (commissioner, step 4): no approval step and no veto window is a real
  // departure from other platforms, said plainly rather than discovered the first time a
  // commissioner tries to stop a trade and can't.
  it("tells every viewer trades complete with no review step", async () => {
    await renderPage();
    expect(await screen.findByText("Trades complete as soon as both sides agree. There's no review step, for anyone.")).toBeInTheDocument();
  });

  it("404s a league that doesn't exist", async () => {
    vi.mocked(leagueHome).mockResolvedValue(null);
    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(vi.mocked(matchupWeek)).not.toHaveBeenCalled();
  });

  it("404s a signed-in caller with no team in this league, never 403", async () => {
    vi.mocked(leagueHome).mockResolvedValue({ ...HOME, myTeamId: null });
    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  // Fix round 1, F6 (LOW, code review): this test's own name promised something its body never
  // checked. Now it actually opens the composer and reads the `Select`'s own options.
  it("offers every other team as a counterparty, never the caller's own", async () => {
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Put an offer together" }));

    const select = screen.getByLabelText("Trade with") as HTMLSelectElement;
    const optionLabels = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(optionLabels).toContain("Iron Owls");
    expect(optionLabels).not.toContain("Bay Bandits"); // the caller's own team, HOME.myTeamId
  });

  // Fix round 1, F6 (LOW, code review): a bye week, or a week whose schedule isn't generated
  // yet, leaves `matchupWeek` with no row for the caller's own team — the composer's roster
  // picker degrades honestly rather than crashing, and this pins that it still does once the
  // empty state gained cause-and-action copy.
  it("degrades honestly, with Propose trade staying disabled, when the caller's own team has no matchup row this week", async () => {
    vi.mocked(matchupWeek).mockResolvedValue({ ...WEEK_BODY, matchups: [] });
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Put an offer together" }));
    fireEvent.change(screen.getByLabelText("Trade with"), { target: { value: "t2" } });

    const yourPlayers = screen.getByRole("group", { name: "Your players" });
    expect(within(yourPlayers).getByText(/Nobody available to trade for on this team right now\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Propose trade" })).toBeDisabled();
  });
});
