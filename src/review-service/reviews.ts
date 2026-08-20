import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { reviewReports, reviews, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { REVIEW_CONFIG } from "@/reviews/config";
import type { ReviewView, ReviewsPage } from "@/reviews/contract";

const systemClock: Clock = { now: () => new Date().toISOString() };

interface FeedRow {
  readonly id: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly authorName: string;
  readonly authorAvatar: string | null;
}

function toView(row: FeedRow, rating: number): ReviewView {
  return {
    id: row.id,
    rating,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    authorName: row.authorName,
    authorAvatar: row.authorAvatar,
  };
}

export interface ListReviewsInput {
  /** An ISO `createdAt` cursor — the page returned is the newest reviews strictly older than it. */
  readonly before?: string;
}

/**
 * The unfiltered feed's own query — exported as a builder (not just run inline), mirroring
 * `browseQuery` (`@/league-service/browse.ts`), so `reviews.test.ts`'s "has no rating predicate
 * in the feed query at all" can inspect `feedQuery(db, {}).toSQL()` directly rather than a
 * hand-copied lookalike that could drift into asserting something production no longer runs.
 *
 * `rating` is not in this SELECT list at all — not filtered out, never fetched. Ordering,
 * filtering (`removed_at IS NULL`, the only narrowing this query ever applies) and pagination
 * all happen with zero knowledge that a rating column exists. `listReviews` attaches the number
 * afterward, through `ratingsFor` below, purely for display — a rating a curator could tune is a
 * rating this query cannot even see, which is a stronger guarantee than "we checked and it's not
 * filtered": the column simply is not here to filter on.
 */
export function feedQuery(db: Db, input: ListReviewsInput) {
  const cursor = input.before === undefined ? undefined : lt(reviews.createdAt, new Date(input.before));
  return db
    .select({
      id: reviews.id,
      body: reviews.body,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
      authorName: users.displayName,
      authorAvatar: users.avatarUrl,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.userId))
    .where(cursor === undefined ? isNull(reviews.removedAt) : and(isNull(reviews.removedAt), cursor))
    .orderBy(desc(reviews.createdAt))
    .limit(REVIEW_CONFIG.pageSize + 1);
}

/** The display-only rating for each id in `ids`. Never joined into `feedQuery` — see its docblock. */
async function ratingsFor(db: Db, ids: readonly string[]): Promise<ReadonlyMap<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: reviews.id, rating: reviews.rating }).from(reviews).where(inArray(reviews.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row.rating]));
}

/**
 * One page, newest-first, straight from the database — no reversal, unlike `listMessages`'
 * oldest-first chat log. `pageSize + 1` fetched so `hasMore` costs no second round trip, same
 * idiom as `listMessages` (`@/chat-service/chat.ts`).
 */
export async function listReviews(db: Db, input: ListReviewsInput): Promise<ReviewsPage> {
  const rows = await feedQuery(db, input);
  const hasMore = rows.length > REVIEW_CONFIG.pageSize;
  const page = hasMore ? rows.slice(0, REVIEW_CONFIG.pageSize) : rows;
  const ratings = await ratingsFor(db, page.map((row) => row.id));
  const last = page[page.length - 1];
  return {
    reviews: page.map((row) => toView(row, ratings.get(row.id) ?? 0)),
    hasMore,
    nextBefore: hasMore && last !== undefined ? last.createdAt.toISOString() : null,
  };
}

export interface SubmitReviewInput {
  readonly userId: string;
  readonly rating: number;
  readonly body: string;
  readonly clock?: Clock;
  /** Injected so ids are deterministic in a test. `crypto.randomUUID` at the edge. */
  readonly newId?: () => string;
}

/**
 * Writes the caller's own review — inserted if this is their first, edited in place if they
 * already have one. `reviews.user_id` is UNIQUE, so `ON CONFLICT (user_id) DO UPDATE` is the
 * one statement that both cases need: a fresh `id` is only ever assigned on the branch that
 * actually inserts, and an edit keeps the original row's `id` and `created_at` untouched,
 * exactly what the "edits the existing review rather than adding a second" test demands.
 */
export async function submitReview(db: Db, input: SubmitReviewInput): Promise<ReviewView> {
  const clock = input.clock ?? systemClock;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const now = new Date(clock.now());

  const [row] = await db
    .insert(reviews)
    .values({ id: newId(), userId: input.userId, rating: input.rating, body: input.body, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: reviews.userId,
      set: { rating: input.rating, body: input.body, updatedAt: now },
    })
    .returning();
  if (row === undefined) throw new Error(`submitReview: no row returned for user ${input.userId}.`);

  const [author] = await db.select({ displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, input.userId));
  return toView({ ...row, authorName: author?.displayName ?? "A manager", authorAvatar: author?.avatarUrl ?? null }, row.rating);
}

