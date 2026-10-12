import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { Player } from "@research/domain/player";
import type { PlayerSeasonBody } from "@/league-service/player";
import { SeasonChartFallback } from "./season-chart-fallback";

const PLAYER: Player = { id: "rb1", name: "Rashad Long", position: "RB", nflTeam: "SF", headshotUrl: null, adp: 2.5 };

function bodyFor(overrides: Partial<PlayerSeasonBody> = {}): PlayerSeasonBody {
  return {
    player: PLAYER,
    availableSeasons: [2026],
    season: 2026,
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
    ...overrides,
  };
}

describe("SeasonChartFallback", () => {
  it("draws the season chart when a week has been played", () => {
    render(<SeasonChartFallback body={bodyFor()} switcher={undefined} played />);
    expect(screen.getByText("2026 season")).toBeInTheDocument();
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("states the honest rookie sentence for a confirmed rookie", () => {
    render(<SeasonChartFallback body={bodyFor({ isRookie: true, availableSeasons: [] })} switcher={undefined} played={false} />);
    expect(screen.getByText("His first NFL season.")).toBeInTheDocument();
  });

  it("states the honest no-record sentence for a placed veteran with nothing on file", () => {
    render(<SeasonChartFallback body={bodyFor({ isRookie: false, availableSeasons: [] })} switcher={undefined} played={false} />);
    expect(screen.getByText("No prior seasons on record.")).toBeInTheDocument();
  });

  it("states no scored week when the season exists but nothing has been played yet", () => {
    render(<SeasonChartFallback body={bodyFor({ weeks: [] })} switcher={undefined} played={false} />);
    expect(screen.getByText("No scored week for him in the 2026 season.")).toBeInTheDocument();
  });

  it("mounts the switcher slot when supplied", () => {
    render(<SeasonChartFallback body={bodyFor()} switcher={<button type="button">2025</button>} played />);
    expect(screen.getByRole("button", { name: "2025" })).toBeInTheDocument();
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<SeasonChartFallback body={bodyFor()} switcher={undefined} played />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  /**
   * A KICKER'S CHART NAMES ITS BASIS (the 2026-09-06 round). His bars come out of the kicking
   * archive rather than out of this league's live table, and the whole reason they can be drawn is
   * that they are a record of games that were played. A reader who is not told that will supply an
   * answer, and the wrong one is "this is what the model expects".
   */
  it("names the basis under a kicker's or a team defense's chart", () => {
    render(
      <SeasonChartFallback
        body={bodyFor({
          player: { id: "k1", name: "A Kicker", position: "K", nflTeam: "BAL", headshotUrl: null, adp: 140.2 },
          season: 2025,
          availableSeasons: [2025],
          weeks: [{ week: 1, points: 11, percentile: null }],
          kdefSeason: { playerId: "k1", position: "K", season: 2025, weeks: [], points: 148.5, games: 16, pointsPerGame: 9.3, weeksMissingPointsAllowed: 0, facts: { kind: "K", fieldGoalsMade: 24, fieldGoalsAttempted: 28, extraPointsMade: 38, extraPointsAttempted: 40, distanceBands: [], longestMadeBand: null } },
        })}
        switcher={undefined}
        played
      />,
    );
    const basis = screen.getByTestId("season-basis");
    // The line every chart carries, plus the one sentence only these two positions earn: their bars
    // are a record of games that were played, never a forecast.
    expect(basis.textContent).toContain("Week by week, 2025, this league's scoring");
    expect(basis.textContent).toContain("A record of games that were played, not a forecast.");
    expect(basis.textContent).not.toMatch(/[—;]/);
  });

  /**
   * THE BASIS LINE RENDERS UNCONDITIONALLY (fix round 1, M1). It used to print only for a kicker or
   * a team defense, so on every other player the chart's bars were a number with no stated basis
   * anywhere a sighted reader could see it — and the call card two inches above says "our model
   * expects 15" GAMES, which is exactly what a lone 15.0 bar gets read as. The line names what a bar
   * IS: one week, in fantasy points, under this league's rules.
   */
  it("names what a bar is under every chart, not only a kicker's", () => {
    render(<SeasonChartFallback body={bodyFor()} switcher={undefined} played />);
    const basis = screen.getByTestId("season-basis");
    expect(basis.textContent).toBe("Week by week, 2026, this league's scoring");
    expect(basis.textContent).not.toMatch(/[—;]/);
  });

  it("prints no basis line where there is no chart to state a basis for", () => {
    render(<SeasonChartFallback body={bodyFor({ weeks: [] })} switcher={undefined} played={false} />);
    expect(screen.queryByTestId("season-basis")).not.toBeInTheDocument();
  });
});
