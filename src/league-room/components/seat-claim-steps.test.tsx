import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { SEAT_HOLD } from "@/matchmaking/config";
import { SeatClaimSteps } from "./seat-claim-steps";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

/**
 * The DARK render's exact HTML, captured from the component before this task's live-aware branch
 * existed (`git show` of the pre-Task-13 `seat-claim-steps.tsx` rendered through the identical
 * `render(<SeatClaimSteps />)` call below). The founder's directive is "not all drafts will be
 * free," and the fix for that is a fourth, LIVE-only step — the dark render today, with
 * `moneyIsLive()` false, must not move by one byte.
 */
const DARK_HTML =
  '<div class="animate-rise rise-3"><ol class="grid max-w-4xl gap-4 sm:grid-cols-3 sm:gap-10"><li class="flex flex-col gap-1 border-t border-line pt-3.5"><span class="font-mono text-xs tracking-wide text-text-faint">1 · 10 seconds</span><span class="font-display text-base font-semibold text-text-primary">Pick a seat</span><span class="text-sm text-text-muted">Your seat holds for 10 minutes</span></li><li class="flex flex-col gap-1 border-t border-line pt-3.5"><span class="font-mono text-xs tracking-wide text-text-faint">2 · 30 seconds</span><span class="font-display text-base font-semibold text-text-primary">Sign in with email</span><span class="text-sm text-text-muted">That is the whole signup</span></li><li class="flex flex-col gap-1 border-t border-line pt-3.5"><span class="font-mono text-xs tracking-wide text-text-faint">3 · done</span><span class="font-display text-base font-semibold text-text-primary">You are in the league</span><span class="text-sm text-text-muted">Meet the room, rank your draft slots</span></li></ol></div>';

describe("SeatClaimSteps", () => {
  // Phase 4, Task 13: byte-for-byte proof the dark branch has not moved — the strongest form of
  // "zero visible change today" this file can state.
  it("renders the dark branch byte-identical to the pre-live-aware markup", () => {
    const { container } = render(<SeatClaimSteps />);
    expect(container.innerHTML).toBe(DARK_HTML);
  });

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

  // Phase 4, Task 13, the LIVE branch — the founder's directive is "not all drafts will be free
  // ... we need to add a step for depositing," proven through injection exactly like
  // `FrontDoorHero`'s own `live` prop: `moneyIsLive()` ships false today, so no real render
  // reaches this branch, but the branch itself must be correct the day a state is enabled.
  describe("the live branch (injected)", () => {
    it("adds a fourth step, Cover the entry, between signing in and being in the league", async () => {
      await renderSurface(<SeatClaimSteps live={true} />, ({ getAllByRole, getByText }) => {
        const items = getAllByRole("listitem");
        expect(items).toHaveLength(4);
        expect(getByText("Cover the entry")).toBeInTheDocument();
        expect(getByText("Free leagues skip this step. Paid leagues draw from your balance.")).toBeInTheDocument();
        expect(items[2]).toHaveTextContent("Cover the entry");
      });
    });

    it("keeps step 1 unchanged and retires the now-false 'whole signup' claim on step 2", async () => {
      await renderSurface(<SeatClaimSteps live={true} />, ({ getByText, queryByText }) => {
        expect(getByText("Pick a seat")).toBeInTheDocument();
        expect(getByText(`Your seat holds for ${SEAT_HOLD.minutes} minutes`)).toBeInTheDocument();
        expect(getByText("Sign in with email")).toBeInTheDocument();
        expect(getByText("One account for every league")).toBeInTheDocument();
        expect(queryByText("That is the whole signup")).not.toBeInTheDocument();
      });
    });

    it("keeps the terminal step unchanged, renumbered fourth", async () => {
      await renderSurface(<SeatClaimSteps live={true} />, ({ getAllByRole, getByText }) => {
        expect(getByText("You are in the league")).toBeInTheDocument();
        expect(getByText("Meet the room, rank your draft slots")).toBeInTheDocument();
        const items = getAllByRole("listitem");
        expect(items[3]).toHaveTextContent("4 · done");
      });
    });

    it("numbers every step honestly, never overclaiming an instant deposit", async () => {
      await renderSurface(<SeatClaimSteps live={true} />, ({ getAllByRole }) => {
        const items = getAllByRole("listitem");
        expect(items[0]).toHaveTextContent("1 · 10 seconds");
        expect(items[1]).toHaveTextContent("2 · 30 seconds");
        expect(items[2]).toHaveTextContent("3 · 1 minute");
        expect(items[3]).toHaveTextContent("4 · done");
      });
    });

    it("holds the hairline-column grid at four columns instead of three", async () => {
      await renderSurface(<SeatClaimSteps live={true} />, ({ container }) => {
        const list = container.querySelector("ol");
        expect(list?.className).toContain("sm:grid-cols-4");
        expect(list?.className).not.toContain("sm:grid-cols-3");
      });
    });

    it("says nothing that breaks the house copy rules: no contractions, no dashes", async () => {
      await renderSurface(<SeatClaimSteps live={true} />, ({ container }) => {
        expect(container.textContent).not.toMatch(/[—–]/);
        expect(container.textContent).not.toMatch(/\b\w+'\w+\b/);
      });
    });

    it("is axe-clean at four columns, in both themes", async () => {
      await renderSurface(<SeatClaimSteps live={true} />, async ({ container, getAllByRole }) => {
        expect(getAllByRole("listitem")).toHaveLength(4);
        expect(await axe(container)).toHaveNoViolations();
      });
    });
  });
});
