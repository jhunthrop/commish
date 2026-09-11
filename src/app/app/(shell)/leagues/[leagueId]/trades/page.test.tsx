import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { fixtureLeagueDeps } from "@/league-room/test-fixtures";
import type { TradeProposalView } from "@/trades/contract";
import { resolveServerTree } from "@/lib/test-support";

// Route-level: every read the route makes (through `loadRoomData`, the room's one server read)
// is mocked, same discipline `activity/page.test.tsx` established for this app tree —
// `notFound()` is the real `next/navigation` implementation (a plain synchronous throw with a
// stable digest), so asserting on it is asserting on the real behavior a browser would see.
// Only `usePathname`/`useRouter` are stubbed over the real module, so the browser shell opens
// the surface this route names while `notFound` stays real.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/app/leagues/league_1/trades",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/identity-service/preferences", () => ({ readPreferences: vi.fn() }));
vi.mock("@/integrity-service/activity", () => ({ listLeagueActivity: vi.fn() }));
vi.mock("@/integrity-service/notify", () => ({ listNotices: vi.fn(), quoteFor: vi.fn(() => null) }));
vi.mock("@/league-service", () => ({
  leagueHome: vi.fn(),
  lineupView: vi.fn(),
  matchupWeek: vi.fn(),
  weeklyProjectionsByPlayerId: vi.fn(),
  fixtureLabelsByTeam: vi.fn(),
  gradesForDraft: vi.fn(),
}));
vi.mock("@/league-service/nfl-schedule", () => ({ byeWeeksByTeam: vi.fn() }));
vi.mock("@/league-service/claims", () => ({ pendingWaiverClaims: vi.fn() }));
vi.mock("@/league-service/trades", () => ({ listTrades: vi.fn() }));
vi.mock("@/league-service/reference-cache-instance", () => ({ getReferenceCache: () => ({}) }));
vi.mock("@/lib/realtime/redis", () => ({ getSharedRedis: () => ({}) }));
vi.mock("@/lib/realtime/presence", () => ({ createPresenceStore: () => ({ listPresent: async () => [] }) }));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { listLeagueActivity } from "@/integrity-service/activity";
import { listNotices } from "@/integrity-service/notify";
import { leagueHome, lineupView, matchupWeek, weeklyProjectionsByPlayerId, fixtureLabelsByTeam, gradesForDraft } from "@/league-service";
import { byeWeeksByTeam } from "@/league-service/nfl-schedule";
import { pendingWaiverClaims } from "@/league-service/claims";
import { listTrades } from "@/league-service/trades";
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
  draftGradesVisible: true,
};

const WEEK_BODY = {
  leagueId: "league_1",
  weekNumber: 5,
  totalWeeks: 14,
  myTeamId: "t1",
  weekStatus: "in_progress" as const,
  gamesFinal: 0,
  gamesTotal: 0,
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
        starters: [{ slot: "RB" as const, slotIndex: 0, playerId: "p1", playerName: "Bijan Robinson", position: "RB" as const, nflTeam: "ATL", headshotUrl: null, adp: null, points: 0 }],
        bench: [],
      },
      away: {
        teamId: "t2",
        teamName: "Iron Owls",
        score: null,
        starters: [{ slot: "WR" as const, slotIndex: 0, playerId: "p2", playerName: "Puka Nacua", position: "WR" as const, nflTeam: "ATL", headshotUrl: null, adp: null, points: 0 }],
        bench: [],
      },
    },
  ],
};

/** A trade both managers have already agreed, waiting out the league's objection window — the
 *  one state whose governance the room states in words. */
const UNDER_REVIEW: TradeProposalView = {
  id: "trade-1",
  leagueId: "league_1",
  weekNumber: 5,
  status: "under_review",
  proposedAt: "2026-09-14T12:00:00.000Z",
  expiresAt: "2026-09-18T21:00:00.000Z",
  settledAt: null,
  reversedAt: null,
  note: null,
  from: { teamId: "t2", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "p2" }] },
  to: { teamId: "t1", teamName: "Bay Bandits", assets: [{ kind: "player", playerId: "p1" }] },
};

