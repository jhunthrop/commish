import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { PointsShareBar, pointsShare } from "./points-share-bar";
import { NOT_STARTED_DASH } from "./game-state-chip";

describe("pointsShare", () => {
  it("divides the real points, and the two shares always sum to 100", () => {
    // `theirs` is derived rather than rounded independently: two roundings produce "51% / 50%",
    // which a reader correctly reads as a bug.
    expect(pointsShare(60, 40)).toEqual({ minePct: 60, theirsPct: 40 });
    const odd = pointsShare(101.4, 98.9);
    expect(odd.minePct! + odd.theirsPct!).toBe(100);
  });

  it("answers null for both sides when there is nothing to divide, and never divides by zero", () => {
    // Before kickoff neither side owns 0% of the points — there are no points, and a share of
    // nothing is undefined rather than zero. The same ruling `NOT_STARTED_DASH` makes next door.
    expect(pointsShare(0, 0)).toEqual({ minePct: null, theirsPct: null });
  });

  it("floors a negative running total, because nobody owns a negative share of a bar", () => {
    // A team total can genuinely go negative (interceptions, a fumble-heavy defence). Flooring
    // keeps the drawn segments summing to the track and the printed numbers agreeing with them.
    expect(pointsShare(-4, 20)).toEqual({ minePct: 0, theirsPct: 100 });
    expect(pointsShare(-4, -2)).toEqual({ minePct: null, theirsPct: null });
  });
});

describe("PointsShareBar", () => {
  it("never renders a bar without its numbers, because a bar alone makes people estimate", async () => {
    // `meter.tsx`'s contract, inherited verbatim: the bar is the glance and the number is the
    // decision, so there is no prop that turns the numbers off.
    await renderSurface(<PointsShareBar mineLabel="You" theirsLabel="Tuna Sharks" mine={78} theirs={52} />, ({ getByText }) => {
      expect(getByText("You")).toBeInTheDocument();
      expect(getByText("Tuna Sharks")).toBeInTheDocument();
      expect(getByText("60%")).toBeInTheDocument();
      expect(getByText("40%")).toBeInTheDocument();
    });
  });

  it("draws each segment at exactly the percentage it prints", async () => {
    // The drawn bar and the stated number come from one rounding, so they can never disagree by
    // a pixel a reader would have to reconcile.
    await renderSurface(<PointsShareBar mineLabel="You" theirsLabel="Them" mine={78} theirs={52} />, ({ container }) => {
      const [mine, theirs] = Array.from(container.querySelectorAll("[style]"));
      expect(mine).toHaveStyle({ width: "60%" });
      expect(theirs).toHaveStyle({ width: "40%" });
    });
  });

  it("shows the not-yet dash rather than a false 0% before either side has scored", async () => {
    await renderSurface(<PointsShareBar mineLabel="You" theirsLabel="Them" mine={0} theirs={0} />, ({ getAllByText, container }) => {
      expect(getAllByText(NOT_STARTED_DASH)).toHaveLength(2);
      for (const segment of Array.from(container.querySelectorAll("[style]"))) {
        expect(segment).toHaveStyle({ width: "0%" });
      }
    });
  });

  it("hides the track from assistive tech, because the two labelled numbers already say it", async () => {
    await renderSurface(<PointsShareBar mineLabel="You" theirsLabel="Them" mine={78} theirs={52} />, ({ container }) => {
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });
  });

  it("keeps a number from wrapping mid-figure while the label may truncate", async () => {
    // `meter.tsx`'s LED-11 lesson: the label is the half that can afford to lose characters.
    await renderSurface(<PointsShareBar mineLabel="A very long team name indeed" theirsLabel="Them" mine={78} theirs={52} />, ({ getByText }) => {
      expect(getByText("A very long team name indeed").className).toContain("truncate");
      expect(getByText("60%").className).toContain("whitespace-nowrap");
    });
  });

  it("is axe-clean in both themes, scored and unscored", async () => {
    await renderSurface(<PointsShareBar mineLabel="You" theirsLabel="Them" mine={78} theirs={52} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
    await renderSurface(<PointsShareBar mineLabel="You" theirsLabel="Them" mine={0} theirs={0} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
