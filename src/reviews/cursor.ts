/**
 * The feed's pagination cursor: a timestamp AND the id of the row it belongs to.
 *
 * `created_at` alone is not unique. `submitReview` stamps it from `new Date(clock.now())`, which
 * is millisecond precision, and the feed pages with a strict `<` — so two reviews written in the
 * same millisecond silently dropped one from the page after the boundary. Rare (one review per
 * user, a 5-per-minute ceiling) and completely unacceptable for a feed whose entire promise is
 * that nothing is missing from it.
 *
 * The id makes the sort key total, so `(created_at, id) < (cursor.created_at, cursor.id)` is a
 * strict ordering with no ties left to break. The wire format is opaque to the client, which
 * passes `nextBefore` straight back the way `ChatPage`'s cursor already works.
 */
export interface ReviewCursor {
  /** An ISO timestamp, exactly as `Date#toISOString()` writes it. */
  readonly createdAt: string;
  readonly id: string;
}

const SEPARATOR = "|";
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function formatReviewCursor(cursor: ReviewCursor): string {
  return `${cursor.createdAt}${SEPARATOR}${cursor.id}`;
}

/**
 * The parsed cursor, or `null` for anything this feed did not itself hand out — a hand-edited
 * value, a stale bare-timestamp cursor from before ids joined the sort key, or garbage. The
 * caller turns `null` into a 400 naming the field; nothing malformed reaches `new Date(...)`.
 */
export function parseReviewCursor(raw: string): ReviewCursor | null {
  const separatorAt = raw.indexOf(SEPARATOR);
  if (separatorAt <= 0) return null;

  const createdAt = raw.slice(0, separatorAt);
  const id = raw.slice(separatorAt + 1);
  if (id === "" || !ISO_INSTANT.test(createdAt) || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}
