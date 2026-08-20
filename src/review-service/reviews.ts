import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { reviewReports, reviews, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { raiseFlag } from "@/integrity-service/flags";
import { attachAuditEvent, notifyAffectedMember } from "@/integrity-service/notify";
import { REVIEW_CONFIG } from "@/reviews/config";
import { formatReviewCursor, type ReviewCursor } from "@/reviews/cursor";
import type { MyReviewState, ReviewView, ReviewsPage } from "@/reviews/contract";

const systemClock: Clock = { now: () => new Date().toISOString() };

interface FeedRow {
  readonly id: string;
  readonly body: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly authorName: string;
  readonly authorAvatar: string | null;
}

function toView(row: FeedRow, rating: number | null): ReviewView {
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
  /**
   * The page returned is the newest reviews strictly older than this cursor, where "older" is
   * `(created_at, id)` and not `created_at` alone — see `@/reviews/cursor` for why the id is
   * part of the sort key rather than a tie a strict `<` silently drops.
   */
  readonly before?: ReviewCursor;
}

/**
 * The unfiltered feed's own query — exported as a builder (not just run inline), mirroring
 * `browseQuery` (`@/league-service/browse.ts`), so `reviews.test.ts`'s "has no rating predicate
 * in the feed query at all" can inspect `feedQuery(db, {}).toSQL()` directly rather than a
 * hand-copied lookalike that could drift into asserting something production no longer runs.
 *
 * THE GUARANTEE, stated honestly: feed membership and order are independent of rating AND OF
 * REPORTS. The second half is not decoration — `POST /api/reviews/[reviewId]/report` is an
 * unmoderated write open to any signed-in account, so a `notExists(reviewReports…)` filter added
 * here would be a working curation lever built out of a signal this product deliberately treats
 * as advisory. It also contains no "rating" token and would have slipped past a test that only
 * greps for one, which is why `reviews.test.ts` asserts the TABLE SET this query touches
 * (`{reviews, users}`, exactly) rather than the absence of a word.
 *
 * `rating` is not in this SELECT list at all — not filtered out, never fetched. Ordering,
 * filtering (`removed_at IS NULL`, the only narrowing this query ever applies) and pagination
 * all happen with zero knowledge that a rating column exists. `listReviews` attaches the number
 * afterward, through `ratingsFor` below, purely for display — a rating a curator could tune is a
 * rating this query cannot even see, which is a stronger guarantee than "we checked and it's not
 * filtered": the column simply is not here to filter on.
 */
export function feedQuery(db: Db, input: ListReviewsInput) {
  // `(created_at, id) < (cursor.created_at, cursor.id)` — a row-value comparison, so the
  // boundary is decided by the same total ordering the ORDER BY below uses. A plain
  // `created_at < cursor` dropped any row sharing the boundary's millisecond.
  const cursor =
    input.before === undefined
      ? undefined
      : sql`(${reviews.createdAt}, ${reviews.id}) < (${input.before.createdAt}::timestamptz, ${input.before.id})`;
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
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
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
    reviews: page.map((row) => toView(row, ratings.get(row.id) ?? null)),
    hasMore,
    nextBefore: hasMore && last !== undefined ? formatReviewCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
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

/** What the API says when a removed author tries to write over their removed review. */
const REMOVED_REFUSAL = "Your review was removed and can't be edited.";

export type SubmitReviewResult =
  | { readonly ok: true; readonly review: ReviewView }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Writes the caller's own review — inserted if this is their first, edited in place if they
 * already have one. `reviews.user_id` is UNIQUE, so `ON CONFLICT (user_id) DO UPDATE` is the
 * one statement that both cases need: a fresh `id` is only ever assigned on the branch that
 * actually inserts, and an edit keeps the original row's `id` and `created_at` untouched,
 * exactly what the "edits the existing review rather than adding a second" test demands.
 *
 * REMOVAL WINS. `setWhere: removed_at IS NULL` is what makes `removeReview`'s stamp mean what
 * `reviews`' schema docblock says it means: a removed review keeps "its author, its text, who
 * removed it and why", and the author of a removed review cannot overwrite the very text the
 * removal row exists to preserve. The guard is in the statement's own `WHERE`, not in a prior
 * read, for the same reason `removeReview`'s is — a removal committing between a read and this
 * write would slip straight past a check made anywhere else. When the guard bites, Postgres
 * updates nothing and `RETURNING` yields no row, so the refusal below costs one extra `SELECT`
 * only on the path that was already refused.
 */
export async function submitReview(db: Db, input: SubmitReviewInput): Promise<SubmitReviewResult> {
  const clock = input.clock ?? systemClock;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const now = new Date(clock.now());

  const [row] = await db
    .insert(reviews)
    .values({ id: newId(), userId: input.userId, rating: input.rating, body: input.body, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: reviews.userId,
      set: { rating: input.rating, body: input.body, updatedAt: now },
      setWhere: isNull(reviews.removedAt),
    })
    .returning();

  if (row === undefined) {
    const [existing] = await db.select({ removedAt: reviews.removedAt }).from(reviews).where(eq(reviews.userId, input.userId));
    if (existing !== undefined && existing.removedAt !== null) return { ok: false, status: 409, reason: REMOVED_REFUSAL };
    throw new Error(`submitReview: no row returned for user ${input.userId}.`);
  }

  const [author] = await db.select({ displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, input.userId));
  return { ok: true, review: toView({ ...row, authorName: author?.displayName ?? "A manager", authorAvatar: author?.avatarUrl ?? null }, row.rating) };
}

/**
 * The caller's own review in the three states it can be in: never written, live and editable,
 * or removed and frozen. Removal-AWARE on purpose — the previous version selected no removal
 * columns and filtered on none, so a removed author was shown an apparently-live review, told
 * "Editing replaces it.", and got a success for an edit `submitReview` now refuses outright.
 * Telling them nothing was a silent shadow-ban; this is the read half of saying so.
 */
export async function myReview(db: Db, userId: string): Promise<MyReviewState> {
  const [row] = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
      authorName: users.displayName,
      authorAvatar: users.avatarUrl,
      removedAt: reviews.removedAt,
      removalReason: reviews.removalReason,
    })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.userId))
    .where(eq(reviews.userId, userId));

  if (row === undefined) return { state: "none" };
  if (row.removedAt !== null) {
    // `null`, not a display phrase. `reason` on this contract is the STORED TOKEN
    // (`REVIEW_CONFIG.reportReasons`' values), and the fallback here was
    // "breaking the review rules" — which is a rendered PHRASE, not a token, so a
    // `removal_reason` column that is somehow empty produced a value no consumer could map and
    // that `removalPhraseFor` would then feed back through its own unrecognized-value fallback to
    // arrive at the same sentence by accident. Two different types under one field name is how a
    // future consumer that switches on the token gets a string that matches no case. The absent
    // value is absent; `ReviewComposer` renders `removalSentenceFor(null-ish)` through the same
    // mapper and lands on the generic phrase deliberately rather than coincidentally.
    return { state: "removed", reason: row.removalReason, removedAt: row.removedAt.toISOString() };
  }
  return { state: "live", review: toView(row, row.rating) };
}

