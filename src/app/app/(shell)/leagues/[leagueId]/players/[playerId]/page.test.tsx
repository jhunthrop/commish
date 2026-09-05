import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Player } from "@/domain/player";
import type { PlayerSeasonBody } from "@/league-service/player";

// Route-level: the page's own season default/label/switcher, mocked the way `activity/page.test.tsx`
// mocks its own reads — every DB-backed call stubbed, `notFound()` left as the real implementation
// (a plain synchronous throw, no request context required) so a membership-gate 404 is provably real.
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/lib/leagues/membership", () => ({ resolveLeagueMembership: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/league-service/player", () => ({ playerSeason: vi.fn() }));

const push = vi.fn();
// `PlayerPageSeasonSwitcher` navigates via `next/navigation`'s `useRouter`, which throws outside a
// mounted App Router — stubbed the same way `profile-form.test.tsx` stubs it, with the real
// `notFound` kept intact via `importOriginal` so the membership-gate test above stays honest.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ push, refresh: vi.fn() }) };
});

import { requireCurrentUser } from "@/lib/auth/current-user";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import { playerSeason } from "@/league-service/player";
import PlayerPage from "./page";

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };
const PLAYER: Player = { id: "rb1", name: "Rashad Long", position: "RB", nflTeam: "SF", headshotUrl: null, adp: 2.5 };

function bodyFor(season: number, availableSeasons: readonly number[]): PlayerSeasonBody {
  return {
    player: PLAYER,
    availableSeasons,
    season,
    isRookie: false,
    positionRank: 1,
    adpPercentile: 0.9,
    expertRank: 5,
    modelRank: 4,
    pointsPerGame: 12.5,
    pointsPerGamePercentile: 0.7,
    weeks: [{ week: 1, points: 12.5, percentile: 0.7 }],
    ownedBy: null,
    injuryDesignation: null,
    log: [],
    totals: null,
    news: [],
    reasons: [],
    laws: [],
  };
}

const ROOKIE_BODY: PlayerSeasonBody = {
  player: PLAYER,
  availableSeasons: [],
  season: 2026,
  isRookie: true,
  positionRank: null,
  adpPercentile: null,
  expertRank: null,
  modelRank: null,
  pointsPerGame: null,
  pointsPerGamePercentile: null,
  weeks: [],
  ownedBy: null,
  injuryDesignation: null,
  log: [],
  totals: null,
  news: [],
  reasons: [],
  laws: [],
};

function callPage(searchParams: Record<string, string> = {}) {
  return PlayerPage({
    params: Promise.resolve({ leagueId: "league_1", playerId: "rb1" }),
    searchParams: Promise.resolve(searchParams),
  });
}

async function renderPage(searchParams?: Record<string, string>) {
  const page = await callPage(searchParams);
  return render(page);
}

beforeEach(() => {
  vi.mocked(requireCurrentUser).mockReset().mockResolvedValue(USER);
  vi.mocked(resolveLeagueMembership).mockReset().mockResolvedValue({
    ok: true,
    membership: { leagueId: "league_1", teamId: "team_1", isCommissioner: false, authority: { kind: "member", userId: "u1" } },
  });
  vi.mocked(playerSeason).mockReset();
  push.mockReset();
});

describe("PlayerPage — season label and switcher", () => {
  it("404s a non-member the same way the activity page does", async () => {
    vi.mocked(resolveLeagueMembership).mockResolvedValue({ ok: false, status: 404, error: "not a member" });
    await expect(callPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("labels the season explicitly and renders no switcher for a player with only one season", async () => {
    vi.mocked(playerSeason).mockResolvedValue(bodyFor(2026, [2026]));
    await renderPage();
    expect(screen.getByText("2026 season")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Season" })).not.toBeInTheDocument();
    // The default read: no `season` query param means the service picks, so the route asks
    // `playerSeason` for its own default (`undefined`), never a fabricated year.
    expect(playerSeason).toHaveBeenCalledWith({}, "league_1", "rb1", undefined, undefined);
  });

  it("renders a segmented switcher for a player with more than one season, and navigates on a press", async () => {
    const user = userEvent.setup();
    vi.mocked(playerSeason).mockResolvedValue(bodyFor(2025, [2026, 2025]));
    await renderPage({ season: "2025" });
    expect(screen.getByText("2025 season")).toBeInTheDocument();
    // The requested season reached the service as a real number, not the raw query string.
    expect(playerSeason).toHaveBeenCalledWith({}, "league_1", "rb1", undefined, 2025);

    const group = screen.getByRole("group", { name: "Season" });
    expect(within(group).getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "2026" }));
    expect(push).toHaveBeenCalledWith("/app/leagues/league_1/players/rb1?season=2026");
  });

  it("ignores a malformed season query param rather than passing it through", async () => {
    vi.mocked(playerSeason).mockResolvedValue(bodyFor(2026, [2026]));
    await renderPage({ season: "not-a-year" });
    expect(playerSeason).toHaveBeenCalledWith({}, "league_1", "rb1", undefined, undefined);
  });

  it("gives a true rookie one honest sentence in place of the chart", async () => {
    vi.mocked(playerSeason).mockResolvedValue(ROOKIE_BODY);
    await renderPage();
    expect(screen.getByText("His first NFL season.")).toBeInTheDocument();
    expect(screen.queryByText(/No scored week for him/)).not.toBeInTheDocument();
  });

  it("404s a player id `playerSeason` cannot find, same as before the widening", async () => {
    vi.mocked(playerSeason).mockResolvedValue(null);
    await expect(callPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
