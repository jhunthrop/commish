import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { FrontDoorHero } from "./front-door-hero";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

describe("FrontDoorHero", () => {
  // S8 ruling: the mock's headline and sub, verbatim — the accessible name concatenates the
  // ink phrase and the money phrase into the one sentence the e2e walk asserts.
  it("says the mock's headline verbatim, with the closing phrase in money", async () => {
    await renderSurface(<FrontDoorHero />, ({ getByRole, getByText }) => {
      expect(getByRole("heading", { level: 1, name: "Real leagues. Real seats. Drafting this week." })).toBeInTheDocument();
      expect(getByText("Drafting this week.").className).toContain("text-positive");
    });
  });

  it("steps the display size responsively: display-md, then display-xl from sm up (E6)", async () => {
    await renderSurface(<FrontDoorHero />, ({ getByRole }) => {
      const heading = getByRole("heading", { level: 1 });
      expect(heading.className).toContain("text-display-md");
      expect(heading.className).toContain("sm:text-display-xl");
    });
  });

  // join-flow-panel.md, HIGH: the page said nothing about money anywhere, which is honest but
  // reads as an omission to the one persona most likely to ask. The mock's `.free` line renders
  // in money too.
  it("says what a seat costs, because a visitor who searched for money deserves an answer", async () => {
    await renderSurface(<FrontDoorHero />, ({ getByText }) => {
      const free = getByText("Every league is free this season.");
      expect(free).toBeInTheDocument();
      expect(free.className).toContain("text-positive");
    });
  });

  // Phase 4, Task 13: the live branch, proven through injection — `moneyIsLive()` ships false
  // (`MONEY_STATES.enabled` is empty), so no real render reaches this sentence today. The
  // free-season sentence and the config can never disagree: this is the ONE other value `live`
  // can take, and the free sentence must never appear once it does.
  it("gives way to the live money sentence once a state is enabled, and never says both", async () => {
    await renderSurface(<FrontDoorHero live={true} />, ({ getByText, queryByText }) => {
      const live = getByText("Play free everywhere, or play for real money where your state allows.");
      expect(live).toBeInTheDocument();
      expect(live.className).toContain("text-positive");
      expect(queryByText("Every league is free this season.")).not.toBeInTheDocument();
    });
  });

  // S8: the sub adopts the mock's one sentence; "No account is needed to look." survives as a
  // detail line — it answered a persona concern and costs one quiet line.
  it("keeps the mock's sub sentence and the quiet no-account detail line", async () => {
    await renderSurface(<FrontDoorHero />, ({ getByText, queryByText }) => {
      expect(
        getByText(
          "Season-long fantasy football with a live draft room, real-time scoring, and a platform that runs the league so no brother-in-law has to.",
        ),
      ).toBeInTheDocument();
      expect(getByText("No account is needed to look.")).toBeInTheDocument();
      expect(queryByText(/Browse the open leagues/)).not.toBeInTheDocument();
    });
  });

  // Task 7 (hero band): headline rises first, the sub block second; reduced motion is a real
  // branch — the words stay, the animation classes go.
  it("staggers its two risers, and drops both under reduced motion", () => {
    const animated = render(<FrontDoorHero />);
    expect(animated.container.querySelector(".rise-1")?.className).toContain("animate-rise");
    expect(animated.container.querySelector(".rise-2")?.className).toContain("animate-rise");
    animated.unmount();

    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const still = render(<FrontDoorHero />);
    expect(still.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(still.container.querySelector(".animate-rise")).toBeNull();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  it("has a heading, in both themes, axe-clean", async () => {
    await renderSurface(<FrontDoorHero />, async ({ container, getByRole }) => {
      expect(getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