/** The route the way the server runs it: `TradesPage` returns `<RoomPage>`, and `RoomPage` is
 *  where the membership gate lives, so the tree has to be resolved to the browser boundary
 *  before anything the route decides has happened. */
function callPage(leagueId = "league_1") {
  return resolveServerTree(TradesPage({ params: Promise.resolve({ leagueId }) }));
}

async function renderPage(leagueId?: string, trades: readonly TradeProposalView[] = []) {
  const leagueFixture = fixtureLeagueDeps({
    ok: true,
    data: { leagueId: "league_1", meTeamId: "t1", inbox: [], outbox: [], history: trades },
  });
  const page = await callPage(leagueId);
  return render(
    <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
      <LeagueRoomDepsProvider deps={leagueFixture.deps}>{page}</LeagueRoomDepsProvider>
    </ChatRoomDepsProvider>,
  );
}

beforeEach(() => {
  vi.mocked(requireCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(readPreferences).mockReset().mockResolvedValue({ helpLevel: "standard", draftTourDismissedAt: null });
  vi.mocked(leagueHome).mockReset().mockResolvedValue(HOME);
  vi.mocked(matchupWeek).mockReset().mockResolvedValue(WEEK_BODY);
  vi.mocked(lineupView).mockReset().mockResolvedValue(null);
  vi.mocked(weeklyProjectionsByPlayerId).mockReset().mockResolvedValue(new Map());
  vi.mocked(fixtureLabelsByTeam).mockReset().mockResolvedValue(new Map());
  vi.mocked(byeWeeksByTeam).mockReset().mockResolvedValue(new Map());
  vi.mocked(pendingWaiverClaims).mockReset().mockResolvedValue([]);
  vi.mocked(listTrades).mockReset().mockResolvedValue({ leagueId: "league_1", meTeamId: "t1", inbox: [], outbox: [], history: [] });
  vi.mocked(gradesForDraft).mockReset().mockResolvedValue({ grades: [], boardGeneration: null });
  vi.mocked(listLeagueActivity).mockReset().mockResolvedValue({ rows: [], nextBefore: null });
  vi.mocked(listNotices).mockReset().mockResolvedValue({ notices: [], unreadCount: 0 });
});

describe("TradesPage", () => {
  // The surface IS the route (law 2): the trades route opens the trades drawer at full height
  // over the room, which is what "the trades page rendered" means since the room replaced the
  // tabs. The league it belongs to is named on the room's own week strip above it.
  it("renders the page title and hands the composer a roster built from the matchup week read", async () => {
    await renderPage();
    expect(await screen.findByLabelText("Trades drawer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sunday Money" })).toBeInTheDocument();
  });

  // Persona panel (commissioner, step 4): no approval step and no veto window is a real
  // departure from other platforms, said plainly rather than discovered the first time a
  // commissioner tries to stop a trade and can't.
  //
  // D7 (competition review): the OLD sentence ("There's no review step, for anyone.") was false
  // the moment a held trade rendered on this same page — Plan D's own fairness-review carve-out
  // for lopsided public-league trades contradicted it 400px below, on the same screen. The
  // standing header paragraph that replaced it was itself retired when the room landed: a policy
  // explainer that outlives the thing it explains is exactly how the contradiction happened.
  // The rule is now stated ON the trade it governs, at the moment it applies, so a card and a
  // header can never disagree again — this pins that the surface still says it out loud.
  it("states the trade policy including its one exception, so it never contradicts a held trade on the same page", async () => {
    await renderPage(undefined, [UNDER_REVIEW]);
    expect(
      await screen.findByText("Both managers agreed. The league has a day to object before the trade goes through."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/There's no review step/)).not.toBeInTheDocument();
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
