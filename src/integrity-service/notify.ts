import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { memberNotices } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import { stripHiddenCharacters } from "@/identity/display-name";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { renderNotice, type NoticeContexts, type NoticeType } from "@/integrity/notices";
import { removalPhraseFor } from "@/reviews/config";
import type { PublishToUserFn } from "@/lib/realtime/publish";
import { getPublisher } from "@/lib/realtime/publisher";

/** One row of `member_notices`, exactly as it is stored. */
export interface MemberNotice {
  readonly id: string;
  readonly userId: string;
  readonly leagueId: string | null;
  readonly noticeType: NoticeType;
  readonly title: string;
  readonly body: string;
  readonly context: JsonObject;
  readonly auditEventId: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface NotifyInput<T extends NoticeType> {
  readonly leagueId: string | null;
  readonly userId: string;
  readonly noticeType: T;
  readonly context: NoticeContexts[T];
  readonly occurredAt: string;
  /**
   * The audit event this notice explains. No FK — see `member_notices`' own docblock.
   *
   * `null` means "not known yet", and it exists for one reason: ruling 3's lock order. Inserting
   * this row takes an implicit `FOR KEY SHARE` on `users` and `leagues` (Postgres locks the
   * REFERENCED row on an FK check), so the insert has to happen BEFORE the chain anchor lock,
   * which is before the append that mints the event id. The caller stamps it afterwards with
   * `attachAuditEvent` below. See `audit-logger.ts`'s LOCK ORDER note for what goes wrong
   * otherwise.
   */
  readonly auditEventId: string | null;
}

function rowToNotice(row: typeof memberNotices.$inferSelect): MemberNotice {
  return {
    id: row.id,
    userId: row.userId,
    leagueId: row.leagueId,
    noticeType: row.noticeType as NoticeType,
    title: row.title,
    body: row.body,
    context: row.context,
    auditEventId: row.auditEventId,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

/**
 * The seam every automated action in this phase calls to explain itself to the person it
 * affected. Plans B, C and D call it by this name, which is why the name is the spec's.
 *
 * The signature is an object rather than the spec's four positional parameters
 * (`notifyAffectedMember(leagueId, userId, notificationType, context)`), for two reasons: the
 * `tx` is the load-bearing part and has to come first, and two adjacent id strings in a
 * positional call is a swap waiting to happen at a call site nobody re-reads.
 *
 * It writes INSIDE the caller's transaction, exactly like the audit append: a notice about a
 * write that then rolled back is a lie told to a member. The durable row IS the delivery — the
 * inbox reads it on next load (`listNotices` below). The best-effort LIVE frame is a SEPARATE
 * step, `deliverNotice` below, called by the caller only AFTER its transaction commits — the
 * inverse of this function's own discipline: the row fails the transaction, the frame never does.
 *
 * A caller that cannot resolve who to notify (an owner lookup that finds no row) never reaches
 * this function at all — see `src/draft-service/store.ts` — so there is no "notify nobody" branch
 * here to get wrong.
 *
 * LOCK ORDER (ruling 3, as restated): this INSERT takes an implicit `FOR KEY SHARE` on the
 * `users` and `leagues` rows it references, which is a lock, and `leagues` is a row
 * `joinLeagueInTx` takes `FOR UPDATE` before it appends. So this call belongs BEFORE the chain
 * anchor, never after it — pass `auditEventId: null` and stamp it with `attachAuditEvent` once
 * the append has run. Both of this function's callers do exactly that.
 */
export async function notifyAffectedMember<T extends NoticeType>(
  tx: DbTx,
  input: NotifyInput<T>,
  deps: { readonly newId: () => string } = { newId: () => crypto.randomUUID() },
): Promise<MemberNotice> {
  // Composed, then stripped of anything a reader cannot see. The boundary schemas refuse a
  // league or team name carrying a bidi override, so nothing written from today forward can reach
  // here dirty — but this row freezes its copy forever (ruling 12) and the values interpolated
  // into it are read back out of Postgres, including rows written before those schemas had the
  // guard. A belt, over a brace that only covers what comes next. See `stripHiddenCharacters`.
  const composed = renderNotice(input.noticeType, input.context);
  const rendered = { title: stripHiddenCharacters(composed.title), body: stripHiddenCharacters(composed.body) };
  const id = deps.newId();
  const createdAt = new Date(input.occurredAt);
  const context = input.context as unknown as JsonObject;

  await tx.insert(memberNotices).values({
    id,
    userId: input.userId,
    leagueId: input.leagueId,
    noticeType: input.noticeType,
    title: rendered.title,
    body: rendered.body,
    context,
    auditEventId: input.auditEventId,
    createdAt,
    readAt: null,
  });

  return {
    id,
    userId: input.userId,
    leagueId: input.leagueId,
    noticeType: input.noticeType,
    title: rendered.title,
    body: rendered.body,
    context,
    auditEventId: input.auditEventId,
    createdAt: createdAt.toISOString(),
    readAt: null,
  };
}

/**
 * Stamps the audit event id onto a notice that had to be written before the append that produced
 * it. Same transaction, always — a notice that names no event after the commit is a delivery
 * record with no record behind it.
 *
 * THE ONE THING THIS STATEMENT MUST NOT DO is take a lock outside `member_notices`, because it
 * runs AFTER the chain anchor and ruling 3 makes the anchor the last lock. It does not: Postgres
 * re-checks a foreign key, and so locks the referenced row, only when the referencing column's
 * value actually changes, and this sets `audit_event_id` alone — which carries no foreign key at
 * all (see `member_notices`' own docblock for why). `user_id` and `league_id` are untouched.
 */
export async function attachAuditEvent(tx: DbTx, notice: MemberNotice, auditEventId: string): Promise<MemberNotice> {
  await tx.update(memberNotices).set({ auditEventId }).where(eq(memberNotices.id, notice.id));
  return { ...notice, auditEventId };
}

/**
 * Best-effort LIVE delivery, called after the caller's transaction commits — never inside it.
 * Publishing failure is never surfaced: the durable row is already written and the inbox reads
 * it on the next page load, exactly the "Postgres is authoritative, publishing is best-effort"
 * rule every other feature in this codebase already runs on (`createPublisher`'s own docblock).
 *
 * RULING 13, both halves: the frame rides `REALTIME_CONFIG.userStreamKey(notice.userId)` — a
 * league broadcast is read by every member in the room, so even a content-free frame there would
 * leak that THIS member got a notice, which for a held trade is most of the information — and it
 * carries `{ noticeId, noticeType }` only, never the rendered `title`/`body`. The words come from
 * an authenticated read of `GET /api/notices`, because a Redis stream is retained for
 * `streamMaxLen` entries and readable by anything holding the key.
 *
 * A notice with no league is not published at all: the frame exists to nudge a page that is
 * open RIGHT NOW about something happening in a league the reader is looking at, and a
 * league-less notice (e.g. `review_removed`) has no such page. It reaches the reader on their
 * next inbox load instead, which is honest and is what the inbox is for — so `removeReview`
 * (`@/review-service/reviews.ts`) never calls this at all.
 *
 * `publish` defaults to the process-wide publisher's `publishToUser`, mirroring `getAuditLogger()`
 * — injectable so a caller under test never needs a live Redis connection.
 */
export async function deliverNotice(notice: MemberNotice, publish: PublishToUserFn = getPublisher().publishToUser): Promise<void> {
  if (notice.leagueId === null) return;
  await publish({
    userId: notice.userId,
    leagueId: notice.leagueId,
    type: "notice.created",
    payload: { noticeId: notice.id, noticeType: notice.noticeType },
  });
}

export interface NoticesPage {
  readonly notices: readonly MemberNotice[];
  /** Unread count over this SAME bounded page — never the whole table. See the schema docblock. */
  readonly unreadCount: number;
}

/** One member's own notices, newest first, capped at `INTEGRITY_CONFIG.notices.inboxSize`. */
export async function listNotices(db: Db, userId: string): Promise<NoticesPage> {
  const rows = await db
    .select()
    .from(memberNotices)
    .where(eq(memberNotices.userId, userId))
    .orderBy(desc(memberNotices.createdAt))
    .limit(INTEGRITY_CONFIG.notices.inboxSize);
  const notices = rows.map(rowToNotice);
  return { notices, unreadCount: notices.filter((notice) => notice.readAt === null).length };
}

/**
 * `review_removed`'s reason, as the AUTHOR-FACING PHRASE, split out of `context` for the ONE
 * thing that renders it as its own field rather than folded into `body`'s sentence: a distinct
 * blockquote, both on `GET /api/notices` (`NoticeView.quote`) and the league activity page's own
 * "What the platform did" band.
 *
 * MAPPED, never printed raw. `context.reason` is one of `REVIEW_CONFIG.reportReasons`' three
 * values — `spam`, `abusive`, `other` — validated at `scripts/remove-review.ts` and bounded again
 * in `removeReview`. Printing the token put **"other"** inside quotation marks under the heading
 * "We removed your review", which is the single most emotionally loaded string this product
 * emits, said in the voice of a database column. `removalPhraseFor` is the same mapper
 * `ReviewComposer` already renders the same stored value through, and its own docblock has always
 * said a stored value "must not be printed raw"; this is the surface that was not obeying it.
 * The fallback in that mapper is what covers a value from outside the closed set.
 *
 * `context` is a `JsonObject`, so this narrows rather than trusts: a row whose `reason` is missing
 * or not a string (impossible through `NoticeContexts`' own type today, not impossible against a
 * row read back from Postgres) reads as no quote at all — the same discipline `activityRowFor`'s
 * payload readers use. Exported so the route and the page share one definition rather than two
 * copies agreeing by coincidence.
 *
 * `operator_warning` (Task 3) is the second quoting type: `context.note` is the operator's OWN
 * words, not a stored token to map through a phrase table — it renders VERBATIM, which is the
 * whole reason `resolveFlag` bounds its length instead of its vocabulary. Same narrowing
 * discipline as `reason` above: a row whose `note` is missing or not a string reads as no quote.
 *
 * `stripHiddenCharacters` runs on it too, same as the composed title/body above — operators are
 * trusted with what they choose to SAY, not with what a bidi override or a zero-width character
 * would make a reader's browser DO with it. `resolveFlag` writes `context.note` unstripped (it is
 * provenance, the same "keeps what it was rendered FROM" rule `notifyAffectedMember`'s own
 * `context` follows), so this is the one place that quote is ever rendered — the strip belongs
 * HERE, at render, not at the write, for the same reason `notifyAffectedMember` strips `title`/
 * `body` at compose time rather than trusting every future caller to have done it upstream. A
 * note already written clean costs nothing extra; one written before this landed, or by a future
 * caller that skips it, reads clean anyway.
 */
export function quoteFor(notice: MemberNotice): string | null {
  if (notice.noticeType === "review_removed" || notice.noticeType === "chat_message_removed") {
    const reason = notice.context.reason;
    return typeof reason === "string" ? removalPhraseFor(reason) : null;
  }
  if (notice.noticeType === "operator_warning") {
    const note = notice.context.note;
    return typeof note === "string" ? stripHiddenCharacters(note) : null;
  }
  return null;
}

export interface MarkNoticesReadInput {
  readonly userId: string;
  readonly noticeIds: readonly string[];
  readonly readAt: string;
}

/**
 * Stamps the caller's OWN notices read. `userId` is part of the `WHERE`, not a prior read — the
 * same "judge by this write's own returned rows" discipline `removeReview` uses — so an id that
 * belongs to someone else, or one already read, both match zero rows and both return 0.
 */
export async function markNoticesRead(db: Db, input: MarkNoticesReadInput): Promise<number> {
  if (input.noticeIds.length === 0) return 0;
  const rows = await db
    .update(memberNotices)
    .set({ readAt: new Date(input.readAt) })
    .where(and(eq(memberNotices.userId, input.userId), inArray(memberNotices.id, [...input.noticeIds]), isNull(memberNotices.readAt)))
    .returning({ id: memberNotices.id });
  return rows.length;
}
