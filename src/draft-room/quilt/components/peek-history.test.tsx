import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlayerHistoryBody } from "../../contract";
import { QUILT_CONFIG } from "../state/config";
import { PeekHistory } from "./peek-history";

const BODY: PlayerHistoryBody = {
  seasons: [
    { season: 2025, gamesPlayed: 16, pointsPerGame: 17.2, totalYards: 1842, totalTouchdowns: 14, positionFinish: "RB3" },
    { season: 2024, gamesPlayed: 17, pointsPerGame: 18.6, totalYards: 1929, totalTouchdowns: 20, positionFinish: "RB1" },
  ],
  latestWeeklySeason: 2025,
  latestWeekly: [
    { week: 1, points: 21.4 },
    { week: 2, points: 4.1 },
    { week: 3, points: QUILT_CONFIG.weeklyGoodPoints },
  ],
};

describe("PeekHistory", () => {
  it("renders the stored seasons and the consistency strip, with the honest over-bar caption", () => {
    render(<PeekHistory state={{ status: "ready", body: BODY }} position="RB" />);
    const section = screen.getByTestId("peek-history");
    expect(section).toHaveTextContent("Last 2 seasons");
    expect(section).toHaveTextContent("RB3");
    expect(section).toHaveTextContent("1,842");
    // Weeks 1 and 3 clear the bar; week 2 does not.
    expect(section).toHaveTextContent(`2 of 3 weeks over ${QUILT_CONFIG.weeklyGoodPoints} pts`);
    expect(screen.getByTestId("peek-weekly-bars").children).toHaveLength(3);
  });

  it("a single stored season says so in the singular, never padded to three", () => {
    const body: PlayerHistoryBody = { ...BODY, seasons: [BODY.seasons[0]!] };
    render(<PeekHistory state={{ status: "ready", body }} position="RB" />);
    expect(screen.getByTestId("peek-history")).toHaveTextContent("Last season");
  });

  it("renders NOTHING for a rookie: no rows, no placeholders, no section", () => {
    const empty: PlayerHistoryBody = { seasons: [], latestWeeklySeason: null, latestWeekly: [] };
    const { container } = render(<PeekHistory state={{ status: "ready", body: empty }} position="RB" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a failed or not-yet-asked fetch, and a quiet skeleton while loading", () => {
    const { container, rerender } = render(<PeekHistory state={{ status: "absent" }} position="RB" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PeekHistory state={{ status: "loading" }} position="RB" />);
    expect(screen.getByTestId("peek-history-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("peek-history")).toBeNull();
  });

  it("omits the weekly strip when the latest season carries no stored weeks", () => {
    const body: PlayerHistoryBody = { ...BODY, latestWeeklySeason: null, latestWeekly: [] };
    render(<PeekHistory state={{ status: "ready", body }} position="RB" />);
    expect(screen.getByTestId("peek-history")).toBeInTheDocument();
    expect(screen.queryByTestId("peek-weekly-bars")).toBeNull();
  });
});
