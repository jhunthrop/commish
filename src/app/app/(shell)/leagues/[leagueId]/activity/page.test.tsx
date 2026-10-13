import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatRoomDepsProvider } from "@/chat-room/hooks/deps";
import { fixtureChatDeps } from "@/chat-room/test-fixtures";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { HOME, fixtureLeagueDeps } from "@/league-room/test-fixtures";
import { resolveServerTree } from "@/lib/test-support";

// Route-level: proves the page's own 404 branches without a real Postgres connection — every
// read the route makes (through `loadRoomData`, the room's one server read) is mocked, and
// `notFound()` is the real `next/navigation` implementation (a plain synchronous throw with a
// `NEXT_HTTP_ERROR_FALLBACK;404` digest, no request context required), so asserting on that
// digest is asserting on the real behavior a browser would see.
//
// `usePathname`/`useRouter` are the only members stubbed: `RoomShell` is a browser component
// reading the URL, and the surface it opens must agree with the route under test — the same
// stub `room-shell.test.tsx` uses, applied here over the real module so `notFound` stays real.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/app/leagues/league_1/activity",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@research-ts/db/client", () => ({ getDb: () => ({}) }));
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
vi.mock("@research-ts/reference/nfl-schedule", () => ({ byeWeeksByTeam: vi.fn() }));
vi.mock("@/league-service/claims", () => ({ pendingWaiverClaims: vi.fn() }));
vi.mock("@/league-service/trades", () => ({ listTrades: vi.fn() }));
vi.mock("@/league-service/reference-cache-instance", () => ({ getReferenceCache: () => ({}) }));
// The front page's own two reads, mocked at their own service seams like every sibling above —
// `loadRoomData` really runs now that `resolveServerTree` renders `RoomPage` for real, and the
// `getDb: () => ({})` stub above is not a database either of them can select from.
vi.mock("@/league-service/head-to-head", () => ({ cachedHeadToHeadRecords: vi.fn(), recordsForTeam: () => new Map() }));
vi.mock("@/league-service/head-to-head-cache-instance", () => ({ getHeadToHeadCache: () => ({}) }));
vi.mock("@/league-service/event-reactions", () => ({ reactionsForEvents: vi.fn() }));
vi.mock("@/lib/realtime/redis", () => ({ getSharedRedis: () => ({}) }));
vi.mock("@/lib/realtime/presence", () => ({ createPresenceStore: () => ({ listPresent: async () => [] }) }));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { listLeagueActivity } from "@/integrity-service/activity";
import { listNotices } from "@/integrity-service/notify";
import { leagueHome, lineupView, matchupWeek, weeklyProjectionsByPlayerId, fixtureLabelsByTeam, gradesForDraft } from "@/league-service";
import { byeWeeksByTeam } from "@research-ts/reference/nfl-schedule";
import { pendingWaiverClaims } from "@/league-service/claims";
import { listTrades } from "@/league-service/trades";
import { cachedHeadToHeadRecords } from "@/league-service/head-to-head";
import { reactionsForEvents } from "@/league-service/event-reactions";
import LeagueActivityPage from "./page";

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

const LEAGUE = { ...HOME, leagueId: "league_1", isCommissioner: false };

/** The route the way the server runs it: `ActivityPage` returns `<RoomPage>`, and `RoomPage` is
 *  where the membership gate lives, so the tree has to be resolved to the browser boundary
 *  before anything the route decides has happened. */
function callPage(leagueId = "league_1") {
  return resolveServerTree(LeagueActivityPage({ params: Promise.resolve({ leagueId }), searchParams: Promise.resolve({}) }));
}

async function renderPage(leagueId?: string) {
  const page = await callPage(leagueId);
  return render(
    <ChatRoomDepsProvider deps={fixtureChatDeps().deps}>
      <LeagueRoomDepsProvider deps={fixtureLeagueDeps().deps}>{page}</LeagueRoomDepsProvider>
    </ChatRoomDepsProvider>,
  );
}

beforeEach(() => {
  vi.mocked(requireCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(readPreferences).mockReset().mockResolvedValue({ helpLevel: "standard", draftTourDismissedAt: null });
  vi.mocked(leagueHome).mockReset();
  vi.mocked(lineupView).mockReset().mockResolvedValue(null);
  vi.mocked(matchupWeek).mockReset().mockResolvedValue(null);
  vi.mocked(weeklyProjectionsByPlayerId).mockReset().mockResolvedValue(new Map());
  vi.mocked(fixtureLabelsByTeam).mockReset().mockResolvedValue(new Map());
  vi.mocked(byeWeeksByTeam).mockReset().mockResolvedValue(new Map());
  vi.mocked(pendingWaiverClaims).mockReset().mockResolvedValue([]);
  vi.mocked(listTrades).mockReset().mockResolvedValue({ leagueId: "league_1", meTeamId: "t1", inbox: [], outbox: [], history: [] });
  vi.mocked(gradesForDraft).mockReset().mockResolvedValue({ grades: [], boardGeneration: null });
  vi.mocked(listLeagueActivity).mockReset().mockResolvedValue({ rows: [], nextBefore: null });
  vi.mocked(listNotices).mockReset().mockResolvedValue({ notices: [], unreadCount: 0 });
  vi.mocked(cachedHeadToHeadRecords).mockReset().mockResolvedValue(new Map());
  vi.mocked(reactionsForEvents).mockReset().mockResolvedValue(new Map());
});

describe("LeagueActivityPage — membership gate", () => {
  // Fix round 1, FIX 3: the residual this task's own review carried forward — `LeaguePage`
  // (`../page.tsx`) has the identical gap today and is left alone; this test covers only the
  // activity page this task owns.
  it("404s a signed-in stranger — no team here and not the commissioner — never 403", async () => {
    vi.mocked(leagueHome).mockResolvedValue({ ...LEAGUE, myTeamId: null, isCommissioner: false });

    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(vi.mocked(listLeagueActivity)).not.toHaveBeenCalled();
    expect(vi.mocked(listNotices)).not.toHaveBeenCalled();
  });

  it("404s a league id that names no real league, the same as a stranger — a non-oracle response", async () => {
    vi.mocked(leagueHome).mockResolvedValue(null);

    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(vi.mocked(listLeagueActivity)).not.toHaveBeenCalled();
  });

  // The surface IS the route (law 2): the activity route opens the activity drawer at full
  // height, which is what "the activity page rendered" means since the room replaced the tabs.
  it("renders for a real member — a team owner — and for the commissioner with no team", async () => {
    vi.mocked(leagueHome).mockResolvedValue({ ...LEAGUE, myTeamId: "t1" });
    await renderPage();
    expect(await screen.findByLabelText("Activity drawer")).toBeInTheDocument();

    vi.mocked(leagueHome).mockResolvedValue({ ...LEAGUE, myTeamId: null, isCommissioner: true });
    await renderPage();
    expect(await screen.findAllByLabelText("Activity drawer")).not.toHaveLength(0);
  });

  // Fix round 1, FIX 5: the persona panel's high-stakes-veteran question about `lineup_change`
  // being actor-only — answered plainly on the surface itself rather than left implicit.
  it("states plainly that lineup changes are private to their own actor", async () => {
    vi.mocked(leagueHome).mockResolvedValue({ ...LEAGUE, myTeamId: "t1" });
    await renderPage();
    expect(
      await screen.findByText("Lineup changes appear only in your own history. Nobody else in this league can see them."),
    ).toBeInTheDocument();
  });
});
