import { and, eq, isNull } from "drizzle-orm";
import type { ChatMessageView } from "@/chat/contract";
import type { Db, DbTx } from "@/db/client";
import { chatMessageReports, chatMessages, leagues, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { raiseFlag } from "@/integrity-service/flags";
import { attachAuditEvent, notifyAffectedMember } from "@/integrity-service/notify";
import { getPublisher } from "@/lib/realtime/publisher";
import type { PublishFn } from "@/lib/realtime/publish";
import { REVIEW_CONFIG } from "@/reviews/config";
import { publishQuietly, toView, type MessageRow, type PublishErrorSink } from "./chat";

const systemClock: Clock = { now: () => new Date().toISOString() };

export interface ReportMessageInput {
  /** The reported message. A member may only report what they can see (`withLeagueMemberActor`
   *  proves membership; this scopes the lookup to the SAME league so a guessed id from another
   *  league is a 404, not a report). */
  readonly messageId: string;
  readonly leagueId: string;
  readonly reporterUserId: string;
  readonly reason: string;
  readonly clock?: Clock;
  /** Injected so a test can control the raised flag's own id. `crypto.randomUUID` at the edge. */
  readonly newId?: () => string;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

export type ReportMessageResult = { readonly ok: true } | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * `reportReview`'s exact shape (`@/review-service/reviews`), applied to the other table: an
 * in-product moderation SIGNAL, not an ACTION (ruling 12 — a member never aims a flag directly).
 * `chat_message_reports` copies `review_reports` exactly, composite PK included, so a second
 * report from the same reporter is confirmation rather than a duplicate (`onConflictDoNothing`),
 * and `raiseFlag` is idempotent on the open-subject index the same way — however many people
 * report the same message, exactly one open `chat_report` flag exists for it.
 *
 * The flag's own `leagueId` is `null` (ruling 1): `review_report`/`chat_report` flags are
 * platform-scoped, never league-scoped, so the queue's `flag_raised` event never appears in any
 * league activity feed. `leagueId` on THIS input exists only to scope the message lookup — "you
 * may report what you can see, and only that" — not to travel into the flag.
 *
 * The report row and the flag commit together, or neither does — the same transaction proof
 * `reportReview` holds to.
 */
export async function reportMessage(db: Db, input: ReportMessageInput): Promise<ReportMessageResult> {
  const messageId = Number(input.messageId);
  const [message] = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.leagueId, input.leagueId)));
  if (message === undefined) return { ok: false, status: 404, reason: "That message is no longer here." };

  const clock = input.clock ?? systemClock;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const audit = input.audit ?? getAuditLogger();

  await db.transaction(async (tx) => {
    await tx
      .insert(chatMessageReports)
      .values({ messageId, reporterUserId: input.reporterUserId, reason: input.reason, createdAt: new Date(clock.now()) })
      .onConflictDoNothing();
    await raiseFlag(tx, {
      flagType: "chat_report",
      subjectId: input.messageId,
      leagueId: null, // platform chain — ruling 1, mirrors review_report exactly
      evidence: {},
      raisedByUserId: input.reporterUserId,
      occurredAt: clock.now(),
      newId,
      audit,
    });
  });
  return { ok: true };
}

export interface RemoveChatMessageInput {
  readonly messageId: string;
  readonly removedByUserId: string;
  readonly reason: string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test can force its failure. */
  readonly notify?: typeof notifyAffectedMember;
  /** Defaults to the real publisher. Injectable so a test can assert the swallow, mirroring `PostMessageInput.publish`. */
  readonly publish?: PublishFn;
  readonly onPublishError?: PublishErrorSink;
  /** The flag this removal resolves — stamped on the `admin_action` audit event's payload. `resolveFlag` (`@/integrity-service/flags`) is this function's only caller today; there is no operator-script door for chat the way `scripts/remove-review.ts` is one for reviews. */
  readonly flagId?: string;
}

export interface ChatRemovalRecord {
  readonly messageId: string;
  readonly leagueId: string;
  readonly userId: string;
  readonly removedByUserId: string;
  readonly reason: string;
  readonly removedAt: string;
}

