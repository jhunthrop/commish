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
      expect(within(getAllByRole("row")[1]!).getAllByText("Fix your lineup").length).toBe(2);
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
    await renderSurface(<LeagueBoard leagues={[ORDINARY]} />, ({ getByText, getAllByRole }) => {
      expect(getByText("5-2")).toBeInTheDocument();
      expect(getAllByRole("link", { name: /Watch the scores for/ }).length).toBe(2);
    });
  });

  // Persona panel, Step 5 (the phone user): below `sm` the board is TWO columns, and the score
  // cell carries the opponent, the state and the verb underneath the manager's own number.
  it("folds the opponent, the state and the verb under the score at 360px", async () => {
    await renderSurface(<LeagueBoard leagues={live} />, ({ getByText, getByRole }) => {
      expect(getByRole("columnheader", { name: /^Your score/ }).className).not.toMatch(/hidden/);
      for (const dropped of ["Opponent", "Margin", "State", "Action"]) {
        expect(getByRole("columnheader", { name: dropped }).className).toMatch(/hidden/);
      }
      // The dropped opponent, state and VERB, folded into the score cell for the narrow viewport
      // rather than pushed off the edge of a phone. A verb a manager cannot see on a Sunday is
      // not an obvious verb, whatever law 5 says about the desktop.
      const narrow = getByText("vs Comet Crew 108.00").closest("div");
      expect(narrow?.className).toMatch(/sm:hidden/);
      expect(within(narrow!).getByText("Live")).toBeInTheDocument();
      expect(within(narrow!).getByRole("link", { name: /Watch the scores for/ })).toBeInTheDocument();
    });
  });

  /**
   * LAW 5, THE VERB IS OBVIOUS. This board's action was a quiet outline on every row under v3
   * rule 5's one-ink-per-view count, which Gameday reverses by name for exactly this shape of
   * surface. `verb` is the money-filled variant, so `page-audit.spec.ts`'s ink count (which walks
   * `bg-text-primary`) still sees zero competing ink pills here.
   */
  it("gives every row the money-filled verb, not a quiet outline", async () => {
    await renderSurface(<LeagueBoard leagues={mixed} />, ({ getAllByRole }) => {
      // Two rows, each rendering its verb twice — the wide cell and the narrow fold-in, exactly
      // one of which is displayed at any width.
      const actions = getAllByRole("link", { name: /^(Fix your lineup|Watch the scores) for/ });
      expect(actions.length).toBe(4);
      for (const action of actions) {
        expect(action.className).toMatch(/bg-accent/);
        expect(action.className).not.toMatch(/bg-text-primary/);
      }
    });
  });

  /** LAW 2, THE NUMBER IS THE HERO: the manager's own score is the largest thing on its row, and
   *  the opponent's sits one step down the same scale. A board that set both at body size inside a
   *  sentence was most of "I don't see any changes". */
  it("sets the manager's own score above the opponent's on the display scale", async () => {
    await renderSurface(<LeagueBoard leagues={live} />, ({ getByText }) => {
      expect(getByText("112.52").className).toMatch(/text-display-md/);
      expect(getByText("108.00").className).toMatch(/text-display-sm/);
    });
  });

  /** A team with no score yet reads as the dash, never as a zero — the same rule
   *  `NOT_STARTED_DASH` states for a player who has not played. */
  it("prints a not-yet-scored side as the dash rather than a zero", async () => {
    const unscored: readonly HomeLeagueCard[] = [
      {
        ...BASE,
        id: "l_unscored",
        myTeamId: "home_team",
        matchup: {
          weekNumber: 4,
          homeTeamId: "home_team",
          awayTeamId: "away_team",
          homeTeamName: "Iron Owls",
          awayTeamName: "Comet Crew",
          homeScore: null,
          awayScore: null,
          final: false,
          weekStatus: "scheduled",
        },
        nextAction: null,
      },
    ];
    await renderSurface(<LeagueBoard leagues={unscored} />, ({ getAllByText, queryByText }) => {
      expect(getAllByText("—").length).toBeGreaterThan(0);
      expect(queryByText("0.00")).toBeNull();
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
  // text, no `data-theme` branch anywhere in `Badge`/the share bar/this board (verified: none
  // reads theme at all), so the two themes were never rendering anything different on purpose.
  // The fix removes the wrap outright rather than chasing a per-theme pixel budget; this asserts
  // the structural property that let the two themes diverge — the nowrap class on the badge and
  // on the figure beside the bar — holds identically in BOTH themes, so a future change that
  // reintroduces a theme-only text style cannot silently reopen the gap. Gameday swapped `Meter`
  // for `PointsShareBar` here, which keeps the same contract: the name truncates, the number
  // never wraps.
  it("never lets the State badge or the share figure wrap, in either theme (LED-11)", async () => {
    await renderSurface(<LeagueBoard leagues={[ORDINARY]} />, ({ getAllByText }) => {
      expect(getAllByText("Watch the scores").length).toBe(2);
      expect(getAllByText("Live")[0]!.className).toMatch(/whitespace-nowrap/);
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
      expect(getByText("67%").className).toMatch(/whitespace-nowrap/);
      expect(getByText("33%").className).toMatch(/whitespace-nowrap/);
    });
  });

  /**
   * LAW 4, DENSITY IS RESPECT — which is about true FACTS per screen, not marks per screen. Seven
   * identical "Week 14" labels down a column is one fact printed seven times, the same texture the
   * draft room's board tallies were refused for. It is stated once in the column head when the
   * board agrees with itself, and per row only when it does not.
   */
  it("states the week once when every league is in the same one, and per row when they differ", async () => {
    await renderSurface(<LeagueBoard leagues={mixed} />, ({ getByRole, queryAllByText }) => {
      expect(getByRole("columnheader", { name: "Your score · Week 4" })).toBeInTheDocument();
      expect(queryAllByText("Week 4").length).toBe(0);
    });
    const twoWeeks: readonly HomeLeagueCard[] = [ORDINARY, { ...NEEDS_FIX, weekNumber: 9 }];
    await renderSurface(<LeagueBoard leagues={twoWeeks} />, ({ getByRole, getByText }) => {
      expect(getByRole("columnheader", { name: "Your score" })).toBeInTheDocument();
      expect(getByText("Week 4")).toBeInTheDocument();
      expect(getByText("Week 9")).toBeInTheDocument();
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
