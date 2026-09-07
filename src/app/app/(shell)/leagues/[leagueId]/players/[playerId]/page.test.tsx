import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Player } from "@/domain/player";
import type { PlayerDossierFacts } from "@/league-service/dossier-facts";
import type { PlayerSeasonBody } from "@/league-service/player";

// Route-level: the page's own season default/label/switcher, mocked the way `activity/page.test.tsx`
// mocks its own reads — every DB-backed call stubbed, `notFound()` left as the real implementation
// (a plain synchronous throw, no request context required) so a membership-gate 404 is provably real.
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/lib/leagues/membership", () => ({ resolveLeagueMembership: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
// `parseSeasonParam` is left as its real implementation (pure, no DB) — only `playerSeason`
// itself is stubbed. Mocking it too would let a bug in the page's use of `parseSeasonParam`
// hide behind a mock that always echoes back whatever the test expected.
vi.mock("@/league-service/player", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/league-service/player")>();
  return { ...actual, playerSeason: vi.fn() };
});

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
    isMockLeague: false,
    injuryDesignation: null,
    log: [],
    totals: null,
    kdefSeason: null,
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
  isMockLeague: false,
  injuryDesignation: null,
  log: [],
  totals: null,
  kdefSeason: null,
  news: [],
  reasons: [],
  laws: [],
};

/** THE THIRD STATE (fix round 1, CRITICAL) — `availableSeasons` is empty exactly like a true
 *  rookie's, but `isRookie` is `false`: a crosswalk miss, or a placed veteran the store has no
 *  weeks for. The page must tell these apart. */
