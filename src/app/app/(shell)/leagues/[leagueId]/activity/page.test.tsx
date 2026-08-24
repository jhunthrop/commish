import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { NoticesProvider } from "@/components/app-shell/notices-provider";

// Route-level: proves the page's own 404 branches without a real Postgres connection — every
// read the page makes is mocked, and `notFound()` is the real `next/navigation` implementation
// (a plain synchronous throw with a `NEXT_HTTP_ERROR_FALLBACK;404` digest, no request context
// required), so asserting on that digest is asserting on the real behavior a browser would see.
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/lib/leagues/membership", () => ({ resolveLeagueMembership: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/draft-service/teams", () => ({ leagueNameFor: vi.fn() }));
vi.mock("@/integrity-service/activity", () => ({ listLeagueActivity: vi.fn() }));
vi.mock("@/integrity-service/notify", () => ({ listNotices: vi.fn(), quoteFor: vi.fn(() => null) }));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import { leagueNameFor } from "@/draft-service/teams";
import { listLeagueActivity } from "@/integrity-service/activity";
import { listNotices } from "@/integrity-service/notify";
import LeagueActivityPage from "./page";

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

function callPage(leagueId = "league_1") {
  return LeagueActivityPage({ params: Promise.resolve({ leagueId }), searchParams: Promise.resolve({}) });
}

/** `TopBar` renders `NoticeInbox` (Task 10), a `"use client"` component that fetches its
 *  own data — wrapped here so it never reaches the real `fetch`, the same discipline
 *  `top-bar.test.tsx` uses. */
async function renderPage(leagueId?: string) {
  const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  const page = await callPage(leagueId);
  return render(
    <AccountRoomDepsProvider deps={fixture.deps}>
      <NoticesProvider>{page}</NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

beforeEach(() => {
  vi.mocked(requireCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(resolveLeagueMembership).mockReset();
  vi.mocked(leagueNameFor).mockReset().mockResolvedValue("Sunday Money");
  vi.mocked(listLeagueActivity).mockReset().mockResolvedValue({ rows: [], nextBefore: null });
  vi.mocked(listNotices).mockReset().mockResolvedValue({ notices: [], unreadCount: 0 });
});

describe("LeagueActivityPage — membership gate", () => {
  // Fix round 1, FIX 3: the residual this task's own review carried forward — `LeaguePage`
  // (`../page.tsx`) has the identical gap today and is left alone; this test covers only the
  // activity page this task owns.
  it("404s a signed-in stranger — no team here and not the commissioner — never 403", async () => {
    vi.mocked(resolveLeagueMembership).mockResolvedValue({
      ok: true,
      membership: { leagueId: "league_1", teamId: null, isCommissioner: false, authority: { kind: "member", userId: "someone_else" } },
    });

    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(vi.mocked(listLeagueActivity)).not.toHaveBeenCalled();
    expect(vi.mocked(listNotices)).not.toHaveBeenCalled();
  });

  it("404s a league id that names no real league, the same as a stranger — a non-oracle response", async () => {
    vi.mocked(resolveLeagueMembership).mockResolvedValue({ ok: false, status: 404, error: "That league does not exist." });

    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(vi.mocked(listLeagueActivity)).not.toHaveBeenCalled();
  });

  it("renders for a real member — a team owner — and for the commissioner with no team", async () => {
    vi.mocked(resolveLeagueMembership).mockResolvedValue({
      ok: true,
      membership: { leagueId: "league_1", teamId: "t1", isCommissioner: false, authority: { kind: "member", userId: "someone_else" } },
    });
    await renderPage();
    expect(await screen.findByRole("heading", { name: "League activity" })).toBeInTheDocument();

    vi.mocked(resolveLeagueMembership).mockResolvedValue({
      ok: true,
      membership: { leagueId: "league_1", teamId: null, isCommissioner: true, authority: { kind: "member", userId: "u1" } },
    });
    await renderPage();
    expect(await screen.findAllByRole("heading", { name: "League activity" })).not.toHaveLength(0);
  });

  // Fix round 1, FIX 5: the persona panel's high-stakes-veteran question about `lineup_change`
  // being actor-only — answered plainly on the page itself rather than left implicit.
  it("states plainly that lineup changes are private to their own actor", async () => {
    vi.mocked(resolveLeagueMembership).mockResolvedValue({
      ok: true,
      membership: { leagueId: "league_1", teamId: "t1", isCommissioner: false, authority: { kind: "member", userId: "someone_else" } },
    });
    await renderPage();
    expect(
      await screen.findByText("Lineup changes appear only in your own history. Nobody else in this league can see them."),
    ).toBeInTheDocument();
  });
});
