import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { Player } from "@/domain/player";
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
});