export interface ReportReviewInput {
  readonly reviewId: string;
  readonly reporterUserId: string;
  readonly reason: string;
  readonly clock?: Clock;
  /** Injected so a test can control the raised flag's own id. `crypto.randomUUID` at the edge. */
  readonly newId?: () => string;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

export type ReportReviewResult = { readonly ok: true } | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * In-product moderation SIGNAL, not moderation ACTION (ruling 18: no admin role exists to act on
 * it in this phase) — but as of this task it is also the queue's first consumer's own trigger:
 * every report raises (or confirms) a `review_report` flag in `integrity_flags`, the thing an
 * operator actually reads. `review_reports` stays the insert-only signal it always was; the flag
 * is the decision, and the queue derives the count from `review_reports` at read time rather than
 * storing one (ruling 5) — that is why `evidence` below is `{}` rather than a copy of `reason`.
 *
 * Idempotent by primary key: `review_reports`' primary key is `(review_id, reporter_user_id)`, so
 * `ON CONFLICT DO NOTHING` makes reporting the same review twice the SAME report rather than a
 * duplicate row or a 409 — the caller's second click is not an error, it is confirmation of the
 * first. `raiseFlag` is idempotent on the open-subject index the same way (a second reporter's
 * report — or the SAME reporter's second click — confirms the open flag rather than duplicating
 * it), so however many people report the same review, exactly one open flag exists for it.
 *
 * The report row and the flag commit together, or neither does: a report that produced no queue
 * entry is exactly the silence this residual exists to end (ruling 12 — a report is a signal INTO
 * system logic; a member never aims a flag directly).
 */
export async function reportReview(db: Db, input: ReportReviewInput): Promise<ReportReviewResult> {
  const [review] = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, input.reviewId));
  if (review === undefined) return { ok: false, status: 404, reason: "That review is no longer here." };

  const clock = input.clock ?? systemClock;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const audit = input.audit ?? getAuditLogger();

  await db.transaction(async (tx) => {
    await tx
      .insert(reviewReports)
      .values({ reviewId: input.reviewId, reporterUserId: input.reporterUserId, reason: input.reason, createdAt: new Date(clock.now()) })
      .onConflictDoNothing();
    await raiseFlag(tx, {
      flagType: "review_report",
      subjectId: input.reviewId,
      leagueId: null,
      evidence: {},
      raisedByUserId: input.reporterUserId,
      occurredAt: clock.now(),
      newId,
      audit,
    });
  });
  return { ok: true };
}

