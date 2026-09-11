import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { SeatMeter, SeatStack } from "./seat-meter";

describe("SeatMeter", () => {
  it("names the seats in words beside the bar", () => {
    renderSurface(<SeatMeter filled={9} total={12} />, ({ getByText }) => {
      expect(getByText("9 of 12 seated")).toBeInTheDocument();
    });
  });

  it("says how many are left only when the answer is small enough to matter", () => {
    renderSurface(<SeatMeter filled={11} total={12} />, ({ getByText }) => {
      expect(getByText("11 of 12 seated. 1 seat left.")).toBeInTheDocument();
    });
  });

  it("says nothing extra when the remaining count is not small enough to matter", () => {
    renderSurface(<SeatMeter filled={9} total={12} />, ({ getByText, queryByText }) => {
      expect(getByText("9 of 12 seated")).toBeInTheDocument();
      expect(queryByText(/left\.?$/)).not.toBeInTheDocument();
    });
  });

  it("pluralizes more than one seat left", () => {
    renderSurface(<SeatMeter filled={10} total={12} />, ({ getByText }) => {
      expect(getByText("10 of 12 seated. 2 seats left.")).toBeInTheDocument();
    });
  });

  it("owns the seat sentence for the whole product, held seats included", () => {
    // F17. One seat count was being spoken three ways ("9 of 12 seated", "10 of 12 seats filled",
    // "4 of 12 seats taken") by two primitives. THIS TEST IS THE REFERENCE: `SeatMeter` composes
    // the sentence, every surface renders `SeatMeter`, and no caller writes a seat sentence of its
    // own. The held clause renders only when `heldSeats > 0` and says what it knows (Task 6).
    renderSurface(<SeatMeter filled={9} total={12} heldSeats={1} />, ({ getByText }) => {
      expect(getByText("9 of 12 seated. 1 seat is being claimed right now.")).toBeInTheDocument();
    });
  });

  it("says nothing about a hold when heldSeats is absent or zero", () => {
    renderSurface(<SeatMeter filled={9} total={12} />, ({ queryByText }) => {
      expect(queryByText(/being claimed/)).not.toBeInTheDocument();
    });
  });

  it("moves the sentence to screen readers only when the caller shows its own visible count (Task 13's LeagueRow)", () => {
    // The desktop league row's Seats column prints "{n} of {t} open" as its visible value —
    // `srOnlySentence` keeps the one product seat sentence (F17) for assistive tech without
    // stacking a second visible phrasing beside it.
    renderSurface(<SeatMeter filled={9} total={12} heldSeats={1} srOnlySentence />, ({ getByText }) => {
      expect(getByText("9 of 12 seated. 1 seat is being claimed right now.")).toHaveClass("sr-only");
    });
  });

  it("renders one equal segment per total seat, taken in ink, held in amber, open in the well", () => {
    renderSurface(<SeatMeter filled={2} total={5} heldSeats={1} />, ({ getByTestId }) => {
      const bar = getByTestId("seat-segments");
      expect(bar.children).toHaveLength(5);
      const segments = Array.from(bar.children);
      // Equal flex segments, never sized dots.
      expect(segments.every((segment) => segment.className.includes("flex-1"))).toBe(true);
      // SIDELINE (2026-09-10): taken seats are INK, not Court blue — `accent` is the one verb
      // (P3) and a twelve-segment blue bar spent the page's loudest pigment on furniture.
      expect(segments.filter((segment) => segment.className.includes("bg-text-primary"))).toHaveLength(2);
      expect(segments.filter((segment) => segment.className.includes("bg-self"))).toHaveLength(1);
      expect(segments.filter((segment) => segment.className.includes("bg-surface-inset"))).toHaveLength(2);
      expect(segments.some((segment) => segment.className.includes("bg-accent"))).toBe(false);
    });
  });

  it("hides the segment bar from the accessibility tree — the sentence beside it says everything", () => {
    renderSurface(<SeatMeter filled={2} total={5} />, ({ getByTestId }) => {
      expect(getByTestId("seat-segments")).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<SeatMeter filled={9} total={12} heldSeats={1} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

describe("SeatStack", () => {
  it("stands one token per seat on end, in the meter's own three skins, in both themes", async () => {
    await renderSurface(<SeatStack filled={9} total={12} heldSeats={1} />, ({ getByTestId }) => {
      const stack = getByTestId("seat-stack");
      expect(stack.children).toHaveLength(12);
      const tokens = Array.from(stack.children);
      expect(tokens.filter((token) => token.className.includes("bg-text-primary"))).toHaveLength(9);
      expect(tokens.filter((token) => token.className.includes("bg-self"))).toHaveLength(1);
      expect(tokens.filter((token) => token.className.includes("bg-surface-inset"))).toHaveLength(2);
    });
  });

  it("hides itself from the accessibility tree — the row's seat sentence says everything", async () => {
    await renderSurface(<SeatStack filled={9} total={12} />, ({ getByTestId }) => {
      expect(getByTestId("seat-stack")).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("draws an untouched room as twelve open seats, never as nothing", async () => {
    await renderSurface(<SeatStack filled={0} total={12} />, ({ getByTestId }) => {
      const stack = getByTestId("seat-stack");
      expect(stack.children).toHaveLength(12);
      expect(Array.from(stack.children).every((token) => token.className.includes("bg-surface-inset"))).toBe(true);
    });
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<SeatStack filled={9} total={12} heldSeats={1} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
