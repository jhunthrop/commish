import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { RoomTour } from "./room-tour";

import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";

/** `RoomTour` reads the reduced-motion query pre-paint via matchMedia (T4 review HIGH — one
 *  layout effect owns the whole anchored decision), so the tests stub matchMedia itself, both
 *  ways, and `afterEach` unstubs so no case can leak its preference into the next. */
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? matches : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * FUN PASS, TASK 4 (the voice), 2026-08-27. These stop bodies used to narrate a button and a
 * countdown the manager is looking at while they read them. The founder's "it feels like a legal
 * website and not a fantasy site" is largely this failure: a tour that EXPLAINS the room instead
 * of naming it. Every stop now asserts and stops talking.
 *
 * C3's sanctioned safety-net phrase still appears verbatim wherever the tour reassures about a
 * missed pick. The practice stop no longer does, deliberately: its subject is practice, and
 * leading with absolution ("Even if you miss your pick...") sold the wrong thing.
 */
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
      screen.getByText("Draft the player you want before the clock runs out. Miss it and the room picks for you from your queue."),
    ).toBeInTheDocument();
  });

  it("says the real button word for an auction room instead, never a word that room doesn't use", () => {
    // `RoomTour` mounts unconditionally for both formats (`DraftRoom`) — the button `PlayerPool`
    // renders is "Nominate" in an auction room, never "Draft", so the copy has to say so too.
    render(<RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Nominate" />);
    expect(
      screen.getByText("Nominate the player you want before the clock runs out. Miss it and the room picks for you from your queue."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/click Draft/)).not.toBeInTheDocument();
  });

  // Task 9, Step 1: the closing stop points at practice, regardless of format or dismissal state.
  it("closes with a stop pointing at practice, quoting the safety net's one sanctioned phrase", () => {
    render(<RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Draft" />);
    expect(screen.getByText("Practice anytime")).toBeInTheDocument();
    expect(
      screen.getByText("Run a mock draft first. Same room, practice opponents, nothing counts."),
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
 * byte-for-byte — the reduced-motion preference, and a target missing from the DOM. Every case here
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
      screen.getByText("Nominate the player you want before the clock runs out. Miss it and the room picks for you from your queue."),
    ).toBeInTheDocument();
  });

  it("falls back to the modal under prefers-reduced-motion, even with every target present", () => {
    stubReducedMotion(true);
    render(
      <>
        <AnchorTargets />
        <RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Draft" />
      </>,
    );
    expect(screen.getByRole("dialog", { name: "How this room works" })).toBeInTheDocument();
    // Never a first-paint anchored flash for this audience: the modal IS the first presentation.
    expect(screen.queryByRole("dialog", { name: "The clock" })).not.toBeInTheDocument();
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
