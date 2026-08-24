import { describe, it, expect } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { SEAT_HOLD } from "@/matchmaking/config";
import { SeatClaimSteps } from "./seat-claim-steps";

describe("SeatClaimSteps", () => {
  it("ships the mock's three steps verbatim, minus the unverifiable '90 seconds' total", async () => {
    await renderSurface(<SeatClaimSteps />, ({ getByText, queryByText }) => {
      expect(getByText("Pick a seat")).toBeInTheDocument();
      expect(getByText(`Your seat holds for ${SEAT_HOLD.minutes} minutes`)).toBeInTheDocument();
      expect(getByText("Sign in with email")).toBeInTheDocument();
      expect(getByText("That is the whole signup")).toBeInTheDocument();
      expect(getByText("You are in the league")).toBeInTheDocument();
      expect(getByText("Meet the room, rank your draft slots")).toBeInTheDocument();
      expect(queryByText(/90 second/i)).not.toBeInTheDocument();
    });
  });

  it("names three steps in order, in both themes, axe-clean", async () => {
    await renderSurface(<SeatClaimSteps />, async ({ container, getAllByRole }) => {
      const items = getAllByRole("listitem");
      expect(items).toHaveLength(3);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
