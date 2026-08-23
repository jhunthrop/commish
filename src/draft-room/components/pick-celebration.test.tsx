import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { renderSurface } from "@/components/ui/test-utils";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { PLAYERS, TEAMS, playersById } from "../test-fixtures";
import { PickCelebration } from "./pick-celebration";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const pick = { pickNumber: 4, round: 2, teamId: "t2", playerId: "rb1", slot: "RB" as const, slotIndex: 0, price: null, timestamp: "2026-09-01T00:05:00.000Z", auto: false };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PickCelebration", () => {
  it("renders nothing before any pick has landed", () => {
    stubMatchMedia(false);
    const { container } = render(<PickCelebration lastPick={null} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces someone else's pick politely, in both themes, axe-clean", async () => {
    stubMatchMedia(false);
    await renderSurface(<PickCelebration lastPick={{ pick, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />, async ({ container }) => {
      expect(screen.getByRole("status")).toHaveTextContent("Iron Owls drafted Marcus Reed.");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("gives your own pick a distinct treatment and copy", () => {
    stubMatchMedia(false);
    render(<PickCelebration lastPick={{ pick, isMine: true }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    const panel = screen.getByTestId("pick-celebration");
    expect(panel).toHaveTextContent("You drafted Marcus Reed!");
    expect(panel).toHaveAttribute("data-emphasis", "self");
    expect(panel.className).toMatch(/border-accent/);
  });

  // The shared `Celebration` primitive carries the self/peer distinction itself now — one
  // reduced-motion branch to maintain instead of two callers each rolling their own.
  it("uses the peer animation for someone else's pick and the self animation for your own", () => {
    stubMatchMedia(false);
    const { rerender } = render(<PickCelebration lastPick={{ pick, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(screen.getByTestId("pick-celebration").className).toMatch(/animate-celebrate-peer/);
    rerender(<PickCelebration lastPick={{ pick: { ...pick, pickNumber: 5 }, isMine: true }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(screen.getByTestId("pick-celebration").className).toMatch(/animate-celebrate-self/);
  });

  it("drops every animation class when the user prefers reduced motion — but still shows the pick", () => {
    stubMatchMedia(true);
    render(<PickCelebration lastPick={{ pick, isMine: true }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    const panel = screen.getByTestId("pick-celebration");
    expect(panel.className).not.toMatch(/animate-celebrate/);
    expect(panel).toHaveTextContent("You drafted Marcus Reed!");
  });

  it("shows the winning price for an auction pick and fades out on its own", () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    render(<PickCelebration lastPick={{ pick: { ...pick, price: 42 }, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(screen.getByText("Won for $42.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(DRAFT_ROOM_CONFIG.celebrationMs));
    expect(screen.queryByTestId("pick-celebration")).toBeNull();
  });

  it("swaps in the new pick's own words when a fresh pick lands", () => {
    stubMatchMedia(false);
    const pick1 = { ...pick, pickNumber: 5 };
    const pick2 = { ...pick, pickNumber: 6, playerId: "qb1", teamId: "t1" };
    const { rerender } = render(<PickCelebration lastPick={{ pick: pick1, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(screen.getByRole("status")).toHaveTextContent("Iron Owls drafted Marcus Reed.");

    rerender(<PickCelebration lastPick={{ pick: pick2, isMine: true }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(screen.getByRole("status")).not.toHaveTextContent("Iron Owls drafted Marcus Reed.");
  });

  it("remounts for a NEW pick (animation replays) but keeps the node on a same-pick rerender", () => {
    stubMatchMedia(false);
    const pick1 = { ...pick, pickNumber: 5 };
    const pick2 = { ...pick, pickNumber: 6, playerId: "qb1", teamId: "t1" };
    const { rerender } = render(<PickCelebration lastPick={{ pick: pick1, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    const first = screen.getByRole("status");

    // Same pick, new render pass: same DOM node — the entrance animation must not restart.
    rerender(<PickCelebration lastPick={{ pick: pick1, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(screen.getByRole("status")).toBe(first);

    // A new pick lands mid-celebration: keyed remount, fresh node, animation replays.
    rerender(<PickCelebration lastPick={{ pick: pick2, isMine: true }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    expect(screen.getByRole("status")).not.toBe(first);
  });
});
