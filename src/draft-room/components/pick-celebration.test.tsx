import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { axe } from "vitest-axe";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { inBothThemes } from "@/components/ui/test-utils";
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
    await inBothThemes(<PickCelebration lastPick={{ pick, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />, async ({ container }) => {
      expect(screen.getByRole("status")).toHaveTextContent("Iron Owls drafted Marcus Reed.");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("gives your own pick a distinct treatment and copy", () => {
    stubMatchMedia(false);
    render(<PickCelebration lastPick={{ pick, isMine: true }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    const panel = screen.getByTestId("pick-celebration");
    expect(panel).toHaveTextContent("You drafted Marcus Reed!");
    expect(panel).toHaveAttribute("data-own", "true");
    expect(panel.className).toMatch(/animate-pick-mine/);
  });

  it("animates another team's pick differently from your own", () => {
    stubMatchMedia(false);
    render(<PickCelebration lastPick={{ pick, isMine: false }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    const panel = screen.getByTestId("pick-celebration");
    expect(panel.className).toMatch(/animate-pick-landed/);
    expect(panel.className).not.toMatch(/animate-pick-mine/);
  });

  it("drops every animation class when the user prefers reduced motion — but still shows the pick", () => {
    stubMatchMedia(true);
    render(<PickCelebration lastPick={{ pick, isMine: true }} playersById={playersById(PLAYERS)} teams={TEAMS} />);
    const panel = screen.getByTestId("pick-celebration");
    expect(panel.className).not.toMatch(/animate-pick/);
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
});
