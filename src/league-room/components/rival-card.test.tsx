import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { HOME, MATCHUP, ROOM_DATA } from "../test-fixtures";
import { RivalCard } from "./rival-card";

describe("RivalCard", () => {
  it("puts you and your opponent at the top with faces, names, team names and the final score with its basis (P6), in both themes, axe-clean", async () => {
    await renderSurface(
      <RivalCard home={HOME} week={ROOM_DATA.week} myMatchupDetail={MATCHUP} projectionsByPlayerId={new Map()} regularSeasonWeeks={14} />,
      async ({ container }) => {
        expect(screen.getByRole("region", { name: "Your game this week" })).toBeInTheDocument();
        const [me, rival] = screen.getAllByTestId("manager");
        expect(me).toHaveTextContent("Alex Rivera");
        expect(me).toHaveTextContent("Bay Bandits");
        expect(me!.firstElementChild!.className).toContain("ring-self");
        expect(rival).toHaveTextContent("Jordan Lee");
        expect(rival!.firstElementChild!.className).toContain("ring-negative");
        expect(screen.getByText("112.50")).toBeInTheDocument();
        expect(screen.getAllByText("week 5, final")).toHaveLength(2);
        expect(screen.getByRole("link", { name: "Open the matchup" })).toHaveAttribute("href", "/app/leagues/l1/matchups/5");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("says plainly when you have no game this week, from the league's own week", () => {
    render(<RivalCard home={HOME} week={ROOM_DATA.week} myMatchupDetail={null} projectionsByPlayerId={new Map()} regularSeasonWeeks={14} />);
    expect(screen.getByText("No game for you in week 3.")).toBeInTheDocument();
    expect(screen.queryByTestId("manager")).toBeNull();
  });

  it("says the schedule is not set yet when there is no week at all", () => {
    render(<RivalCard home={HOME} week={null} myMatchupDetail={null} projectionsByPlayerId={new Map()} regularSeasonWeeks={14} />);
    expect(screen.getByText("No schedule yet for week 3.")).toBeInTheDocument();
  });

  it("names the champion once the season is over", () => {
    const finalWeek = { ...ROOM_DATA.week!, weekNumber: 14, totalWeeks: 14, matchups: [{ ...MATCHUP, weekNumber: 14 }] };
    render(<RivalCard home={HOME} week={finalWeek} myMatchupDetail={null} projectionsByPlayerId={new Map()} regularSeasonWeeks={13} />);
    expect(screen.getByText("The season is over. Bay Bandits won it.")).toBeInTheDocument();
  });
});
