// TYPES ONLY, no runtime code — mirrors `@/account-room/contract`'s and `@/league-room/
// contract`'s own note. Imported by `/api/reviews` as its return shape and by
// `src/account-room/components/review-*` as their prop shape, so the wire and the room can't
// drift.

/**
 * One review, exactly as the feed renders it. Deliberately carries no `userId` and no removal
 * fields — `removedAt`/`removedByUserId`/`removalReason` are the operator record, not something
 * the public feed (or its API response) ever exposes; a removed review is simply absent from
 * this list (`listReviews` excludes it at the query, see `feedQuery`'s own docblock).
 */
export interface ReviewView {
  readonly id: string;
  /**
   * `null` when the display-only rating lookup missed between `listReviews`' two round trips.
   * The feed renders no rating at all in that case: "0 out of 5, rated" is a number the author
   * never chose (the scale starts at 1), on the page whose promise is that it shows what people
   * actually said.
   */
  readonly rating: number | null;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorName: string;
  /** The STORED avatar ref (`users.avatar_url`): `Avatar`'s `avatar` prop takes this directly. */
  readonly authorAvatar: string | null;
  /**
   * Founder decision #8's residual: whether THIS reviewer has finished at least one full season
   * on Commish, derived at read time from `@/participation`'s bounded machinery (Task 1) — never
   * a stored flag, so it can never drift from the record it describes. One boolean, deliberately:
   * it never carries the count, because "3 seasons" on a public feed is a fact about a stranger
   * nobody asked them to publish. `false` renders no badge at all — there is no negative badge,
   * only the absence of a positive one — and `VERIFIED_BADGE_TOOLTIP` (`@/participation/verified`)
   * is the one sentence any reader who clicks the badge's `InfoTip` reads about what it means.
   */
  readonly verified: boolean;
}

/**
 * One page of the feed, newest-first. `nextBefore` is `null` once there is nothing older left —
 * pass it straight back as `before` for the next page, same cursor idiom as `ChatPage`
 * (`@/chat/contract`) and `listMessages`. Opaque to the client: it carries a timestamp AND a
 * row id, because a timestamp alone is not unique (see `@/reviews/cursor`).
 */
export interface ReviewsPage {
  readonly reviews: readonly ReviewView[];
  readonly hasMore: boolean;
  readonly nextBefore: string | null;
}

/**
 * The caller's own review, in the three states the product actually has. `removed` is the one
 * the feed's `ReviewView` deliberately cannot express: a removed review is absent from the
 * public feed, but its AUTHOR still has to be told what happened to it, or they edit into a
 * silent shadow-ban.
 *
 * `reason` is the STORED TOKEN — one of `REVIEW_CONFIG.reportReasons`' values — and it is
 * NULLABLE, because `removed_at` and `removal_reason` are independently nullable columns and a
 * row with the first and not the second is reachable. It is deliberately not a sentence: every
 * surface maps it through `removalPhraseFor`/`removalSentenceFor` at render, both of which have
 * their own answer for a value outside the closed set, so the mapping happens once in one place
 * rather than a phrase being smuggled into a field typed as a token. `scripts/remove-review.ts`
 * previews the mapped result before it asks for confirmation, for exactly that reason.
 */
export type MyReviewState =
  | { readonly state: "none" }
  | { readonly state: "live"; readonly review: ReviewView }
  | { readonly state: "removed"; readonly reason: string | null; readonly removedAt: string };

/** `GET /api/reviews`'s response body. */
export type ReviewsListBody = ReviewsPage;

/** `POST /api/reviews`'s response body: the caller's own review, created or edited. */
export type ReviewSubmitBody = ReviewView;
