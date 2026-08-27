import { describe, expect, it } from "vitest";
import type { ReviewView } from "@/reviews/contract";
import { excludeFixtureReviews, isFixtureReviewBody } from "./fixture-filter";

function review(overrides: Partial<ReviewView> & { readonly body: string }): ReviewView {
  return {
    id: "r1",
    rating: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    authorName: "A manager",
    authorAvatar: null,
    verified: false,
    ...overrides,
  };
}

describe("isFixtureReviewBody", () => {
  it("recognizes the exact fixture signature the onboarding e2e spec writes", () => {
    expect(
      isFixtureReviewBody("This league ate my roster overnight and nobody ever explained why. Filed at 1787735299359."),
    ).toBe(true);
  });

  it("recognizes the stamp even without a trailing period", () => {
    expect(isFixtureReviewBody("Something happened. Filed at 1787735299359")).toBe(true);
  });

  it("never flags a real review, even one that happens to mention a date or a number", () => {
    expect(isFixtureReviewBody("Great season. My league filled fast and the draft room just worked.")).toBe(false);
    expect(isFixtureReviewBody("I filed a support ticket on day 3 and it got fixed by day 4.")).toBe(false);
    expect(isFixtureReviewBody("Been playing since week 12 of last season.")).toBe(false);
  });
});

describe("excludeFixtureReviews", () => {
  it("drops a fixture review and keeps a real one", () => {
    const fixture = review({ id: "fixture", body: "This league ate my roster overnight and nobody ever explained why. Filed at 1787735299359." });
    const real = review({ id: "real", body: "Great season overall, the draft room is fast." });
    expect(excludeFixtureReviews([fixture, real])).toEqual([real]);
  });

  it("answers an empty list when every review is a fixture", () => {
    const fixture = review({ body: "Filed at 1787735299359" });
    expect(excludeFixtureReviews([fixture])).toEqual([]);
  });

  it("leaves an already-empty feed empty", () => {
    expect(excludeFixtureReviews([])).toEqual([]);
  });
});