export type RemoveChatMessageResult =
  | { readonly ok: true; readonly record: ChatRemovalRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * `removeReviewInTx`'s four load-bearing properties (`@/review-service/reviews`), applied to the
 * other table: the no-re-stamp guard in the `UPDATE`'s own `WHERE` (`isNull(chatMessages.
 * removedAt)`), the length check before the transaction opens, the ordering inside it (notice
 * first, anchor last, then `attachAuditEvent`), and the audit-plus-notice firing only on the
 * branch that actually landed a stamp, judged from `RETURNING` rather than a prior read.
 *
 * `resolveFlag`'s `removeSubject` (`@/integrity-service/flags`) is the ONLY caller — there is no
 * operator-script door the way `scripts/remove-review.ts` is one for reviews, because chat has
 * no admin surface older than this task.
 *
 * Records `admin_action` on the PLATFORM chain (ruling 1), not a league-scoped event: the
 * removal is visible in the league already, in the conversation itself, which is where a member
 * reads it. `REVIEW_CONFIG.removalReason.maxLength` bounds the reason here too — the same shared
 * cap `resolveFlag` already enforces generically for every `content_removed` decision regardless
 * of subject type, checked again here as the defense in depth `removeReviewInTx`'s own docblock
 * argues for.
 *
 * Publishes the removal on the EXISTING `chat.message` event type — no new realtime event exists
 * for this (the plan's own real-time rule: "this plan adds no realtime event type"), the same
 * fold a GIF message already rides (ruling 17). `mergeMessages`' sticky-removal rule
 * (`@/chat/messages.ts`) is what keeps a stale, pre-removal frame from ever undoing this on a
 * connected client.
 */
export async function removeChatMessageInTx(tx: DbTx, input: RemoveChatMessageInput): Promise<RemoveChatMessageResult> {
  if (input.reason.length > REVIEW_CONFIG.removalReason.maxLength) {
    return { ok: false, reason: `Notes on a removal are limited to ${REVIEW_CONFIG.removalReason.maxLength} characters.` };
  }

  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const publish = input.publish ?? ((event) => getPublisher().publish(event));
  const now = new Date(clock.now());
  const messageId = Number(input.messageId);

  const [row] = await tx
    .update(chatMessages)
    .set({ removedAt: now, removedByUserId: input.removedByUserId, removalReason: input.reason })
    .where(and(eq(chatMessages.id, messageId), isNull(chatMessages.removedAt)))
    .returning({
      id: chatMessages.id,
      leagueId: chatMessages.leagueId,
      userId: chatMessages.authorUserId,
      removedByUserId: chatMessages.removedByUserId,
      removalReason: chatMessages.removalReason,
      removedAt: chatMessages.removedAt,
      createdAt: chatMessages.createdAt,
      kind: chatMessages.kind,
    });

  if (row !== undefined && row.removedAt !== null && row.removedByUserId !== null && row.removalReason !== null) {
    const [league] = await tx.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, row.leagueId));
    const leagueName = league?.name ?? row.leagueId;

    // The notice FIRST, the anchor LAST (ruling 3): this insert takes an implicit `FOR KEY
    // SHARE` on the author's `users` row and on `leagues` (a chat removal notice, unlike a
    // review's, has a real league), so it must run before the chain anchor.
    const notice = await notify(tx, {
      leagueId: row.leagueId,
      userId: row.userId,
      noticeType: "chat_message_removed",
      context: { leagueName, reason: row.removalReason },
      occurredAt: clock.now(),
      auditEventId: null,
    });
    const event = await audit.record(tx, {
      eventType: "admin_action",
      actorId: row.removedByUserId,
      actorType: "user",
      leagueId: null, // platform chain (ruling 1) — the removal is visible in the league already
      payload: {
        action: "chat_message_removed",
        messageId: String(row.id),
        leagueId: row.leagueId,
        authorUserId: row.userId,
        reason: row.removalReason,
        flagId: input.flagId ?? null,
      },
      occurredAt: clock.now(),
    });
    await attachAuditEvent(tx, notice, event.eventId);

    // Best-effort live fan-out, same "Postgres already holds the write" discipline `postMessage`
    // and `toggleReaction` use — the ONLY thing left in this transaction after this point is the
    // outer `flag_resolved` anchor append `resolveFlag` performs, which touches no row this
    // removal's own readers care about.
    const [author] = await tx.select({ displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, row.userId));
    const [team] = await tx.select({ name: teams.name }).from(teams).where(and(eq(teams.leagueId, row.leagueId), eq(teams.userId, row.userId)));
    const removedRow: MessageRow = {
      id: row.id,
      authorUserId: row.userId,
      authorName: team?.name ?? author?.displayName ?? "A manager",
      authorAvatarUrl: author?.avatarUrl ?? null,
      body: "",
      createdAt: row.createdAt,
      kind: row.kind,
      gifUrl: null,
      gifPreviewUrl: null,
      gifAlt: null,
      gifWidth: null,
      gifHeight: null,
      removedAt: row.removedAt,
    };
    const message: ChatMessageView = toView(removedRow, []);
    await publishQuietly(publish, { leagueId: row.leagueId, type: "chat.message", payload: { message } }, input.onPublishError);

    return {
      ok: true,
      record: { messageId: String(row.id), leagueId: row.leagueId, userId: row.userId, removedByUserId: row.removedByUserId, reason: row.removalReason, removedAt: row.removedAt.toISOString() },
    };
  }

  // The UPDATE matched nothing — either no message has this id, or it's already removed. A
  // second SELECT (still inside this transaction, so it costs nothing when the write succeeds)
  // tells the two apart, the identical shape `removeReviewInTx`'s own zero-rows branch uses.
  const [existing] = await tx.select({ removedAt: chatMessages.removedAt }).from(chatMessages).where(eq(chatMessages.id, messageId));
  if (existing === undefined) return { ok: false, reason: `No message with id "${input.messageId}".` };
  return { ok: false, reason: `Message "${input.messageId}" is already removed.` };
}
