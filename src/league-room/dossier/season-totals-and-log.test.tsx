import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { Player } from "@research-ts/domain/player";
import type { PlayerSeasonBody } from "@/league-service/player";
import { SeasonTotalsAndLog } from "./season-totals-and-log";

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
    log: [{ week: 1, points: 12.5, carries: 15, rushingYards: 80, targets: 3, receptions: 2, receivingYards: 20, passingYards: 0, touchdowns: 1 }],
    totals: { games: 1, carries: 15, rushingYards: 80, targets: 3, receptions: 2, receivingYards: 20, passingYards: 0, touchdowns: 1, fantasyPoints: 12.5 },
    kdefSeason: null,
    news: [],
    reasons: [],
    laws: [],
    ...overrides,
  };
}

describe("SeasonTotalsAndLog", () => {
  it("names the league-scoring basis on both the totals and the game log headers", () => {
    render(<SeasonTotalsAndLog body={bodyFor()} />);
    expect(screen.getByText("2026 totals · under this league's scoring")).toBeInTheDocument();
    expect(screen.getByText("2026 game log · under this league's scoring")).toBeInTheDocument();
  });

  it("prints a dash for carries/targets a prior season's store cannot honestly fill, never a fabricated zero", () => {
    render(<SeasonTotalsAndLog body={bodyFor({ totals: { games: 1, carries: null, rushingYards: 80, targets: null, receptions: 2, receivingYards: 20, passingYards: 0, touchdowns: 1, fantasyPoints: 12.5 } })} />);
    const totalsSection = screen.getByText("2026 totals · under this league's scoring").closest("div")!;
    expect(totalsSection.textContent).toContain("Carries");
  });

  it("renders neither section when there is nothing to show", () => {
    const { container } = render(<SeasonTotalsAndLog body={bodyFor({ totals: null, log: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<SeasonTotalsAndLog body={bodyFor()} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
