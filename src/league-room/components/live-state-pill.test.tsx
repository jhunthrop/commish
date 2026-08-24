import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { LiveStatePill } from "./live-state-pill";

describe("LiveStatePill", () => {
  it("renders the real weekday and game count, in both themes, axe-clean", async () => {
    await renderSurface(<LiveStatePill liveState={{ weekday: "Sunday", gamesLive: 7 }} />, async ({ container }) => {
      expect(screen.getByText("Sunday · 7 games live")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("pluralizes a single live game correctly", () => {
    render(<LiveStatePill liveState={{ weekday: "Monday", gamesLive: 1 }} />);
    expect(screen.getByText("Monday · 1 game live")).toBeInTheDocument();
  });

  // Ruling 12: nothing live means no pill — off-season, mid-week and pre-kickoff all reach this
  // component as `null`, never as a state it renders text for.
  it("renders nothing at all when nothing is live", () => {
    const { container } = render(<LiveStatePill liveState={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
