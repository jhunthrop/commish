import { describe, it, expect, afterEach, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { HomeBody } from "../contract";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { fixtureLeagueDeps, homeCard, PUBLIC_LEAGUES, renderInLeague } from "../test-fixtures";
import { HomeBoard } from "./home-board";

// `OpenRooms` embeds `JoinPublicLeagueButton`, which navigates via `next/navigation`'s
// `useRouter` — stubbed the same way `create-league-panel.test.tsx` does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

/** The mock's three-league manager: one in season with an empty lineup slot, one drafting Sunday
 *  with slots still unranked, one still filling with nothing owed. */
const IN_SEASON = homeCard({
  id: "l_season",
  name: "The Blitz Room",
  teamCount: 12,
  filledTeams: 12,
  weekNumber: 4,
  weekStatus: "scheduled",
  lineupSet: false,
  record: { wins: 2, losses: 1, ties: 0 },
  opponentManagerName: "Rey Okafor",
  matchup: { weekNumber: 4, homeTeamId: "t1", awayTeamId: "t2", homeTeamName: "Bay Bandits", awayTeamName: "Iron Owls", homeScore: null, awayScore: null, final: false, weekStatus: "scheduled" },
  members: [
    { userId: "u1", name: "Justin Hunthrop", avatar: null, isSelf: true },
    { userId: "u2", name: "Rey Okafor", avatar: null, isSelf: false },
  ],
  since: {
    headline: "Iron Owls and Harbor Hawks completed a trade.",
    detail: "Iron Owls sent Malik Nabers and got Garrett Wilson.",
    occurredAt: "2026-08-31T00:00:00.000Z",
    kind: "trade",
    actor: { userId: "u2", name: "Rey Okafor", avatar: null },
  },
});

const DRAFTING = homeCard({
  id: "l_draft",
  name: "Sharks Only Auction",
  format: "auction",
  teamCount: 10,
  filledTeams: 9,
  draftStatus: "scheduled",
  startTrigger: "scheduled",
  kickoffAt: "2026-09-13T13:55:00.000Z",
  kickoffRelative: "in 2 days",
  slotsRanked: false,
  record: null,
  myRank: null,
});

const FILLING = homeCard({
  id: "l_fill",
  name: "Fourth and Long",
  teamCount: 12,
  filledTeams: 1,
  draftStatus: "scheduled",
  startTrigger: "when_full",
  slotsRanked: true,
  record: null,
  myRank: null,
});

function body(leagues: HomeBody["leagues"]): HomeBody {
  return { leagues, liveState: null };
}

/** Every SOLID verb on the page, by the class only `Button`'s `verb`/`primary` variant carries —
 *  the same probe the Sideline e2e specs use, so the unit and the browser agree on what "solid"
 *  means. */
function solidVerbs(container: HTMLElement): readonly Element[] {
  return [...container.querySelectorAll('[class*="shadow-verb-glow"]')];
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HomeBoard orders leagues by what needs this manager first", () => {
  it("puts the open one-time tasks above the quiet league, in the order they can be acted on", () => {
    const quiet = homeCard({ id: "l_quiet", name: "Harbor Hawks Home" });
    const { container } = renderInLeague(<HomeBoard initial={body([quiet, FILLING, DRAFTING, IN_SEASON])} />, fixtureLeagueDeps().deps);
    // The name itself, not the live chip beside it inside the same heading.
    const names = [...container.querySelectorAll("[data-testid='home-league-card'] h2 a")].map((node) => node.textContent);
    expect(names).toEqual(["The Blitz Room", "Sharks Only Auction", "Harbor Hawks Home", "Fourth and Long"]);
  });

  it("gives the page exactly one solid verb, on the first league that is owed something", () => {
    const { container } = renderInLeague(
      <HomeBoard initial={body([IN_SEASON, DRAFTING, FILLING])} openLeagues={PUBLIC_LEAGUES} />,
      fixtureLeagueDeps().deps,
    );
    const solid = solidVerbs(container);
    expect(solid).toHaveLength(1);
    expect(solid[0]).toHaveTextContent("Set your lineup");
  });

  it("spends no solid verb at all when nothing is owed", () => {
    const { container } = renderInLeague(
      <HomeBoard initial={body([homeCard({ id: "l_quiet" })])} openLeagues={PUBLIC_LEAGUES} />,
      fixtureLeagueDeps().deps,
    );
    expect(solidVerbs(container)).toHaveLength(0);
  });
});

