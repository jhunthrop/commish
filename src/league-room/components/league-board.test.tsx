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
      expect(getByText("In progress").closest("td")?.className).not.toMatch(/hidden/);
      expect(getByText("State").className).not.toMatch(/hidden/);
      expect(getByText("Margin").className).toMatch(/hidden/);
    });
  });

  it("renders no action cell for a league with nothing pending", async () => {
    await renderSurface(<LeagueBoard leagues={[{ ...BASE, nextAction: null }]} />, ({ queryByRole }) => {
      expect(queryByRole("link", { name: /for Sunday Money/ })).toBeNull();
    });
  });

  it("stays axe-clean with a mixed board, in both themes", async () => {
    await renderSurface(<LeagueBoard leagues={[...mixed, ...live, ...medianLeague]} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