/**
 * The caller's own review, or `null` if they've never written one. `ReviewComposer` uses this to
 * load an existing draft and say so ("You've already left a review. Editing replaces it.").
 */
export async function myReview(db: Db, userId: string): Promise<ReviewView | null> {
  const [row] = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
      authorName: users.displayName,
      authorAvatar: users.avatarUrl,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.userId))
    .where(eq(reviews.userId, userId));
  return row === undefined ? null : toView(row, row.rating);
}

export interface ReportReviewInput {
  readonly reviewId: string;
  readonly reporterUserId: string;
  readonly reason: string;
  readonly clock?: Clock;
}

export type ReportReviewResult = { readonly ok: true } | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * In-product moderation SIGNAL, not moderation ACTION (ruling 18: no admin role exists to act on
 * it in this phase). Idempotent by primary key: `review_reports`' primary key is
 * `(review_id, reporter_user_id)`, so `ON CONFLICT DO NOTHING` makes reporting the same review
 * twice the SAME report rather than a duplicate row or a 409 — the caller's second click is not
 * an error, it is confirmation of the first.
 */
export async function reportReview(db: Db, input: ReportReviewInput): Promise<ReportReviewResult> {
  const [review] = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, input.reviewId));
  if (review === undefined) return { ok: false, status: 404, reason: "That review is no longer here." };

  const clock = input.clock ?? systemClock;
  await db
    .insert(reviewReports)
    .values({ reviewId: input.reviewId, reporterUserId: input.reporterUserId, reason: input.reason, createdAt: new Date(clock.now()) })
    .onConflictDoNothing();
  return { ok: true };
}

export interface RemoveReviewInput {
  readonly reviewId: string;
  readonly removedByUserId: string;
  readonly reason: string;
  readonly clock?: Clock;
}

export interface RemovalRecord {
  readonly reviewId: string;
  readonly userId: string;
  readonly removedByUserId: string;
  readonly reason: string;
  readonly removedAt: string;
}

export type RemoveReviewResult =
  | { readonly ok: true; readonly record: RemovalRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * Removal is a STAMP, never a delete (ruling 18, `reviews`' own docblock in `@/db/schema`): the
 * row keeps its author, its text, who removed it and why. The one and only writer of this
 * function is the operator script (`scripts/remove-review.ts`) — there is no admin UI and no
 * staff role calling it, by design.
 *
 * The no-re-stamp invariant is enforced HERE, in the `UPDATE`'s own `WHERE` clause
 * (`isNull(reviews.removedAt)`), not just in the script's pre-confirmation read — the same
 * "judge by this write's own returned rows, not a prior read" discipline `toggleReaction`
 * (`@/chat-service/chat.ts`) uses. Two concurrent removal attempts for the same review serialize
 * on the row lock: whichever commits first wins, and the second's `UPDATE` matches zero rows
 * because Postgres re-evaluates `removed_at IS NULL` against the now-committed row before it can
 * match — so a second operator can never silently overwrite the first one's reason and timestamp.
 */
export async function removeReview(db: Db, input: RemoveReviewInput): Promise<RemoveReviewResult> {
  const clock = input.clock ?? systemClock;
  const now = new Date(clock.now());
  const [row] = await db
    .update(reviews)
    .set({ removedAt: now, removedByUserId: input.removedByUserId, removalReason: input.reason })
    .where(and(eq(reviews.id, input.reviewId), isNull(reviews.removedAt)))
    .returning({ id: reviews.id, userId: reviews.userId, removedByUserId: reviews.removedByUserId, removalReason: reviews.removalReason, removedAt: reviews.removedAt });

  if (row !== undefined && row.removedAt !== null && row.removedByUserId !== null && row.removalReason !== null) {
    return {
      ok: true,
      record: {
        reviewId: row.id,
        userId: row.userId,
        removedByUserId: row.removedByUserId,
        reason: row.removalReason,
        removedAt: row.removedAt.toISOString(),
      },
    };
  }

  // The UPDATE matched nothing — either no review has this id, or it's already removed. A
  // second SELECT (outside the write, so it costs nothing when the write succeeds) tells the
  // two apart for a message that actually helps the operator running the script.
  const [existing] = await db.select({ removedAt: reviews.removedAt }).from(reviews).where(eq(reviews.id, input.reviewId));
  if (existing === undefined) return { ok: false, reason: `No review with id "${input.reviewId}".` };
  return { ok: false, reason: `Review "${input.reviewId}" is already removed.` };
}
