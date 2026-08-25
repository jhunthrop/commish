import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { SEAT_HOLD } from "@/matchmaking/config";
import { SeatClaimSteps } from "./seat-claim-steps";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

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

  // Task 7 (E4 + Task 3's carry): the mock's timing spellings are sentence case — the old
  // "10 SEC"/"DONE" caps data dies here, closing the caps charter's last data-side carry.
  it("words each numeral line the mock's way, sentence case, never the old caps data", async () => {
    await renderSurface(<SeatClaimSteps />, ({ getAllByRole, queryByText }) => {
      const items = getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("1 · 10 seconds");
      expect(items[1]).toHaveTextContent("2 · 30 seconds");
      expect(items[2]).toHaveTextContent("3 · done");
      expect(queryByText(/10 SEC/)).not.toBeInTheDocument();
      expect(queryByText(/30 SEC/)).not.toBeInTheDocument();
      expect(queryByText(/DONE/)).not.toBeInTheDocument();
    });
  });

  // E4: hairline-topped columns, numerals in quiet mono — labels and values stop competing at
  // hero scale, so the accent numerals die.
  it("tops each column with a hairline and keeps the numeral quiet mono, never accent", async () => {
    await renderSurface(<SeatClaimSteps />, ({ getAllByRole }) => {
      for (const item of getAllByRole("listitem")) {
        expect(item.className).toContain("border-t");
        expect(item.className).toContain("border-line");
        const numeral = item.querySelector("span");
        expect(numeral?.className).toContain("font-mono");
        expect(numeral?.className).toContain("text-text-faint");
        expect(numeral?.className).not.toContain("text-accent");
      }
    });
  });

  // Task 7 (hero band): the strip is the hero's third riser; reduced motion keeps the steps
  // and drops the animation.
  it("rises third, and drops the animation when the user asked for less motion", () => {
    const animated = render(<SeatClaimSteps />);
    expect(animated.container.firstElementChild?.className).toContain("animate-rise");
    expect(animated.container.firstElementChild?.className).toContain("rise-3");
    animated.unmount();

    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const still = render(<SeatClaimSteps />);
    expect(still.getByText("Pick a seat")).toBeInTheDocument();
    expect(still.container.firstElementChild?.className).not.toContain("animate-rise");
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  it("names three steps in order, in both themes, axe-clean", async () => {
    await renderSurface(<SeatClaimSteps />, async ({ container, getAllByRole }) => {
      const items = getAllByRole("listitem");
      expect(items).toHaveLength(3);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
