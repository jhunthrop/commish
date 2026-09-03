import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { HOME } from "../test-fixtures";
import { RoomWeekStrip } from "./room-week-strip";

describe("RoomWeekStrip", () => {
  it("names the league, the week, and the viewer's seat", () => {
    render(<RoomWeekStrip home={HOME} attentionCount={0} gamesLive={null} />);
    expect(screen.getByRole("heading", { name: "Sunday Money" })).toBeTruthy();
    expect(screen.getByText("Week 3")).toBeTruthy();
    // t1: rank 1, 9-4.
    expect(screen.getByText("1st of 12 · 9-4")).toBeTruthy();
  });

  it("deals the amber chip only when something needs the viewer", () => {
    const { rerender } = render(<RoomWeekStrip home={HOME} attentionCount={0} gamesLive={null} />);
    expect(screen.queryByText(/needs you/)).toBeNull();
    rerender(<RoomWeekStrip home={HOME} attentionCount={2} gamesLive={null} />);
    expect(screen.getByText("2 things need you")).toBeTruthy();
    rerender(<RoomWeekStrip home={HOME} attentionCount={1} gamesLive={null} />);
    expect(screen.getByText("1 thing needs you")).toBeTruthy();
  });

  it("shows the live pill instead of the attention chip while games run", () => {
    render(
      <RoomWeekStrip home={{ ...HOME, weekStatus: "in_progress" }} attentionCount={2} gamesLive={7} />,
    );
    expect(screen.getByText("Live · 7 games")).toBeTruthy();
    expect(screen.queryByText(/needs you/)).toBeNull();
  });

  it("says nothing personal for a viewer with no played record", () => {
    const standings = HOME.standings.map((row) =>
      row.teamId === "t1" ? { ...row, wins: 0, losses: 0, ties: 0 } : row,
    );
    render(<RoomWeekStrip home={{ ...HOME, standings }} attentionCount={0} gamesLive={null} />);
    expect(screen.queryByText(/of 12/)).toBeNull();
  });

  it("has no axe violations in either theme", async () => {
    await renderSurface(<RoomWeekStrip home={HOME} attentionCount={1} gamesLive={null} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
