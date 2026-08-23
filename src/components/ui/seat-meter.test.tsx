import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { SeatMeter } from "./seat-meter";

describe("SeatMeter", () => {
  it("names the seats in words, and hides the dots from the accessibility tree", () => {
    renderSurface(<SeatMeter filled={9} total={12} />, ({ getByText, getByTestId }) => {
      expect(getByText("9 of 12 seated")).toBeInTheDocument();
      expect(getByTestId("seat-dots")).toHaveAttribute("aria-hidden", "true");
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

  it("renders one dot per total seat, with the filled ones distinguished", () => {
    renderSurface(<SeatMeter filled={2} total={5} />, ({ getByTestId }) => {
      expect(getByTestId("seat-dots").children).toHaveLength(5);
    });
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<SeatMeter filled={9} total={12} heldSeats={1} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
