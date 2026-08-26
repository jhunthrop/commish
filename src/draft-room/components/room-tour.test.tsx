import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { RoomTour } from "./room-tour";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

/** The three real anchor targets (Task 4, R3), rendered as ordinary siblings so RTL's automatic
 *  unmount-on-cleanup removes them the same way it removes everything else — present together
 *  only on a real `DraftRoom` render, never on the waiting room's preview caller. */
function AnchorTargets() {
  return (
    <>
      <div id="room-clock" />
      <div id="dock-queue" />
      <div id="player-pool" />
    </>
  );
}

describe("RoomTour", () => {
  it("is shown once and never again", async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<RoomTour dismissedAt={null} onDismiss={onDismiss} actionLabel="Draft" />);
    expect(screen.getByRole("dialog", { name: "How this room works" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    rerender(<RoomTour dismissedAt="2026-08-19T00:00:00.000Z" onDismiss={onDismiss} actionLabel="Draft" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes even when the preference write fails", async () => {
    // A background preference write must never be the thing that keeps a manager out of a live
    // draft. The worst case is seeing the tour twice.
    render(
      <RoomTour
        dismissedAt={null}
        onDismiss={() => {
          throw new Error("nope");
        }}
        actionLabel="Draft"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never renders when the tour was already dismissed", () => {
    render(<RoomTour dismissedAt="2026-08-19T00:00:00.000Z" onDismiss={() => {}} actionLabel="Draft" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the clock, the queue, and how to take a turn — with the real button word for a snake room", () => {
    render(<RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Draft" />);
    expect(screen.getByText("The clock")).toBeInTheDocument();
    expect(screen.getByText("The queue")).toBeInTheDocument();
    expect(screen.getByText("Taking your turn")).toBeInTheDocument();
    expect(
      screen.getByText("When it is your turn, click Draft next to the player you want. Do it before the clock runs out, or the room picks for you from your queue."),
    ).toBeInTheDocument();
  });

  it("says the real button word for an auction room instead, never a word that room doesn't use", () => {
    // `RoomTour` mounts unconditionally for both formats (`DraftRoom`) — the button `PlayerPool`
    // renders is "Nominate" in an auction room, never "Draft", so the copy has to say so too.
    render(<RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Nominate" />);
    expect(
      screen.getByText("When it is your turn, click Nominate next to the player you want. Do it before the clock runs out, or the room picks for you from your queue."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/click Draft/)).not.toBeInTheDocument();
  });

  // Task 9, Step 1: the closing stop points at practice, regardless of format or dismissal state.
  it("closes with a stop pointing at practice, quoting the safety net's one sanctioned phrase", () => {
    render(<RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Draft" />);
    expect(screen.getByText("Practice anytime")).toBeInTheDocument();
    expect(
      screen.getByText("Even if you miss your pick, the room picks for you from your queue. Start a mock draft anytime to practice first."),
    ).toBeInTheDocument();
  });

  it("closes on Escape without throwing", async () => {
    const onDismiss = vi.fn();
    render(<RoomTour dismissedAt={null} onDismiss={onDismiss} actionLabel="Draft" />);
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled aria-modal dialog, axe-clean in both themes", async () => {
    await renderSurface(<RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Draft" />, async ({ container }) => {
      const dialog = screen.getByRole("dialog", { name: "How this room works" });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

/**
 * Task 4, R3: the anchored tour, and the two ways it degrades back to today's modal
 * byte-for-byte — `usePrefersReducedMotion`, and a target missing from the DOM. Every case here
 * mounts the real `AnchorTargets` (or deliberately withholds one) rather than mocking `document`
 * — `RoomTour` reads `document.getElementById` for real, so the test should too.
 */
describe("RoomTour — anchored mode (Task 4, R3)", () => {
  it("renders the anchored coach marks, not the modal, when every anchor target exists", () => {
    render(
      <>
        <AnchorTargets />
        <RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Draft" />
      </>,
    );
    expect(screen.getByRole("dialog", { name: "The clock" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "How this room works" })).not.toBeInTheDocument();
  });

  it("still says the real action word for an auction room in its anchored 'Taking your turn' stop", async () => {
    render(
      <>
        <AnchorTargets />
        <RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Nominate" />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByText("When it is your turn, click Nominate next to the player you want. Do it before the clock runs out, or the room picks for you from your queue."),
    ).toBeInTheDocument();
  });

  it("falls back to the modal under prefers-reduced-motion, even with every target present", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    render(
      <>
        <AnchorTargets />
        <RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Draft" />
      </>,
    );
    expect(screen.getByRole("dialog", { name: "How this room works" })).toBeInTheDocument();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  it("falls back to the modal when even one anchor target is missing from the DOM", () => {
    render(
      <>
        <div id="room-clock" />
        <div id="dock-queue" />
        {/* player-pool never mounts — the waiting room's preview caller's exact shape. */}
        <RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Draft" />
      </>,
    );
    expect(screen.getByRole("dialog", { name: "How this room works" })).toBeInTheDocument();
  });

  it("dismisses the whole anchored tour from Got it on any stop, closing locally even when onDismiss throws", async () => {
    render(
      <>
        <AnchorTargets />
        <RoomTour
          dismissedAt={null}
          onDismiss={() => {
            throw new Error("nope");
          }}
          actionLabel="Draft"
        />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dismisses the anchored tour on Escape too", async () => {
    const onDismiss = vi.fn();
    render(
      <>
        <AnchorTargets />
        <RoomTour dismissedAt={null} onDismiss={onDismiss} actionLabel="Draft" />
      </>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
