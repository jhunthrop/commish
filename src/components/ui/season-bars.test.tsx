import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { SeasonBars, type SeasonWeek } from "./season-bars";

const population = "running backs in a week this season";

const SEASON: readonly SeasonWeek[] = [
  { week: 1, points: 24.6, comparison: { percentile: 0.95, population } },
  { week: 2, points: 9.1, comparison: { percentile: 0.4, population } },
  // Week 3 happened without him — a bye, an inactive, a man signed in October.
  { week: 3, points: null },
  { week: 4, points: 0, comparison: { percentile: 0.02, population } },
];

describe("SeasonBars", () => {
  it("labels every week that happened, and numbers the axis", async () => {
    await renderSurface(<SeasonBars label="His points by week" weeks={SEASON} />, ({ getByRole, getByText }) => {
      expect(getByRole("group", { name: "His points by week" })).toBeInTheDocument();
      expect(getByText("24.6")).toBeInTheDocument();
      expect(getByText("9.1")).toBeInTheDocument();
      expect(getByText("0.0")).toBeInTheDocument();
    });
  });

  it("draws no bar and prints no number for a week that happened without him", async () => {
    // "Did not play" and "played and scored nothing" are different facts. The column keeps its
    // place so the season's shape stays honest about WHEN the hole was.
    await renderSurface(<SeasonBars label="Weeks" weeks={SEASON} />, ({ container }) => {
      const hole = container.querySelector("[data-week='3']");
      expect(hole).not.toBeNull();
      expect(hole!.querySelector("[data-magnitude]")).toBeNull();
      expect(hole!.querySelector("[style]")).toBeNull();
    });
  });

  it("prints a zero week's number but gives it no height, because zero height IS zero", async () => {
    await renderSurface(<SeasonBars label="Weeks" weeks={SEASON} />, ({ container }) => {
      const zero = container.querySelector("[data-week='4']");
      expect(zero).toHaveTextContent("0.0");
      expect(zero!.querySelector("[style]")).toBeNull();
    });
  });

  it("scales every bar against the tallest week, so two adjacent weeks are comparable by eye", async () => {
    await renderSurface(<SeasonBars label="Weeks" weeks={SEASON} />, ({ container }) => {
      expect(container.querySelector("[data-week='1'] [style]")).toHaveStyle({ height: "100%" });
      // 9.1 of 24.6 is 37%.
      expect(container.querySelector("[data-week='2'] [style]")).toHaveStyle({ height: "37%" });
    });
  });

  it("draws nothing at all when no week has a number, rather than an axis with no chart on it", async () => {
    const empty: readonly SeasonWeek[] = [{ week: 1, points: null }, { week: 2, points: null }];
    await renderSurface(<SeasonBars label="Weeks" weeks={empty} />, ({ container }) => {
      expect(container.querySelector("[data-testid='season-week']")).toBeNull();
    });
    await renderSurface(<SeasonBars label="Weeks" weeks={[]} />, ({ container }) => {
      expect(container.querySelector("[data-testid='season-week']")).toBeNull();
    });
  });

  it("spends emphasis exactly once: the season high in full ink, every other bar one quiet tone", async () => {
    // The 2026-08-30 redesign (founder: "why does everything have an uptick?"): no per-week
    // verdict carets, no tone ladder — height carries the season, and only its high speaks.
    await renderSurface(<SeasonBars label="Weeks" weeks={SEASON} />, ({ container }) => {
      const bars = [...container.querySelectorAll("[data-testid='season-week'] [style]")];
      const loud = bars.filter((bar) => bar.className.includes("bg-text-primary"));
      expect(loud).toHaveLength(1);
      expect(container.querySelector("[data-week='2'] [style]")).toHaveClass("bg-text-muted/60");
      expect(container.querySelector("[data-magnitude]")).toBeNull();
    });
  });

  it("has no axe violations in either theme", async () => {
    await renderSurface(<SeasonBars label="Weeks" weeks={SEASON} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