describe("HomeBoard's one-league state is the whole page", () => {
  it("renders the single league as the only card, with the page's solid verb on it", () => {
    const { container } = renderInLeague(<HomeBoard initial={body([FILLING])} openLeagues={PUBLIC_LEAGUES} />, fixtureLeagueDeps().deps);
    expect(container.querySelectorAll("[data-testid='home-league-card']")).toHaveLength(1);
    // Nothing is owed in this league (its slots are ranked), so the lobby below is quiet too and
    // the page carries no solid verb rather than inventing one.
    expect(solidVerbs(container)).toHaveLength(0);
    expect(screen.getByText("Filling, 1 of 12. Drafts when full.")).toBeInTheDocument();
  });

  it("gives the page's one solid verb to the pre-draft league when its slots are still unranked", () => {
    const { container } = renderInLeague(
      <HomeBoard initial={body([{ ...FILLING, slotsRanked: false }])} openLeagues={PUBLIC_LEAGUES} />,
      fixtureLeagueDeps().deps,
    );
    expect(solidVerbs(container)).toHaveLength(1);
    expect(solidVerbs(container)[0]).toHaveTextContent("Rank your draft slots");
  });
});

describe("HomeBoard with no leagues makes the lobby the page", () => {
  it("renders no cards and gives the featured room the one solid verb", () => {
    const { container } = renderInLeague(<HomeBoard initial={body([])} openLeagues={PUBLIC_LEAGUES} />, fixtureLeagueDeps().deps);
    expect(container.querySelectorAll("[data-testid='home-league-card']")).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Open rooms" })).toBeInTheDocument();
    // One per breakpoint form (the lg+ row and the sub-lg card are the same league rendered
    // twice, only one of which is ever visible) — never two competing rooms.
    expect(solidVerbs(container).length).toBeGreaterThan(0);
    // `JoinPublicLeagueButton` is the signed-in form of "Take a seat" and says "Join" on the
    // button itself; its accessible name carries the full sentence.
    for (const verb of solidVerbs(container)) expect(verb).toHaveTextContent(/Join|Take a seat|Take the last seat/);
  });

  it("renders nothing at all when there are neither leagues nor open rooms", () => {
    const { container } = renderInLeague(<HomeBoard initial={body([])} openLeagues={[]} />, fixtureLeagueDeps().deps);
    expect(container.querySelector("[data-testid='open-rooms']")).toBeNull();
  });
});

describe("HomeBoard never offers a seat this manager is already sitting in", () => {
  it("drops a room from the lobby when it is one of this manager's own leagues", () => {
    const mine = homeCard({ id: PUBLIC_LEAGUES[0]!.id, name: PUBLIC_LEAGUES[0]!.name, draftStatus: "scheduled", startTrigger: "when_full", slotsRanked: true });
    renderInLeague(<HomeBoard initial={body([mine])} openLeagues={PUBLIC_LEAGUES} />, fixtureLeagueDeps().deps);
    const lobby = screen.getByTestId("open-rooms");
    expect(within(lobby).queryByText(PUBLIC_LEAGUES[0]!.name)).toBeNull();
    expect(within(lobby).getAllByText(PUBLIC_LEAGUES[1]!.name).length).toBeGreaterThan(0);
  });

  it("renders no lobby at all when the only open room is one this manager already holds a seat in", () => {
    const mine = homeCard({ id: PUBLIC_LEAGUES[0]!.id, name: PUBLIC_LEAGUES[0]!.name });
    const { container } = renderInLeague(
      <HomeBoard initial={body([mine])} openLeagues={[PUBLIC_LEAGUES[0]!]} />,
      fixtureLeagueDeps().deps,
    );
    expect(container.querySelector("[data-testid='open-rooms']")).toBeNull();
  });
});

describe("HomeBoard's background refresh", () => {
  it("asks only while a week is in progress and the tab is visible", async () => {
    vi.useFakeTimers();
    const fixture = fixtureLeagueDeps({ ok: true, data: body([IN_SEASON]) });
    const live = { ...IN_SEASON, weekStatus: "in_progress" as const };
    const { unmount } = renderInLeague(<HomeBoard initial={body([live])} />, fixture.deps);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs + 10);
    });
    expect(fixture.calls).toContain("GET /api/home");
    unmount();
  });

  it("never asks when no week is in progress", async () => {
    vi.useFakeTimers();
    const fixture = fixtureLeagueDeps({ ok: true, data: body([IN_SEASON]) });
    const { unmount } = renderInLeague(<HomeBoard initial={body([IN_SEASON])} />, fixture.deps);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs * 3);
    });
    expect(fixture.calls).toHaveLength(0);
    unmount();
  });
});

describe("HomeBoard is accessible in both themes", () => {
  it("has no axe violations with three leagues and the lobby", async () => {
    await renderSurface(
      <HomeBoard initial={body([IN_SEASON, DRAFTING, FILLING])} openLeagues={PUBLIC_LEAGUES} />,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
        // The cards are a list of leagues, announced as one.
        expect(within(container).getByRole("list", { name: "Your leagues" })).toBeInTheDocument();
      },
    );
  });
});
