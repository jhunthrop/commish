import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { DraftStateView } from "@/draft-engine";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { renderSurface } from "@/components/ui/test-utils";
import { PLAYERS, SNAKE_VIEW, playersById } from "../test-fixtures";
import type { FinaleStage } from "../hooks/use-draft-finale";
import { DraftFinaleOverlay } from "./draft-finale";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** The finished board: the caller's QB spot filled, one RB spot filled, one RB spot open. */
const COMPLETE_VIEW: DraftStateView = {
  ...SNAKE_VIEW,
  phase: "complete",
  onClockTeamId: null,
  deadlineAt: null,
  rosters: {
    t1: [
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "RB", slotIndex: 0, playerId: "rb1" },
    ],
    t2: [],
  },
};

function overlay(stage: FinaleStage, overrides: { myTeamId?: string | null; onDismiss?: () => void; onSeeDebrief?: () => void } = {}) {
  return (
    <DraftFinaleOverlay
      stage={stage}
      view={COMPLETE_VIEW}
      playersById={playersById(PLAYERS)}
      myTeamId={overrides.myTeamId === undefined ? "t1" : overrides.myTeamId}
      onDismiss={overrides.onDismiss ?? (() => {})}
      onSeeDebrief={overrides.onSeeDebrief ?? (() => {})}
    />
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DraftFinaleOverlay", () => {
  it("renders nothing at rest — idle, the quiet refetch, and a dismissed panel are all just the board", () => {
    for (const stage of ["idle", "refetching", "dismissed"] as const) {
      const { container, unmount } = render(overlay(stage));
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("plays the moment: the banner in the strip's place and the celebration, animated for a manager", () => {
    stubMatchMedia(false);
    render(overlay("moment"));
    expect(screen.getByTestId("finale-banner")).toHaveTextContent("The draft is in the books.");
    // Announced, not just painted — the same polite register its celebration sibling uses.
    expect(screen.getByTestId("finale-banner")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("finale-banner").className).toContain("animate-strip-grow");
    const celebration = screen.getByTestId("finale-celebration");
    expect(celebration).toHaveTextContent("Every pick is in.");
    expect(celebration.dataset.emphasis).toBe("self");
  });

  it("holds the moment still under reduced motion, and speaks peer for a commissioner with no team", () => {
    stubMatchMedia(true);
    render(overlay("moment", { myTeamId: null }));
    expect(screen.getByTestId("finale-banner").className).not.toContain("animate-strip-grow");
    const celebration = screen.getByTestId("finale-celebration");
    expect(celebration.className).not.toContain("animate-celebrate");
    expect(celebration.dataset.emphasis).toBe("peer");
  });

  it("shows the quiet preparing line while the visible retry cycle runs", () => {
    render(overlay("preparing"));
    expect(screen.getByTestId("finale-preparing")).toHaveTextContent("Preparing your debrief");
    // Never a spinner: no progressbar, no busy chrome — a sentence, politely announced.
    expect(screen.getByTestId("finale-preparing")).toHaveAttribute("role", "status");
  });

  it("offers the manual way into the debrief when retries exhausted", () => {
    const onSeeDebrief = vi.fn();
    render(overlay("manual", { onSeeDebrief }));
    screen.getByRole("button", { name: "See your debrief" }).click();
    expect(onSeeDebrief).toHaveBeenCalledTimes(1);
  });

  it("lands the real-draft panel: the sentence, the filled roster only, one ink verb home, a quiet dismiss — both themes, axe-clean", async () => {
    stubMatchMedia(false);
    const onDismiss = vi.fn();
    await renderSurface(overlay("panel", { onDismiss }), async ({ container }) => {
      // The shared Modal primitive, not a hand-rolled scrim: a real dialog, named by the sentence.
      expect(screen.getByRole("dialog", { name: "The draft is in the books." })).toBeInTheDocument();
      // Two picks made, one RB spot still open: exactly two rows, never a dashed empty one.
      const rows = screen.getAllByTestId("finale-roster-row");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("Jalen Croft");
      expect(rows[1]).toHaveTextContent("Marcus Reed");
      expect(screen.getByRole("link", { name: "Open your league room" })).toHaveAttribute("href", "/app/leagues/l1");
      screen.getByRole("button", { name: "Stay on the board" }).click();
      expect(await axe(container)).toHaveNoViolations();
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("takes focus into the panel on open and dismisses on Escape, exactly like Stay on the board", () => {
    stubMatchMedia(false);
    const onDismiss = vi.fn();
    render(overlay("panel", { onDismiss }));
    const dialog = screen.getByRole("dialog", { name: "The draft is in the books." });
    // The Modal contract: focus lands inside the panel the moment it opens.
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("gives a commissioner the panel without inventing a roster block", () => {
    render(overlay("panel", { myTeamId: null }));
    expect(screen.getByTestId("finale-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("finale-roster-row")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Your roster, by slot" })).not.toBeInTheDocument();
  });
});
