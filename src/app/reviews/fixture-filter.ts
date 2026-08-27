import type { ReviewView } from "@/reviews/contract";

/**
 * D3 (flow analysis; storefront review) — `/reviews`' own fixture-exclusion signature. `leagues`
 * carry a name (`notAFixtureLeague`, `@/league-service/browse`); a review carries no league name
 * at all, so it needs a tell of its own. The one review-writing spec this product ships
 * (`e2e/onboarding.spec.ts`) stamps a millisecond epoch straight into the body it types — "This
 * league ate my roster overnight and nobody ever explained why. Filed at 1787735299359." — a
 * marker no real manager would ever type by hand. Matching THAT stamp, not the sentence around
 * it, keeps this rule from silently widening the day a second review-writing spec exists with
 * different prose: the epoch stamp is the tell, not the words.
 *
 * Colocated with `/reviews` (`src/app/reviews/**`) rather than `@/review-service`: excluding a
 * fixture review is a PRESENTATION decision this task can make without touching the review
 * service's own query (out of this task's file boundary) — the same "filter after the read"
 * shape `/reviews`' own `browseAllowed` rate limit runs BEFORE the read, this runs after it. The
 * known limitation of filtering after the page instead of in `feedQuery` itself: a future page
 * of REAL reviews past this one's `hasMore` cursor could, in principle, still carry an unfiltered
 * fixture further down the feed. Acceptable today (the whole product carries exactly one review,
 * and it is this fixture), and worth moving into the query itself the day a second
 * review-writing e2e spec exists.
 */
const FIXTURE_REVIEW_SIGNATURE = /\bFiled at \d{10,}\.?\s*$/;

export function isFixtureReviewBody(body: string): boolean {
  return FIXTURE_REVIEW_SIGNATURE.test(body);
}

/** The feed, minus every review this build can prove is a seeded/e2e fixture. */
export function excludeFixtureReviews(reviews: readonly ReviewView[]): readonly ReviewView[] {
  return reviews.filter((review) => !isFixtureReviewBody(review.body));
}
