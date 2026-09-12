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

/**
 * FIX ROUND 2, the founder's screenshot. Three defects on one card, asserted where they render.
 */
describe("a filling room draws its seats, its people and its two quiet doors", () => {
  const filling = homeCard({
    id: "l_fill_now",
    name: "Fourth and Long",
    teamCount: 12,
    filledTeams: 1,
    draftStatus: "scheduled",
    startTrigger: "scheduled",
    // A kickoff already in the past: the room rolled rather than drafting.
    kickoffAt: "2026-09-01T00:00:00.000Z",
    kickoffRelative: "starting now",
    slotsRanked: true,
    record: null,
    myRank: null,
    members: [{ userId: "u1", name: "Justin Hunthrop", avatar: null, isSelf: true }],
  });

  it("says the seats, never the abandoned clock, and draws the empty seats as rings", () => {
    renderInLeague(<HomeBoard initial={body([filling])} />, fixtureLeagueDeps().deps);
    expect(screen.getByText("Filling, 1 of 12. Drafts when full.")).toBeInTheDocument();
    expect(screen.queryByText(/Starting now/)).toBeNull();
    expect(screen.getByTestId("big-number")).toHaveTextContent("11seats to go, of 12");
    // Three hollow rings after the one face, and the chip counting the other eight seats.
    expect(screen.getAllByTestId("open-seat")).toHaveLength(3);
    expect(screen.getByTestId("manager-stack")).toHaveTextContent("+8");
  });

  it("wears the manager's initials in the ring, not a glyph and not a stock image", () => {
    const { container } = renderInLeague(<HomeBoard initial={body([filling])} />, fixtureLeagueDeps().deps);
    const stack = container.querySelector("[data-testid='manager-stack']")!;
    expect(stack.querySelector("img")).toBeNull();
    expect(stack).toHaveTextContent("JH");
  });

  it("carries the door the verb did not take while a seat is open", () => {
    // This room owes nothing, so "Run a mock draft" IS the verb and only the other door stays a
    // link — exactly the pairing the mock draws on its own filling card.
    renderInLeague(<HomeBoard initial={body([filling])} />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("link", { name: `Run a mock draft for ${filling.name}` })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Run a mock draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "Preview the room" })).toBeInTheDocument();
  });

  it("keeps the mock-draft door as a quiet link when the verb is something else", () => {
    const owed = { ...filling, slotsRanked: false };
    renderInLeague(<HomeBoard initial={body([owed])} />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("link", { name: "Run a mock draft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview the room" })).toBeInTheDocument();
  });

  it("carries neither door once the room is full, which is where the mock draws neither", () => {
    const fullAhead = { ...filling, filledTeams: 12, kickoffRelative: "in 2 days", kickoffAt: "2026-09-15T01:55:00.000Z" };
    renderInLeague(<HomeBoard initial={body([fullAhead])} />, fixtureLeagueDeps().deps);
    expect(screen.queryByRole("link", { name: "Run a mock draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview the room" })).toBeNull();
    // What a full, dated room says instead: its day. WHICH day is the reader's own (H3 resolves
    // the zone after mount), so the shape is what this asserts and `home-card.test.ts` pins the
    // two-zone arithmetic.
    expect(screen.getByText(/^Drafts [A-Za-z]+\.$/)).toBeInTheDocument();
  });
});

/**
 * ONE CREATE DOOR PER PAGE (founder ruling, fix round 3). The page showed "Create a league" twice,
 * beside its own heading and again beside "Open rooms". The lobby's heading owns it whenever the
 * lobby renders; the page's heading takes it only when there is no lobby at all. The literal
 * `#create-league` anchor rides whichever one renders, so the four links that point at it
 * (`/browse`, the lobby's empty state, the league rail's `+`, the create sheet's signed-out
 * intent) always land, and `link-integrity.source.test.ts` stays green either way.
 */
describe("the create door renders exactly once, wherever it belongs", () => {
  const doors = (container: HTMLElement) => container.querySelectorAll("#create-league");

  it("gives it to the lobby's heading, and to nothing else, when the lobby renders", () => {
    const { container } = renderInLeague(
      <HomeBoard initial={body([homeCard()])} openLeagues={PUBLIC_LEAGUES} />,
      fixtureLeagueDeps().deps,
    );
    expect(doors(container)).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Create a league" })).toHaveLength(1);
    // Inside the lobby, not beside the page title.
    expect(screen.getByTestId("open-rooms").querySelector("#create-league")).not.toBeNull();
  });

  it("gives it to the page's heading when the house shelf is empty", () => {
    const { container } = renderInLeague(<HomeBoard initial={body([homeCard()])} openLeagues={[]} />, fixtureLeagueDeps().deps);
    expect(container.querySelector("[data-testid='open-rooms']")).toBeNull();
    expect(doors(container)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Create a league" })).toBeInTheDocument();
  });

  it("gives it to the page's heading when every open room is one this manager already joined", () => {
    const mine = homeCard({ id: PUBLIC_LEAGUES[0]!.id, name: PUBLIC_LEAGUES[0]!.name });
    const { container } = renderInLeague(
      <HomeBoard initial={body([mine])} openLeagues={[PUBLIC_LEAGUES[0]!]} />,
      fixtureLeagueDeps().deps,
    );
    expect(container.querySelector("[data-testid='open-rooms']")).toBeNull();
    expect(doors(container)).toHaveLength(1);
  });

  it("keeps it quiet in both places, so it never competes with the page's one solid verb", () => {
    for (const open of [PUBLIC_LEAGUES, []]) {
      const view = renderInLeague(<HomeBoard initial={body([homeCard()])} openLeagues={open} />, fixtureLeagueDeps().deps);
      expect(view.container.querySelector("#create-league")?.className).not.toContain("shadow-verb-glow");
      view.unmount();
    }
  });

  it("renders the page's own heading whichever door is showing", () => {
    for (const open of [PUBLIC_LEAGUES, []]) {
      const view = renderInLeague(<HomeBoard initial={body([homeCard()])} openLeagues={open} />, fixtureLeagueDeps().deps);
      expect(view.getByRole("heading", { level: 1, name: "Your leagues" })).toBeInTheDocument();
      view.unmount();
    }
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
