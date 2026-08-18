import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { inBothThemes } from "@/components/ui/test-utils";
import { SNAKE_VIEW, TEAMS } from "../test-fixtures";
import { ClockBanner } from "./clock-banner";

/**
 * Deadlines are built relative to the real clock rather than with fake timers: `useNow` reads
 * `Date.now()` once on mount, and `formatCountdown` rounds up, so a 125-second gap renders
 * "2:05" for any elapsed time under a second. Fake timers are avoided here on purpose — axe
 * runs async and deadlocks against them.
 */
function liveView(over: Partial<DraftStateView> = {}): DraftStateView {
  return {
    ...SNAKE_VIEW,
    deadlineAt: new Date(Date.now() + 125_000).toISOString(),
    // 134.5 minutes out, so the floor-to-minutes gap reads "2h 14m" with room to spare.
    nextTightening: { at: new Date(Date.now() + 134 * 60_000 + 30_000).toISOString(), pickSeconds: 600 },
    ...over,
  };
}

const finished: Partial<DraftStateView> = { onClockTeamId: null, deadlineAt: null, clockSeconds: null, nextTightening: null };

describe("ClockBanner", () => {
  it("names who is on the clock, counts down, and says when the clock tightens — both themes, axe-clean", async () => {
    await inBothThemes(<ClockBanner view={liveView()} teams={TEAMS} myTeamId="t2" />, async ({ container }) => {
      expect(screen.getByText("On the clock")).toBeInTheDocument();
      expect(screen.getByTestId("countdown")).toHaveTextContent("2:05");
      expect(screen.getByText("Picks shorten to 10 minutes in 2h 14m")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("hides the ticking digits from assistive tech and states the clock in words instead", () => {
    render(<ClockBanner view={liveView()} teams={TEAMS} myTeamId="t2" />);
    expect(screen.getByTestId("countdown")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Bay Bandits is on the clock. This round's pick clock is 8 hours.")).toBeInTheDocument();
  });

  it("says it is your turn when it is", () => {
    render(<ClockBanner view={liveView()} teams={TEAMS} myTeamId="t1" />);
    expect(screen.getByText("You're on the clock")).toBeInTheDocument();
  });

  it("explains a draft that has not started and one that has finished", () => {
    const { rerender } = render(<ClockBanner view={{ ...SNAKE_VIEW, phase: "scheduled", ...finished }} teams={TEAMS} myTeamId="t1" />);
    expect(screen.getByText("This draft hasn't started yet.")).toBeInTheDocument();
    rerender(<ClockBanner view={{ ...SNAKE_VIEW, phase: "complete", ...finished }} teams={TEAMS} myTeamId="t1" />);
    expect(screen.getByText("This draft is complete.")).toBeInTheDocument();
  });
});
