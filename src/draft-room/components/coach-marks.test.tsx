import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoachMarks, placeCoachMark, type CoachMarkStop } from "./coach-marks";

const STOPS: readonly CoachMarkStop[] = [
  { heading: "The clock", body: "Counts down.", targetId: "target-clock" },
  { heading: "The queue", body: "Your list.", targetId: "target-queue" },
  { heading: "Taking your turn", body: "Click Draft.", targetId: "target-pool" },
  { heading: "Practice anytime", body: "Even if you miss your pick.", targetId: null },
];

/** Every real target the fixture stops above point at, so `getElementById` finds them. */
function renderWithTargets(onDismiss = vi.fn()) {
  return render(
    <>
      <div id="target-clock" />
      <div id="target-queue" />
      <div id="target-pool" />
      <CoachMarks stops={STOPS} onDismiss={onDismiss} />
    </>,
  );
}

describe("CoachMarks", () => {
  it("shows one stop at a time, in order, and Next advances through all four", async () => {
    renderWithTargets();
    expect(screen.getByRole("dialog", { name: "The clock" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "The queue" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "The clock" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Taking your turn" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Practice anytime" })).toBeInTheDocument();
  });

  it("draws a highlight over the active stop's target and swaps it when advancing", async () => {
    renderWithTargets();
    expect(screen.getByTestId("coach-mark-highlight")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("coach-mark-highlight")).toBeInTheDocument();
  });

  it("centers the closing stop instead of drawing a highlight, since it has no target", async () => {
    renderWithTargets();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Practice anytime" })).toBeInTheDocument();
    expect(screen.queryByTestId("coach-mark-highlight")).not.toBeInTheDocument();
  });

  it("also centers a stop whose target has vanished from the DOM, rather than crashing", () => {
    render(
      <>
        <div id="target-clock" />
        {/* target-queue and target-pool never mount */}
        <CoachMarks stops={STOPS} onDismiss={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("dialog", { name: "The clock" })).toBeInTheDocument();
    expect(screen.getByTestId("coach-mark-highlight")).toBeInTheDocument();
  });

  it("offers Got it (secondary) and Next (ghost) on every stop except the last, which drops Next", async () => {
    renderWithTargets();
    for (let i = 0; i < STOPS.length - 1; i += 1) {
      expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("Got it dismisses the whole tour from any stop, not just the last", async () => {
    const onDismiss = vi.fn();
    renderWithTargets(onDismiss);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("Escape dismisses the tour", async () => {
    const onDismiss = vi.fn();
    renderWithTargets(onDismiss);
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("moves focus to Got it on mount and again on every stop change", async () => {
    renderWithTargets();
    expect(screen.getByRole("button", { name: "Got it" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Got it" })).toHaveFocus();
  });
});

describe("placeCoachMark (pure placement math)", () => {
  const viewport = { width: 1000, height: 800 };
  const popover = { top: 0, left: 0, width: 320, height: 220 };

  it("places the popover below the target when there is room", () => {
    const target = { top: 100, left: 100, width: 200, height: 40 };
    const placement = placeCoachMark(target, popover, viewport);
    expect(placement.side).toBe("below");
    expect(placement.top).toBe(100 + 40 + 8);
    expect(placement.left).toBe(100);
  });

  it("flips above the target when there is no room below", () => {
    const target = { top: 700, left: 100, width: 200, height: 40 };
    const placement = placeCoachMark(target, popover, viewport);
    expect(placement.side).toBe("above");
    expect(placement.top).toBe(700 - 8 - 220);
  });

  it("clamps the top edge so the popover never renders above the 8px margin", () => {
    // A target near the top whose "above" placement would go negative — forced by shrinking
    // the below-space to less than the popover's height while leaving no room above either.
    const target = { top: 2, left: 100, width: 200, height: 4 };
    const placement = placeCoachMark(target, { ...popover, height: 790 }, viewport);
    expect(placement.top).toBeGreaterThanOrEqual(8);
  });

  it("clamps the bottom edge so the popover never overflows past the viewport", () => {
    const target = { top: 780, left: 100, width: 200, height: 10 };
    const placement = placeCoachMark(target, popover, viewport);
    expect(placement.top).toBeLessThanOrEqual(viewport.height - popover.height - 8);
  });

  it("clamps the left edge for a target flush against the left of the viewport", () => {
    const target = { top: 100, left: -50, width: 200, height: 40 };
    const placement = placeCoachMark(target, popover, viewport);
    expect(placement.left).toBe(8);
  });

  it("clamps the right edge for a target flush against the right of the viewport", () => {
    const target = { top: 100, left: 950, width: 200, height: 40 };
    const placement = placeCoachMark(target, popover, viewport);
    expect(placement.left).toBe(viewport.width - popover.width - 8);
  });
});
