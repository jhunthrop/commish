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
  readonly rating: number;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authorName: string;
  /** The STORED avatar ref (`users.avatar_url`): `Avatar`'s `avatar` prop takes this directly. */
  readonly authorAvatar: string | null;
}

/**
 * One page of the feed, newest-first. `nextBefore` is `null` once there is nothing older left —
 * pass it straight back as `before` for the next page, same cursor idiom as `ChatPage`
 * (`@/chat/contract`) and `listMessages`.
 */
export interface ReviewsPage {
  readonly reviews: readonly ReviewView[];
  readonly hasMore: boolean;
  readonly nextBefore: string | null;
}

/** `GET /api/reviews`'s response body. */
export type ReviewsListBody = ReviewsPage;

/** `POST /api/reviews`'s response body: the caller's own review, created or edited. */
export type ReviewSubmitBody = ReviewView;
