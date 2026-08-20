import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { memberNotices } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { renderNotice, type NoticeContexts, type NoticeType } from "@/integrity/notices";

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
  /** The audit event this notice explains. No FK — see `member_notices`' own docblock. */
  readonly auditEventId: string;
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
 * write that then rolled back is a lie told to a member. The durable row IS this task's delivery
 * — the inbox reads it on next load (`listNotices` below). A best-effort LIVE frame, on a
 * per-user stream key with no copy in the payload (ruling 13), is Task 8's job: it generalizes
 * `subscribe` to take a stream key rather than a league id, which does not exist yet.
 *
 * A caller that cannot resolve who to notify (an owner lookup that finds no row) never reaches
 * this function at all — see `src/draft-service/store.ts` — so there is no "notify nobody" branch
 * here to get wrong.
 */
export async function notifyAffectedMember<T extends NoticeType>(
  tx: DbTx,
  input: NotifyInput<T>,
  deps: { readonly newId: () => string } = { newId: () => crypto.randomUUID() },
): Promise<MemberNotice> {
  const rendered = renderNotice(input.noticeType, input.context);
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
