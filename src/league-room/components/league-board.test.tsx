import { describe, it, expect } from "vitest";
import { within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { HomeLeagueCard } from "../contract";
import { LeagueBoard } from "./league-board";

const BASE: HomeLeagueCard = {
  id: "l1",
  name: "Sunday Money",
  format: "snake",
  teamCount: 10,
  filledTeams: 10,
  isCommissioner: false,
  myTeamId: "t1",
  draftId: "d1",
  draftStatus: "complete",
  record: { wins: 5, losses: 2, ties: 0 },
  weekNumber: 4,
  weekStatus: "in_progress",
  matchup: null,
  nextAction: null,
  lineupSet: true,
  medianGame: false,
  medianScore: null,
  kickoffAt: null,
  startTrigger: null,
  kickoffRolls: 0,
  myTeamName: "Bay Bandits Team",
};

const NEEDS_FIX: HomeLeagueCard = {
  ...BASE,
  id: "l_fix",
  name: "Bay Bandits League",
  weekStatus: "scheduled",
  matchup: null,
  nextAction: { kind: "fix-lineup", label: "Fix your lineup" },
  lineupSet: false,
};

const ORDINARY: HomeLeagueCard = {
  ...BASE,
  id: "l_ordinary",
  name: "Auction Night",
  matchup: null,
  nextAction: { kind: "watch-scores", label: "Watch the scores" },
};

const mixed: readonly HomeLeagueCard[] = [ORDINARY, NEEDS_FIX];

const live: readonly HomeLeagueCard[] = [
  {
    ...BASE,
    id: "l_live",
    name: "Live League",
    myTeamId: "home_team",
    matchup: {
      weekNumber: 4,
      homeTeamId: "home_team",
      awayTeamId: "away_team",
      homeTeamName: "Iron Owls",
      awayTeamName: "Comet Crew",
      homeScore: 112.52,
      awayScore: 108.0,
      final: false,
      weekStatus: "in_progress",
    },
    nextAction: { kind: "watch-scores", label: "Watch the scores" },
  },
];

const medianLeague: readonly HomeLeagueCard[] = [
  {
    ...BASE,
    id: "l_median",
    name: "Median League",
    medianGame: true,
    medianScore: 121.4,
    matchup: {
      weekNumber: 4,
      homeTeamId: "t1",
      awayTeamId: "t2",
      homeTeamName: "Bay Bandits",
      awayTeamName: "Iron Owls",
      homeScore: 130,
      awayScore: 110,
      final: false,
      weekStatus: "in_progress",
    },
    nextAction: { kind: "watch-scores", label: "Watch the scores" },
  },
];

describe("LeagueBoard", () => {
  it("puts the league that needs the manager first, and says why in words", async () => {
    await renderSurface(<LeagueBoard leagues={mixed} />, ({ getAllByRole }) => {
      expect(within(getAllByRole("row")[1]!).getByText("Fix your lineup")).toBeInTheDocument();
    });
  });

  it("renders no win probability anywhere, because there is no model behind one", async () => {
    await renderSurface(<LeagueBoard leagues={live} />, ({ queryByText }) => {
      expect(queryByText(/win prob/i)).toBeNull();
    });
  });

  it("shows the margin, which is a subtraction this product can actually do", async () => {
    await renderSurface(<LeagueBoard leagues={live} />, ({ getByText }) => {
      expect(getByText("+4.52")).toBeInTheDocument();
    });
  });

  it("renders a median league's second result as a median, not as an opponent", async () => {
    await renderSurface(<LeagueBoard leagues={medianLeague} />, ({ getByText }) => {
      expect(getByText("League median 121.4")).toBeInTheDocument();
    });
  });

  it("renders the crest, record, action and state for an ordinary row", async () => {
    await renderSurface(<LeagueBoard leagues={[ORDINARY]} />, ({ getByText, getByRole }) => {
      expect(getByText("5-2")).toBeInTheDocument();
      expect(getByRole("link", { name: /Watch the scores/ })).toBeInTheDocument();
    });
  });

  // Persona panel, Step 5 (the phone user): the state badge stays intact at 360px — only the
  // margin, a supplementary detail, drops below `sm`.
  it("keeps the state badge visible at 360px, and only hides the supplementary margin column", async () => {
    await renderSurface(<LeagueBoard leagues={[ORDINARY]} />, ({ getByText }) => {
      expect(getByText("Live").closest("td")?.className).not.toMatch(/hidden/);
      expect(getByText("State").className).not.toMatch(/hidden/);
      expect(getByText("Margin").className).toMatch(/hidden/);
    });
  });

  it("renders no action cell for a league with nothing pending", async () => {
    await renderSurface(<LeagueBoard leagues={[{ ...BASE, nextAction: null }]} />, ({ queryByRole }) => {
      expect(queryByRole("link", { name: /for Sunday Money/ })).toBeNull();
    });
  });

  // LED-11 (persona gauntlet): the gauntlet's own screenshots showed "NOT STARTED" (the State
  // badge) and a Margin figure ("114.06 of 252.48") wrapping onto a second line in the light
  // theme's render of this exact table while sitting on one line in dark's — same markup, same
  // text, no `data-theme` branch anywhere in `Badge`/`Meter`/this board (verified: neither reads
  // theme at all), so the two themes were never rendering anything different on purpose. The fix
  // (`Badge`/`Meter`, both now `whitespace-nowrap`) removes the wrap outright rather than
  // chasing a per-theme pixel budget; this asserts the structural property that let the two
  // themes diverge — the nowrap class on the badge and on the meter's own value text — holds
  // identically in BOTH themes, so a future change that reintroduces a theme-only text style
  // cannot silently reopen the gap.
  it("never lets the State badge or the Margin figure wrap, in either theme (LED-11)", async () => {
    await renderSurface(<LeagueBoard leagues={[ORDINARY]} />, ({ getByText }) => {
      expect(getByText("Watch the scores")).toBeInTheDocument();
      expect(getByText("Live").className).toMatch(/whitespace-nowrap/);
    });
    const wideMargin: readonly HomeLeagueCard[] = [
      {
        ...BASE,
        id: "l_wide_margin",
        name: "Wide Margin League",
        myTeamId: "home_team",
        matchup: {
          weekNumber: 4,
          homeTeamId: "home_team",
          awayTeamId: "away_team",
          homeTeamName: "Iron Owls",
          awayTeamName: "Comet Crew",
          homeScore: 100,
          awayScore: 50,
          final: false,
          weekStatus: "in_progress",
        },
        nextAction: { kind: "watch-scores", label: "Watch the scores" },
      },
    ];
    await renderSurface(<LeagueBoard leagues={wideMargin} />, ({ getByText }) => {
      expect(getByText("100 of 150").className).toMatch(/whitespace-nowrap/);
    });
  });

  it("stays axe-clean with a mixed board, in both themes", async () => {
    await renderSurface(<LeagueBoard leagues={[...mixed, ...live, ...medianLeague]} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
  /**
   * THE FUN PASS REACHES THE FIRST SCREEN (2026-08-28). This page was excluded from every phase
   * of the pass — Task 11 covered a single league's home, not the leagues INDEX — so the screen a
   * signed-in manager actually lands on kept its margin at label size in muted ink, saying
   * nothing about whether it was a good Sunday. That absence was most of "I don't see any
   * changes".
   *
   * The population is this board's own margins: the only pool the page holds, and the one a
   * manager compares in their head anyway. It REFUSES below `heatMinPopulation` rather than
   * ranking a number against two others, and that refusal is the half worth pinning — a tint that
   * cannot be true does not appear.
   */
  it("colours the margin against the board's own leagues, and refuses when the pool is too small", async () => {
    const scored = (id: string, mine: number, theirs: number): HomeLeagueCard => ({
      ...BASE,
      id,
      name: `League ${id}`,
      myTeamId: "home_team",
      matchup: {
        weekNumber: 4,
        homeTeamId: "home_team",
        awayTeamId: "away_team",
        homeTeamName: "Mine",
        awayTeamName: "Theirs",
        homeScore: mine,
        awayScore: theirs,
        final: false,
        weekStatus: "in_progress",
      },
      nextAction: { kind: "watch-scores", label: "Watch the scores" },
    });

    // Two scored leagues sits below the floor: plain ink, no percentile invented from a pair.
    await renderSurface(<LeagueBoard leagues={[scored("a", 120, 100), scored("b", 90, 110)]} />, ({ container }) => {
      for (const node of container.querySelectorAll("[data-magnitude]")) {
        expect(node.getAttribute("data-magnitude")).toBe("neutral");
      }
    });

    // Four clears it, and the best margin on the board must not read the same as the worst.
    await renderSurface(
      <LeagueBoard leagues={[scored("a", 140, 90), scored("b", 120, 100), scored("c", 100, 110), scored("d", 80, 130)]} />,
      ({ container }) => {
        const steps = [...container.querySelectorAll("[data-magnitude]")].map((n) => n.getAttribute("data-magnitude"));
        expect(new Set(steps).size).toBeGreaterThan(1);
      },
    );
  });
});