const NO_RECORD_BODY: PlayerSeasonBody = { ...ROOKIE_BODY, isRookie: false };

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
    expect(screen.queryByText("No prior seasons on record.")).not.toBeInTheDocument();
  });

  it("gives a veteran with no recorded season the honest 'no record' sentence, never the rookie one (fix round 1, CRITICAL)", async () => {
    vi.mocked(playerSeason).mockResolvedValue(NO_RECORD_BODY);
    await renderPage();
    expect(screen.getByText("No prior seasons on record.")).toBeInTheDocument();
    expect(screen.queryByText("His first NFL season.")).not.toBeInTheDocument();
  });

  it("404s a player id `playerSeason` cannot find, same as before the widening", async () => {
    vi.mocked(playerSeason).mockResolvedValue(null);
    await expect(callPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

/**
 * THE OUTLOOK, NEWLY ON THE FULL PAGE (2026-09-04) — this page never rendered `body.reasons` at
 * all before the redesign; these pin the page's own wiring of `<Outlook>` (the grouping and
 * verdict logic itself is `outlook/groups.test.ts` and `outlook/verdict.test.ts`'s job, not
 * re-tested here).
 */
describe("PlayerPage — the Outlook", () => {
  it("renders nothing when the board never ranked him", async () => {
    vi.mocked(playerSeason).mockResolvedValue(bodyFor(2026, [2026]));
    await renderPage();
    expect(screen.queryByText("Outlook")).not.toBeInTheDocument();
  });

  it("renders the verdict line and every grouped fact, uncapped (unlike the peek's five-group cap)", async () => {
    vi.mocked(playerSeason).mockResolvedValue({
      ...bodyFor(2026, [2026]),
      reasons: [
        { code: "market_anchor", marketPoints: 200, delta: 14.2 },
        { code: "scarcity", positionRank: 4, replacementLevel: 140 },
        { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
        { code: "law", lawId: "rb_workload_cliff", effect: -0.9, magnitude: 320 },
        { code: "changed_team", from: "SF", to: "MIA" },
        { code: "availability", expectedGames: 14, floorGames: 10, ceilingGames: 17 },
        { code: "rookie", overallPick: null, landingMultiplier: 1 },
      ],
    });
    await renderPage();
    expect(screen.getByText("Outlook")).toBeInTheDocument();
    expect(screen.getByText(/The market is underpricing him/)).toBeInTheDocument();
    // Five groups total (two law groups, three fact groups) — no cap, no "The full case" expander.
    expect(screen.getByText(/Age 29 season/)).toBeInTheDocument();
    expect(screen.getByText(/320 touches last season/)).toBeInTheDocument();
    expect(screen.queryByText(/The full case/)).not.toBeInTheDocument();
  });
});

/**
 * THE FULL PAGE, UNCAPPED (Player Dossier plan, Task 6) — the same dossier composition the peek
 * renders (`player-peek.test.tsx`'s own "the dossier composition" block), at its uncapped depth:
 * the full capsule Read, every why group with no expander, the complete game log (new to this
 * page), and both scoring bases named. `body.dossier` absent — `null` or `undefined` alike —
 * falls back to the page's own pre-dossier composition, pinned unmodified by every test above
 * this block.
 */
describe("PlayerPage — the dossier composition (Task 6)", () => {
  const DOSSIER_REASONS: PlayerSeasonBody["reasons"] = [
    { code: "market_anchor", marketPoints: 200, delta: 14.2 },
    { code: "scarcity", positionRank: 4, replacementLevel: 140 },
    { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
    { code: "law", lawId: "rb_workload_cliff", effect: -0.9, magnitude: 320 },
    { code: "changed_team", from: "SF", to: "MIA" },
    { code: "availability", expectedGames: 14, floorGames: 10, ceilingGames: 17 },
    { code: "rookie", overallPick: null, landingMultiplier: 1 },
    { code: "new_play_caller", team: "MIA" },
  ];

  const DOSSIER: PlayerDossierFacts = {
    market: { adp: 24.3, positionAdp: "RB3", boardRank: 9, positionRank: 4, replacementLevel: 140, playersLeftInTier: null, dropToNextTier: null, marketAnchorPoints: 200, marketAnchorDelta: 14.2 },
    projection: {
      projectedPoints: 214.2, floorPoints: 150, medianPoints: 210, ceilingPoints: 280, typicalLow: 190, typicalHigh: 230,
      perGamePoints: 15, perGamePositionRank: { value: 15, positionRank: 8, qualifierCount: 32 },
    },
    availability: { expectedGames: 15.4, floorGames: 10, ceilingGames: 17 },
    usage: {
      season: 2025, snapShare: 0.62, snapShareRank: { value: 0.62, positionRank: 4, qualifierCount: 32, namedNeighbor: null },
      targetShare: null, targetShareRank: null, redZoneShare: null, redZoneShareRank: null,
    },
    trend: null,
    books: { propsLines: [{ market: "player_rush_yds", medianLine: 70.5 }], teamVegasWinTotal: 9.5 },
    lastSeasonStory: {
      season: 2025, pointsRank: { value: 260, positionRank: 4, qualifierCount: 32, namedNeighbor: null }, pointsPerGame: 18.1, gamesPlayed: 15,
      bestWeek: { week: 12, points: 34.6 }, weeksAboveMedian: 9, touchesRank: null,
      receivingYardsRank: { value: 410, positionRank: 12, qualifierCount: 45, namedNeighbor: null },
    },
    injury: { state: "unknown" },
    newsCount: 1,
    basis: { scoringLabel: "PPR" },
    byeWeek: 8,
  };

  function dossierBody(overrides: Partial<PlayerSeasonBody> = {}): PlayerSeasonBody {
    return {
      ...bodyFor(2026, [2026]),
      reasons: DOSSIER_REASONS,
      dossier: DOSSIER,
      capsule: { bodyCompact: "The compact read.", bodyFull: "The full, uncapped read.", source: "llm" },
      injuryDesignation: "Q",
      news: [{ title: "Rashad Long: full practice", link: "https://example.com/1" }],
      totals: { games: 1, carries: 15, rushingYards: 80, targets: 3, receptions: 2, receivingYards: 20, passingYards: 0, touchdowns: 1, fantasyPoints: 12.5 },
      log: [{ week: 1, points: 12.5, carries: 15, rushingYards: 80, targets: 3, receptions: 2, receivingYards: 20, passingYards: 0, touchdowns: 1 }],
      ...overrides,
    };
  }

  it("composes the call card and the full dossier grid when the dossier is real", async () => {
    // `season: 2025` — matching `DOSSIER.lastSeasonStory.season` (fix round 1, CRITICAL 2: a
    // mismatched pair renders the honest fallback instead of `SeasonStrip`; see the dedicated
    // regression test below for that case). This test's own purpose is proving every module is
    // present, `SeasonStrip` included, so it needs the season on screen to actually match the
    // story.
    vi.mocked(playerSeason).mockResolvedValue(dossierBody({ season: 2025 }));
    await renderPage();
    expect(screen.getByLabelText("The call")).toBeInTheDocument();
    expect(screen.getByLabelText("Season range")).toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toBeInTheDocument();
    expect(screen.getByLabelText("The read")).toBeInTheDocument();
    expect(screen.getByLabelText("The books")).toBeInTheDocument();
    expect(screen.getByLabelText("2025 season")).toBeInTheDocument();
    expect(screen.getByLabelText("Story")).toBeInTheDocument();
    expect(screen.getByText("Why")).toBeInTheDocument();
  });

  it("fix round 1, CRITICAL 2: shows the honest season fallback, never a mismatched SeasonStrip, when the story's own season differs from the one on screen", async () => {
    // The default fixture's own `season` is 2026 (the current season, already played);
    // `DOSSIER.lastSeasonStory.season` is always 2025 (last season) — the realistic default
    // mismatch this fix closes. Before the fix, this rendered a "2025 season" card captioned
    // over 2026's own weekly bars, with the switcher inside the card moving the bars but never
    // the header; after it, the honest fallback (labeled with whichever season IS on screen)
    // covers it instead.
    vi.mocked(playerSeason).mockResolvedValue(dossierBody());
    await renderPage();
    expect(screen.queryByLabelText("2025 season")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Rashad Long, points by week")).toBeInTheDocument();
  });

  it("states the FULL capsule read, never the compact one, when the capsule is a genuine LLM write-up", async () => {
    vi.mocked(playerSeason).mockResolvedValue(dossierBody());
    await renderPage();
    expect(screen.getByText("The full, uncapped read.")).toBeInTheDocument();
    expect(screen.queryByText("The compact read.")).not.toBeInTheDocument();
  });

  it("falls back to the compact read, labeled honestly, when the capsule is template-sourced (full is not a genuine longer write-up)", async () => {
    vi.mocked(playerSeason).mockResolvedValue(dossierBody({ capsule: { bodyCompact: "The template's own sentence.", bodyFull: "The template's own sentence.", source: "template" } }));
    await renderPage();
    expect(screen.getByText("The template's own sentence.")).toBeInTheDocument();
    expect(screen.getByText("The short version while we write him up.")).toBeInTheDocument();
  });

  it("shows every why group uncapped, never a 'the full case' expander (unlike the peek's own cap)", async () => {
    vi.mocked(playerSeason).mockResolvedValue(dossierBody());
    await renderPage();
    expect(screen.getByText("Age 29 season.")).toBeInTheDocument();
    expect(screen.getByText("New play caller.")).toBeInTheDocument();
    expect(screen.queryByText(/The full case/)).not.toBeInTheDocument();
  });

  it("names both scoring bases — the dossier's own board basis and this league's own scoring", async () => {
    // `season: 2025` — matching `DOSSIER.lastSeasonStory.season`, so `SeasonStrip` itself renders
    // (fix round 1, CRITICAL 2: a mismatched pair shows the honest fallback instead, which never
    // states the board's basis at all). Both bases still fully coexist here: `SeasonStrip`'s own
    // basis and `SeasonTotalsAndLog`'s own league basis, for the SAME season now on screen.
    vi.mocked(playerSeason).mockResolvedValue(dossierBody({ season: 2025 }));
    await renderPage();
    // SeasonStrip's own "points per game" fact states the board's basis as its sub-note.
    expect(screen.getByText("PPR")).toBeInTheDocument();
    // SeasonTotalsAndLog names the OTHER basis, on both of its own headers.
    expect(screen.getByText("2025 totals · under this league's scoring")).toBeInTheDocument();
    expect(screen.getByText("2025 game log · under this league's scoring")).toBeInTheDocument();
  });

  it("also names the league's own scoring on the default (current-season) view, even though the board's basis has no honest place to render there", async () => {
    // The realistic default: the board's own basis (`SeasonStrip`'s "PPR") only ever shows for
    // the PRIOR season it actually describes; the CURRENT season's own totals/log still name
    // their basis on every render, mismatch or not.
    vi.mocked(playerSeason).mockResolvedValue(dossierBody());
    await renderPage();
    expect(screen.getByText("2026 totals · under this league's scoring")).toBeInTheDocument();
    expect(screen.getByText("2026 game log · under this league's scoring")).toBeInTheDocument();
  });

  it("shows the complete game log, which this page never rendered before this task", async () => {
    vi.mocked(playerSeason).mockResolvedValue(dossierBody());
    await renderPage();
    expect(screen.getByText("2026 game log · under this league's scoring")).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("falls back to today's layout — no dossier modules — when the dossier is null", async () => {
    vi.mocked(playerSeason).mockResolvedValue({ ...bodyFor(2026, [2026]), reasons: DOSSIER_REASONS, dossier: null });
    await renderPage();
    expect(screen.getByText(/The market is underpricing him/)).toBeInTheDocument();
    expect(screen.queryByLabelText("The call")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Season range")).not.toBeInTheDocument();
  });

  it("falls back to today's layout when the dossier field is simply absent (a fixture predating this task)", async () => {
    vi.mocked(playerSeason).mockResolvedValue(bodyFor(2026, [2026]));
    await renderPage();
    expect(screen.queryByLabelText("The call")).not.toBeInTheDocument();
  });

  it("follows the copy rules across the whole uncapped composition — no em-dash, no semicolon", async () => {
    vi.mocked(playerSeason).mockResolvedValue(dossierBody());
    const { container } = await renderPage();
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });
});
