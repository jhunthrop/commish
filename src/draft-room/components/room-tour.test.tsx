import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { RoomTour } from "./room-tour";

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
      screen.getByText("When it's your turn, click Draft next to the player you want. Do it before the clock runs out, or an autopick chooses for you."),
    ).toBeInTheDocument();
  });

  it("says the real button word for an auction room instead, never a word that room doesn't use", () => {
    // `RoomTour` mounts unconditionally for both formats (`DraftRoom`) — the button `PlayerPool`
    // renders is "Nominate" in an auction room, never "Draft", so the copy has to say so too.
    render(<RoomTour dismissedAt={null} onDismiss={() => {}} actionLabel="Nominate" />);
    expect(
      screen.getByText("When it's your turn, click Nominate next to the player you want. Do it before the clock runs out, or an autopick chooses for you."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/click Draft/)).not.toBeInTheDocument();
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