export interface RemoveReviewInput {
  readonly reviewId: string;
  readonly removedByUserId: string;
  readonly reason: string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test can force its failure. */
  readonly notify?: typeof notifyAffectedMember;
  /**
   * The flag this removal resolves, when it was reached through `resolveFlag`'s `content_removed`
   * decision (`@/integrity-service/flags`) rather than run directly from the operator script.
   * `undefined` on the script's own door — it resolves no flag — and stamped on the
   * `review_removed` audit event's payload otherwise, so that record traces back to the flag that
   * triggered it without a second lookup.
   */
  readonly flagId?: string;
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
 * row keeps its author, its text, who removed it and why. TWO doors call this now: the operator
 * script (`scripts/remove-review.ts`, via `removeReview` below) and `resolveFlag`'s
 * `content_removed` decision (`@/integrity-service/flags`, via this function directly) — there is
 * still no admin UI and no staff role beyond those two, by design.
 *
 * `tx`, not `db`: this is the seam `removeReview` used to run as its own top-level
 * `db.transaction`, extracted so `resolveFlag` can run it INSIDE its own transaction instead of a
 * transaction-inside-a-transaction (a savepoint, with different failure semantics) — the same
 * two-door shape `joinLeagueInTx` (`@/league-service/join.ts`) already uses for exactly this
 * reason. `src/review-service` is a gated directory, so both doors — this function and
 * `removeReview`'s thin wrapper below — are covered by the same test suite by construction.
 *
 * The no-re-stamp invariant is enforced HERE, in the `UPDATE`'s own `WHERE` clause
 * (`isNull(reviews.removedAt)`), not just in the script's pre-confirmation read — the same
 * "judge by this write's own returned rows, not a prior read" discipline `toggleReaction`
 * (`@/chat-service/chat.ts`) uses. Two concurrent removal attempts for the same review serialize
 * on the row lock: whichever commits first wins, and the second's `UPDATE` matches zero rows
 * because Postgres re-evaluates `removed_at IS NULL` against the now-committed row before it can
 * match — so a second operator can never silently overwrite the first one's reason and timestamp.
 * Reached through `resolveFlag`, that "zero rows" outcome (already removed, or a ghost id) is a
 * refusal `resolveFlag` propagates as its own `{ ok: false }` and rolls its whole transaction back
 * with — the flag stays open rather than being stamped "resolved: content_removed" for a removal
 * that never actually landed.
 *
 * Records `review_removed` on the PLATFORM chain, INSIDE the same transaction as the stamp, and
 * only on the branch that actually landed one — a re-stamp attempt that the `WHERE` clause
 * refuses is not a removal and must record nothing, the same "judged by this write's own
 * returned rows" rule the stamp itself uses.
 *
 * Task 7's second real sender: the `--reason` this script has always taken has been "author-
 * facing copy" since Phase 2 with nowhere for the author to read it. `notifyAffectedMember` joins
 * the same transaction as the stamp and the audit event. What the author reads is not the
 * stored `--reason` but the phrase it maps to (`removalPhraseFor`, applied at every render by
 * `quoteFor`): the reason has been one of three platform-authored tokens since the script closed
 * it to `REVIEW_CONFIG.reportReasons`, and "other" is not a sentence to show a person under the
 * words "We removed your review". The durable row is this task's whole delivery; a live nudge is
 * moot here regardless (a removal has no league, and ruling 13 sends no frame for one anyway) —
 * the author's next inbox load is the honest delivery.
 *
 * `REVIEW_CONFIG.removalReason.maxLength` is enforced HERE, not only in the script's own
 * `parseArgs` — this function, not the CLI, is the actual boundary any caller (the script, or
 * `resolveFlag`'s operator-supplied note) would hit, and `reason` is stored as given and
 * rendered, through the mapper, on a member's own notice. Checked first, before any write, same
 * "fail fast, no partial write" shape as the two lookup failures below.
 */
export async function removeReviewInTx(tx: DbTx, input: RemoveReviewInput): Promise<RemoveReviewResult> {
  if (input.reason.length > REVIEW_CONFIG.removalReason.maxLength) {
    return { ok: false, reason: `--reason must be ${REVIEW_CONFIG.removalReason.maxLength} characters or fewer.` };
  }

  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const now = new Date(clock.now());

  const [row] = await tx
    .update(reviews)
    .set({ removedAt: now, removedByUserId: input.removedByUserId, removalReason: input.reason })
    .where(and(eq(reviews.id, input.reviewId), isNull(reviews.removedAt)))
    .returning({ id: reviews.id, userId: reviews.userId, removedByUserId: reviews.removedByUserId, removalReason: reviews.removalReason, removedAt: reviews.removedAt });

  if (row !== undefined && row.removedAt !== null && row.removedByUserId !== null && row.removalReason !== null) {
    // The notice FIRST, the anchor LAST (ruling 3, as restated in `audit-logger.ts`): this
    // insert takes an implicit `FOR KEY SHARE` on the author's `users` row, and a lock taken
    // after the anchor is a lock taken in the wrong order whether or not anything competes for
    // it today. `attachAuditEvent` then stamps the event id in a statement that touches only
    // `member_notices` and only a column with no foreign key on it.
    const notice = await notify(tx, {
      leagueId: null,
      userId: row.userId,
      noticeType: "review_removed",
      context: { reason: row.removalReason },
      occurredAt: clock.now(),
      auditEventId: null,
    });
    const event = await audit.record(tx, {
      eventType: "review_removed",
      actorId: row.removedByUserId,
      actorType: "user",
      leagueId: null,
      payload: { reviewId: row.id, authorUserId: row.userId, reason: row.removalReason, flagId: input.flagId ?? null },
      occurredAt: clock.now(),
    });
    await attachAuditEvent(tx, notice, event.eventId);
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
  // second SELECT (still inside this transaction, so it costs nothing when the write
  // succeeds) tells the two apart for a message that actually helps whichever door called this.
  const [existing] = await tx.select({ removedAt: reviews.removedAt }).from(reviews).where(eq(reviews.id, input.reviewId));
  if (existing === undefined) return { ok: false, reason: `No review with id "${input.reviewId}".` };
  return { ok: false, reason: `Review "${input.reviewId}" is already removed.` };
}

/**
 * The operator script's own door (`scripts/remove-review.ts`): opens its own transaction and runs
 * `removeReviewInTx` inside it, exactly the way it always worked before the seam above split out
 * — behavior-neutral for this caller by construction. `resolveFlag` is the other door, and calls
 * `removeReviewInTx` directly, inside its OWN transaction, instead of this wrapper.
 */
export async function removeReview(db: Db, input: RemoveReviewInput): Promise<RemoveReviewResult> {
  return db.transaction((tx) => removeReviewInTx(tx, input));
}
