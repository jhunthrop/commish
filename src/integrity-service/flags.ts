import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { auditEvents, chatMessageReports, chatMessages, integrityFlags, leagues, reviewReports, reviews, users } from "@/db/schema";
import type { AuditEvent, JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { decisionIsAvailable, RESOLUTION_DECISIONS, SUBJECT_OF, type FlagSubjectType, type FlagType, type ResolutionDecision } from "@/integrity/flags";
import type { NoticeType } from "@/integrity/notices";
import {
  flagDetailFor,
  flagTrailRowFor,
  queueRowFor,
  type FlagCursor,
  type FlagDetail,
  type FlagSubjectView,
  type QueueRow,
  type ReporterView,
} from "@/integrity/queue-view";
import { removeChatMessageInTx } from "@/chat-service/moderation";
import { getPublisher } from "@/lib/realtime/publisher";
import type { PublishFn } from "@/lib/realtime/publish";
import { removeReviewInTx } from "@/review-service/reviews";
import { REVIEW_CONFIG } from "@/reviews/config";
import { attachAuditEvent, notifyAffectedMember } from "./notify";
import { getAuditLogger, type AuditLogger } from "./audit-logger";

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * The sentinel `--by` value that authorizes the FIRST grant on a fresh database, when there is by
 * definition no existing operator to name (ruling 15 leaves no in-product door, so the very first
 * grant has no admin session behind it either). Legal exactly once per database — see the
 * bootstrap check below, which is a check rather than a convention.
 */
export const BOOTSTRAP_ACTOR = "bootstrap";

export interface GrantAdminInput {
  readonly userId: string;
  /** `true` grants, `false` revokes — one function, one toggle, not two near-duplicate ones. */
  readonly grant: boolean;
  /** An existing operator's `users.id`, or the literal `BOOTSTRAP_ACTOR` for the first grant. */
  readonly grantedBy: string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test can force its failure. */
  readonly notify?: typeof notifyAffectedMember;
}

export type GrantAdminResult = { readonly ok: true; readonly userId: string; readonly isAdmin: boolean } | { readonly ok: false; readonly reason: string };

/**
 * Grant or revoke operator access. The ONLY writer of `users.isAdmin` — `scripts/grant-admin.ts`
 * is the only caller, by ruling 15's design, and the source-scan tripwire in
 * `src/data/seed/seed-operator.test.ts` catches an accidental second writer in its idiomatic
 * spelling (rather than trusting that no one adds one).
 *
 * `--by bootstrap` is legal exactly once per database and is CHECKED, not trusted: the statement
 * below refuses it if any admin already exists. After that, an existing operator's id is
 * required, so the grant chain is walkable in the audit log from the first admin forward.
 *
 * The toggle's own guard lives in the `UPDATE`'s `WHERE` (`eq(users.isAdmin, !input.grant)`), the
 * same "judge by this write's own returned rows" discipline `removeReview` uses: a second
 * `--revoke` on an already-revoked account (or a second grant on an already-granted one) matches
 * zero rows and reports that honestly instead of writing a duplicate audit event about a change
 * that did not happen.
 *
 * LOCK ORDER (ruling 3, as restated in `audit-logger.ts`): the notice — on the grant branch only,
 * since a revoke tells nobody anything (there is nothing to explain removing a privilege the
 * member is not using differently) — is written BEFORE the chain anchor, and `attachAuditEvent`
 * stamps the event id afterwards. Same shape as `removeReview`.
 */
export async function grantAdmin(db: Db, input: GrantAdminInput): Promise<GrantAdminResult> {
  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;

  return db.transaction(async (tx) => {
    if (input.grantedBy === BOOTSTRAP_ACTOR) {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).limit(1);
      if (existing !== undefined) return { ok: false, reason: "This database already has an operator. Pass --by <their user id>." };
    }

    const [subject] = await tx
      .update(users)
      .set({ isAdmin: input.grant })
      .where(and(eq(users.id, input.userId), eq(users.isAdmin, !input.grant)))
      .returning({ id: users.id });
    if (subject === undefined) return { ok: false, reason: `"${input.userId}" is not a user, or already has that setting.` };

    const notice = input.grant
      ? await notify(tx, {
          leagueId: null,
          userId: subject.id,
          noticeType: "admin_granted",
          context: { grantedByUserId: input.grantedBy },
          occurredAt: clock.now(),
          auditEventId: null,
        })
      : null;
    const event = await audit.record(tx, {
      eventType: "admin_action",
      actorId: input.grantedBy === BOOTSTRAP_ACTOR ? null : input.grantedBy,
      actorType: input.grantedBy === BOOTSTRAP_ACTOR ? "system" : "user",
      leagueId: null,
      payload: { action: input.grant ? "admin_granted" : "admin_revoked", subjectUserId: subject.id },
      occurredAt: clock.now(),
    });
    if (notice !== null) await attachAuditEvent(tx, notice, event.eventId);
    return { ok: true, userId: subject.id, isAdmin: input.grant };
  });
}

/**
 * The queue's own row, as it is raised — `resolved_at` and everything Task 3 stamps alongside it
 * are deliberately absent here: `raiseFlag` never writes them, so a shape that named them would
 * describe a state this function cannot produce (ruling 4).
 */
export interface IntegrityFlag {
  readonly id: string;
  readonly flagType: FlagType;
  readonly subjectType: FlagSubjectType;
  readonly subjectId: string;
  readonly leagueId: string | null;
  readonly evidence: JsonObject;
  readonly raisedAt: string;
}

export interface RaiseFlagInput {
  readonly flagType: FlagType;
  /** The reviewed thing. For `account_pair`, the two user ids joined low-id-first (ruling 28). */
  readonly subjectId: string;
  /** Where it happened. Not a chain scope — see `integrityFlags`' own docblock. */
  readonly leagueId: string | null;
  readonly evidence: JsonObject;
  /** A reporter's `users.id`, or `null` when the platform's own sweep raised it. */
  readonly raisedByUserId: string | null;
  readonly occurredAt: string;
  readonly newId: () => string;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

export type RaiseFlagResult = IntegrityFlag;

function toFlag(row: typeof integrityFlags.$inferSelect): IntegrityFlag {
  return {
    id: row.id,
    flagType: row.flagType as FlagType,
    subjectType: row.subjectType as FlagSubjectType,
    subjectId: row.subjectId,
    leagueId: row.leagueId,
    evidence: row.evidence,
    raisedAt: row.raisedAt.toISOString(),
  };
}

/**
 * The confirmation path: a second insert on an already-open subject matched the partial unique
 * index and wrote nothing, so this reads back the row that already answers the question.
 *
 * The `row === undefined` branch is unreachable through real Postgres — the conflict that sent
 * `raiseFlag` here is proof an open row exists — and is covered by a stub `DbTx` test, the same
 * "impossible-state guard" discipline `AuditLogger.record`'s `lockAnchor` uses.
 */
async function existingOpenFlagFor(tx: DbTx, input: RaiseFlagInput): Promise<IntegrityFlag> {
  const subjectType = SUBJECT_OF[input.flagType];
  const [row] = await tx
    .select()
    .from(integrityFlags)
    .where(and(eq(integrityFlags.subjectType, subjectType), eq(integrityFlags.subjectId, input.subjectId), isNull(integrityFlags.resolvedAt)));
  if (row === undefined) {
    throw new Error(`raiseFlag conflicted on an open flag for ${subjectType}:${input.subjectId} that is no longer there.`);
  }
  return toFlag(row);
}

/**
 * Raise a flag. Idempotent on the open-subject index: a second call about the same open subject
 * returns the existing flag rather than failing or duplicating, because a second report IS
 * confirmation and a second detector run finding the same pair is not news.
 *
 * The audit event goes on the PLATFORM chain, never a league chain (ruling 1). A record about a
 * person under review is not the league's business, and `audit_events.league_id` is what decides
 * chain scope (`scopeFor`), so the league id lives in the payload instead. The consequence is
 * deliberate: `flag_raised` cannot appear in any league activity feed even if a future author
 * flips its `ACTIVITY_VISIBILITY`, because platform-chain events are never read by
 * `listLeagueActivity` at all.
 *
 * ruling 12: every caller is a system path — a detector's sweep, or a report route that has
 * already validated its own input and calls this from inside its own transaction. There is no
 * route that lets a member raise a flag directly; `raisedByUserId` names a reporter, not an
 * accuser aiming this function at someone.
 *
 * LOCK ORDER (ruling 3): this insert carries a foreign key to `leagues`, so it takes an implicit
 * `FOR KEY SHARE` on that row — the same class of lock `member_notices`' insert takes — and must
 * therefore run BEFORE the chain anchor, never after. It is the only write in this function, so
 * that ordering is automatic here rather than something a caller has to sequence by hand.
 */
export async function raiseFlag(tx: DbTx, input: RaiseFlagInput): Promise<RaiseFlagResult> {
  const audit = input.audit ?? getAuditLogger();

  const [row] = await tx
    .insert(integrityFlags)
    .values({
      id: input.newId(),
      flagType: input.flagType,
      subjectType: SUBJECT_OF[input.flagType],
      subjectId: input.subjectId,
      leagueId: input.leagueId,
      evidence: input.evidence,
      raisedAt: new Date(input.occurredAt),
    })
    .onConflictDoNothing({ target: [integrityFlags.subjectType, integrityFlags.subjectId], where: isNull(integrityFlags.resolvedAt) })
    .returning();

  if (row === undefined) return existingOpenFlagFor(tx, input); // the confirmation path: no second event

  await audit.record(tx, {
    eventType: "flag_raised",
    actorId: input.raisedByUserId, // a reporter, or null when the platform's own sweep raised it
    actorType: input.raisedByUserId === null ? "system" : "user",
    leagueId: null, // platform chain — ruling 1
    payload: { flagId: row.id, flagType: row.flagType, subjectType: row.subjectType, leagueId: input.leagueId },
    occurredAt: input.occurredAt,
  });
  return toFlag(row);
}

export interface ResolveFlagInput {
  readonly flagId: string;
  readonly decision: ResolutionDecision;
  /**
   * The operator's own words. Bound by `INTEGRITY_CONFIG.moderation.noteMaxLength` below, NOT by
   * `src/integrity/copy-rules.ts`'s denylist — that rulebook binds PLATFORM copy (the templates
   * `notices.ts` composes), and this is the operator speaking in their own voice, quoted rather
   * than paraphrased, the same distinction `operator_warning`'s own docblock draws.
   */
  readonly note: string;
  readonly operatorUserId: string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
  /** Defaults to the real `notifyAffectedMember`. Injectable so a test can force its failure. */
  readonly notify?: typeof notifyAffectedMember;
  /**
   * Defaults to the real publisher. Threaded through to `removeChatMessageInTx` on a
   * `content_removed` decision against a `chat_message` subject — the ONLY decision this input
   * ever reaches a realtime publish from, mirroring `PostMessageInput.publish`'s own required-DI
   * shape rather than `audit`/`notify`'s optional one, because a test asserting the swallow needs
   * to inject a recorder the same way `chat.test.ts` already does.
   */
  readonly publish?: PublishFn;
}

export type ResolveFlagResult =
  | { readonly ok: true; readonly flagId: string; readonly decision: ResolutionDecision }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Which flag types get NOTICED at all when THIS decision resolves them, and with what notice
 * type — exhaustive over every declared `ResolutionDecision`, so a decision landing later with no
 * entry here fails to compile rather than silently inheriting "tell nobody" (the same deny-by-
 * default shape `ACTIVITY_VISIBILITY` uses).
 *
 * `no_action` is `null` ON PURPOSE (ruling 6): an investigation that closed with nothing
 * happening is not an event in the member's life, and "we looked into you and found nothing" is
 * precisely the accusation `INTEGRITY_CONFIG.notices.accusatoryTerms` exists to keep out of this
 * product.
 *
 * `content_removed` is ALSO `null` here — not because it notices nobody, but because its own
 * remover (`removeReview` and its `chat-service` sibling, landing in Tasks 4 and 6) already sends
 * its own notice inside the SAME transaction (`review_removed`, and the chat equivalent). A
 * second notice from here would tell the member twice about one decision.
 *
 * `trade_reversed` is unreachable today — `decisionIsAvailable` refuses it before this table is
 * ever read — and stays `null` rather than naming a notice type this plan does not own.
 */
const NOTICE_FOR_DECISION: Readonly<Record<ResolutionDecision, NoticeType | null>> = {
  no_action: null,
  warned_user: "operator_warning",
  content_removed: null,
  trade_reversed: null,
};

/**
 * The phrase an already-resolved flag's OWN stored decision reads as, in the 409 a second
 * operator gets. Exhaustive over every declared decision for the same reason `NOTICE_FOR_DECISION`
 * above is: a decision with no entry here cannot compile, so this message can never fall back to
 * printing a raw stored token at an operator.
 */
const DECISION_LABEL: Readonly<Record<ResolutionDecision, string>> = {
  no_action: "no action",
  warned_user: "a warning",
  content_removed: "content removed",
  trade_reversed: "a trade reversal",
};

/**
 * The zero-rows branch of the stamp `UPDATE` in `resolveFlag` below: either no flag has this id,
 * or one already does — read back, inside the SAME transaction, to tell an operator which. The
 * same "judged by this write's own returned rows, one extra `SELECT` only on the refused path"
 * shape `removeReview` uses for its own already-removed check.
 */
async function alreadyResolvedOrMissing(tx: DbTx, flagId: string): Promise<ResolveFlagResult> {
  const [existing] = await tx.select({ resolution: integrityFlags.resolution }).from(integrityFlags).where(eq(integrityFlags.id, flagId));
  if (existing === undefined) return { ok: false, status: 404, reason: `No flag with id "${flagId}".` };

  const decision = existing.resolution;
  if (decision === null || !(RESOLUTION_DECISIONS as readonly string[]).includes(decision)) {
    // Unreachable through real Postgres: `resolution` is set in the SAME statement as
    // `resolved_at`, atomically, so a row this SELECT finds with `resolved_at` non-null (the only
    // way execution reaches here) always has a `resolution` from the closed set too. Same
    // "impossible-state guard, proved by a stub" discipline `raiseFlag`'s `existingOpenFlagFor` uses.
    throw new Error(`resolveFlag: flag "${flagId}" is resolved with no recognizable decision recorded — this should be impossible.`);
  }
  return {
    ok: false,
    status: 409,
    reason: `That flag was already resolved as "${DECISION_LABEL[decision as ResolutionDecision]}". A different decision is a new flag, not an edit.`,
  };
}

/**
 * The one case `removeSubject` below refuses to let `resolveFlag`'s transaction commit through:
 * `removeReviewInTx` (and, from Task 6, its chat sibling) answers a graceful `{ ok: false }` for
 * an ordinary, expected refusal — already removed, or a ghost id — and that refusal must roll
 * `resolveFlag`'s WHOLE transaction back (the flag's own stamp `UPDATE` included), not just skip
 * a step. Throwing is the only way to force that rollback from inside a `db.transaction`
 * callback; this class is what lets `resolveFlag` tell that throw apart from every OTHER one
 * (an unwired subject type, a failed audit append) that must keep propagating as a rejected
 * promise rather than becoming a normal `{ ok: false }` result.
 */
class ContentRemovalRefused extends Error {
  constructor(
    readonly status: number,
    reason: string,
  ) {
    super(reason);
  }
}

/**
 * `content_removed`'s actual removal, dispatched by the flag's own `subjectType`. `review` was
 * wired first (Task 4): it calls `removeReviewInTx` (`@/review-service/reviews`) INSIDE
 * `resolveFlag`'s own transaction, passing the operator as `removedByUserId` and the operator's
 * note as the removal reason. `chat_message` (Task 6) calls `removeChatMessageInTx`
 * (`@/chat-service/moderation`) the identical way. Both removers already write their own audit
 * event and their own notice, and nothing about either path changes here, which is the whole
 * reason both are built as a stamp.
 *
 * A refusal from either remover (already removed, or a ghost id) is re-thrown as
 * `ContentRemovalRefused` rather than returned — see that class's own docblock — so `resolveFlag`
 * rolls its stamp back and answers a normal `{ ok: false }` instead of committing a flag stamped
 * "resolved: content_removed" for a removal that never landed.
 *
 * `account_pair`/`trade` still throw a plain `Error`, unwired by design (neither this plan nor
 * Plan C's `trade_reversed` removes content for those subject types): by the time this runs,
 * `resolveFlag`'s stamp `UPDATE` has already applied inside this same transaction, and the ONLY
 * way to undo it is Postgres's own `ROLLBACK` on a rejected promise — the identical audit-fails-
 * the-tx discipline `raiseFlag` and `grantAdmin` already lean on for a failed `audit.record`. A
 * caller getting back a flag stamped "resolved: content_removed" with no removal performed and
 * no `flag_resolved` event to explain it would be exactly the hole in the record this whole plan
 * exists to close.
 */
async function removeSubject(
  tx: DbTx,
  subjectType: FlagSubjectType,
  opts: {
    readonly subjectId: string;
    readonly flagId: string;
    readonly operatorUserId: string;
    readonly reason: string;
    readonly clock: Clock;
    readonly audit: AuditLogger;
    readonly notify: typeof notifyAffectedMember;
    readonly publish: PublishFn;
  },
): Promise<void> {
  if (subjectType === "review") {
    const result = await removeReviewInTx(tx, {
      reviewId: opts.subjectId,
      removedByUserId: opts.operatorUserId,
      reason: opts.reason,
      clock: opts.clock,
      audit: opts.audit,
      notify: opts.notify,
      flagId: opts.flagId,
    });
    if (!result.ok) throw new ContentRemovalRefused(409, result.reason);
    return;
  }
  if (subjectType === "chat_message") {
    const result = await removeChatMessageInTx(tx, {
      messageId: opts.subjectId,
      removedByUserId: opts.operatorUserId,
      reason: opts.reason,
      clock: opts.clock,
      audit: opts.audit,
      notify: opts.notify,
      publish: opts.publish,
      flagId: opts.flagId,
    });
    if (!result.ok) throw new ContentRemovalRefused(409, result.reason);
    return;
  }
  throw new Error(`resolveFlag: content_removed has no remover wired for subject type "${subjectType}".`);
}

/**
 * Who reads the operator's own words when a decision notices anyone at all: the author of the
 * flagged content, resolved from the flag's own SUBJECT rather than trusted from the caller — an
 * operator's claim about "who this affects" is exactly the kind of unchecked input a moderation
 * surface must not take on faith. Only the two report-driven subject types name a single,
 * unambiguous author; `account_pair` names two accounts and `trade` names a transaction, and
 * neither is a subject this plan's notice-bearing decision (`warned_user`) is ever sent for.
 */
async function affectedMemberFor(tx: DbTx, subjectType: FlagSubjectType, subjectId: string): Promise<string> {
  if (subjectType === "review") {
    const [author] = await tx.select({ userId: reviews.userId }).from(reviews).where(eq(reviews.id, subjectId));
    if (author === undefined) throw new Error(`resolveFlag: no review "${subjectId}" for a flag that named it as the subject.`);
    return author.userId;
  }
  if (subjectType === "chat_message") {
    const [author] = await tx.select({ authorUserId: chatMessages.authorUserId }).from(chatMessages).where(eq(chatMessages.id, Number(subjectId)));
    if (author === undefined) throw new Error(`resolveFlag: no chat message "${subjectId}" for a flag that named it as the subject.`);
    return author.authorUserId;
  }
  throw new Error(`resolveFlag: "${subjectType}" has no single affected member to notice.`);
}

/**
 * The league name `operator_warning`'s body interpolates. `leagueId` is nullable on the flag row
 * — a `review_report` flag has none, because reviews are platform-scoped, not league-scoped — so
 * this covers both. The fallback wording only matters for a `warned_user` decision on a
 * leagueless flag, a combination no caller exercises today, but the notice this feeds must not
 * crash composing itself if one ever is.
 */
async function leagueNameForFlag(tx: DbTx, leagueId: string | null): Promise<string> {
  if (leagueId === null) return "your league";
  const [league] = await tx.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, leagueId));
  return league?.name ?? leagueId;
}

/**
 * ONE WAY, ONCE, AND THE AUDIT EVENT IS THE RECORD.
 *
 * The note is the operator's own words and reaches the member verbatim when the decision is
 * `warned_user`, the same call `removalPhraseFor` already made in Phase 2: an operator writing
 * copy a member reads should know they are doing it.
 *
 * There is NO appeal path (founder decision 4), and the notice says where the decision came from
 * rather than implying a reply channel that does not exist.
 *
 * ONE WAY: the guard lives in the stamp `UPDATE`'s own `WHERE` (`isNull(resolvedAt)`), not in a
 * prior read — the same "judge by this write's own returned rows" discipline `toggleReaction` and
 * `removeReview` use. Two operators resolving the same flag at the same instant serialize on the
 * row lock; the loser's `UPDATE` matches zero rows because Postgres re-evaluates the `WHERE`
 * against the now-committed winner before it can match, so the second decision is refused rather
 * than silently overwriting the first.
 *
 * ONCE: refuses outright (before any write) a decision no plan in this phase owns
 * (`decisionIsAvailable`), a `content_removed` note past `REVIEW_CONFIG.removalReason.maxLength`
 * (the tighter removal-reason cap, checked first since it is the one the note is ACTUALLY bound
 * by on that branch), and a note past `INTEGRITY_CONFIG.moderation.noteMaxLength` otherwise — all
 * three checked before the transaction opens, the same "fail fast, no partial write" shape
 * `removeReviewInTx`'s own reason-length check uses.
 *
 * THE AUDIT EVENT IS THE RECORD: `flag_resolved`, on the PLATFORM chain (ruling 1, never the
 * league's — a record about a person under review is not the league's business), inside the SAME
 * transaction as the stamp, anchor LAST. A notice — only on the `warned_user` branch, per
 * `NOTICE_FOR_DECISION` — is written BEFORE the anchor and stamped with the event id afterwards
 * (`attachAuditEvent`), the identical lock order `grantAdmin` and `removeReview` already hold to:
 * `notifyAffectedMember`'s insert takes an implicit `FOR KEY SHARE` on `users` and `leagues`,
 * which must never follow the anchor lock.
 */
export async function resolveFlag(db: Db, input: ResolveFlagInput): Promise<ResolveFlagResult> {
  if (!decisionIsAvailable(input.decision)) {
    // Hardcoded rather than a per-decision table: `trade_reversed` is the ONLY reserved decision
    // `DECISION_OWNER` declares today, and a table with three permanently-unreachable entries
    // (`no_action`/`warned_user`/`content_removed` all have owners) would be dead weight this
    // suite would then have to pretend to exercise. Whoever reserves the next decision updates
    // this message alongside it — the same obligation `DECISION_OWNER`'s own docblock places on
    // that commit.
    return { ok: false, status: 400, reason: "This product can't reverse a trade yet." };
  }
  // `content_removed`'s note becomes a REMOVAL REASON (`removeSubject` passes it straight through
  // as `removeReviewInTx`'s `reason`), not an `operator_warning` notice body — so it is bound by
  // `REVIEW_CONFIG.removalReason.maxLength` (200), the tighter cap `removeReviewInTx` itself
  // enforces, not the looser `INTEGRITY_CONFIG.moderation.noteMaxLength` (500) below. Checked HERE,
  // with PRODUCT copy, before any write: without this, a 201-500 char note passed the general cap
  // just below, reached `removeReviewInTx` inside the transaction, and surfaced the CLI-flavored
  // `"--reason must be … characters or fewer."` — written for `scripts/remove-review.ts`'s
  // operator, not for whatever calls `resolveFlag`. That script's own door is untouched: it still
  // calls `removeReviewInTx` directly and still gets that exact message.
  if (input.decision === "content_removed" && input.note.length > REVIEW_CONFIG.removalReason.maxLength) {
    return { ok: false, status: 400, reason: `Notes on a removal are limited to ${REVIEW_CONFIG.removalReason.maxLength} characters.` };
  }
  if (input.note.length > INTEGRITY_CONFIG.moderation.noteMaxLength) {
    return { ok: false, status: 400, reason: `Keep the note to ${INTEGRITY_CONFIG.moderation.noteMaxLength} characters or fewer. The member reads it.` };
  }

  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const publish = input.publish ?? ((event) => getPublisher().publish(event));
  const now = new Date(clock.now());

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(integrityFlags)
        .set({ resolvedAt: now, resolvedByUserId: input.operatorUserId, resolution: input.decision, resolutionNote: input.note })
        .where(and(eq(integrityFlags.id, input.flagId), isNull(integrityFlags.resolvedAt)))
        .returning();
      if (row === undefined) return alreadyResolvedOrMissing(tx, input.flagId);

      // content_removed performs the removal INSIDE this transaction, so a decision and its
      // consequence cannot come apart. Tasks 4 and 6 supply the two removers; see `removeSubject`.
      // An ORDINARY refusal (already removed, a ghost id) throws `ContentRemovalRefused`, caught
      // below and turned into this function's own `{ ok: false }` — see that class's docblock.
      if (input.decision === "content_removed") {
        await removeSubject(tx, row.subjectType as FlagSubjectType, {
          subjectId: row.subjectId,
          flagId: row.id,
          operatorUserId: input.operatorUserId,
          reason: input.note,
          clock,
          audit,
          notify,
          publish,
        });
      }

      const noticeType = NOTICE_FOR_DECISION[input.decision];
      const notice =
        noticeType === "operator_warning"
          ? await notify(tx, {
              leagueId: row.leagueId,
              userId: await affectedMemberFor(tx, row.subjectType as FlagSubjectType, row.subjectId),
              noticeType,
              context: { leagueName: await leagueNameForFlag(tx, row.leagueId), note: input.note },
              occurredAt: clock.now(),
              auditEventId: null,
            })
          : null;

      const event = await audit.record(tx, {
        eventType: "flag_resolved",
        actorId: input.operatorUserId,
        actorType: "user",
        leagueId: null, // platform chain — ruling 1
        payload: { flagId: row.id, flagType: row.flagType, decision: input.decision, subjectType: row.subjectType, subjectId: row.subjectId, leagueId: row.leagueId },
        occurredAt: clock.now(),
      });
      if (notice !== null) await attachAuditEvent(tx, notice, event.eventId);
      return { ok: true, flagId: row.id, decision: input.decision };
    });
  } catch (err: unknown) {
    if (err instanceof ContentRemovalRefused) return { ok: false, status: err.status, reason: err.message };
    throw err;
  }
}

/** A stored row, as `flagTrailRowFor` wants it — the same three-field spread `activity.ts`'s own
 *  `toEvent` uses, kept local for the same reason: not worth a cross-module dependency. */
function toEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

export type { FlagCursor };

export interface ListPendingFlagsInput {
  readonly limit?: number;
  /** A cursor from a previous page's `nextBefore` — named to match `feedQuery`'s own `before`
   *  even though this queue reads OLDEST first (ruling 30): it names "continue from here", not a
   *  direction, and giving it a second name for one query would be a second vocabulary to keep
   *  in step with `feedQuery`'s for no reader benefit. */
  readonly before?: FlagCursor;
}

export interface PendingFlagsPage {
  readonly rows: readonly QueueRow[];
  readonly nextBefore: FlagCursor | null;
}

/**
 * The queue's own query — exported as a builder, mirroring `feedQuery` (`@/review-service/
 * reviews`) and `browseQuery` (`@/league-service/browse`), so `flags.test.ts` can assert the
 * TABLE SET this query touches (`tablesIn`, the same helper `reviews.test.ts` established)
 * rather than a hand-copied lookalike. `evidence` and `resolution_note` are not in the SELECT
 * list at all — not filtered out for the queue row, never fetched — the same "a stronger claim
 * than 'no field leaked'" discipline `feedQuery`'s own docblock states for `rating`.
 *
 * Open-only (`resolved_at IS NULL`) and oldest-first (`raised_at ASC`), served by
 * `integrity_flags_queue_idx`: NO severity sort (ruling 30) — a severity ordering over a
 * heuristic score is the platform quietly telling an operator which accusations to believe.
 */
export function pendingFlagQuery(db: Db, input: ListPendingFlagsInput) {
  const pageSize = input.limit ?? INTEGRITY_CONFIG.queue.pageSize;
  const cursor =
    input.before === undefined
      ? undefined
      : sql`(${integrityFlags.raisedAt}, ${integrityFlags.id}) > (${input.before.raisedAt}::timestamptz, ${input.before.id})`;
  return db
    .select({
      id: integrityFlags.id,
      flagType: integrityFlags.flagType,
      subjectType: integrityFlags.subjectType,
      subjectId: integrityFlags.subjectId,
      raisedAt: integrityFlags.raisedAt,
    })
    .from(integrityFlags)
    .where(cursor === undefined ? isNull(integrityFlags.resolvedAt) : and(isNull(integrityFlags.resolvedAt), cursor))
    .orderBy(asc(integrityFlags.raisedAt), asc(integrityFlags.id))
    .limit(pageSize + 1);
}

type PendingFlagRow = Awaited<ReturnType<typeof pendingFlagQuery>>[number];

/**
 * Who or what each row in `rows` is about, batched by subject type rather than one query per
 * row — the same N+1 `listLeagueActivity`'s batched name lookups avoid. However many rows the
 * page holds, this costs at most three queries: the distinct reported reviews, the distinct
 * reported messages, and the distinct account-pair user ids named across the page.
 */
async function aboutFor(db: Db, rows: readonly PendingFlagRow[]): Promise<ReadonlyMap<string, string>> {
  const reviewIds = [...new Set(rows.filter((r) => r.subjectType === "review").map((r) => r.subjectId))];
  const chatIds = [...new Set(rows.filter((r) => r.subjectType === "chat_message").map((r) => r.subjectId))];
  const pairUserIds = [...new Set(rows.filter((r) => r.subjectType === "account_pair").flatMap((r) => r.subjectId.split(",")))];

  const [reviewRows, chatRows, pairRows] = await Promise.all([
    reviewIds.length === 0
      ? []
      : db.select({ id: reviews.id, authorName: users.displayName }).from(reviews).innerJoin(users, eq(users.id, reviews.userId)).where(inArray(reviews.id, reviewIds)),
    chatIds.length === 0
      ? []
      : db
          .select({ id: chatMessages.id, authorName: users.displayName })
          .from(chatMessages)
          .innerJoin(users, eq(users.id, chatMessages.authorUserId))
          .where(inArray(chatMessages.id, chatIds.map(Number))),
    pairUserIds.length === 0 ? [] : db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, pairUserIds)),
  ]);

  const reviewAuthor = new Map(reviewRows.map((r) => [r.id, r.authorName]));
  const chatAuthor = new Map(chatRows.map((r) => [String(r.id), r.authorName]));
  const pairName = new Map(pairRows.map((r) => [r.id, r.name]));

  const about = new Map<string, string>();
  for (const row of rows) {
    if (row.subjectType === "review") about.set(row.id, `A review by ${reviewAuthor.get(row.subjectId) ?? "a former member"}`);
    else if (row.subjectType === "chat_message") about.set(row.id, `A message from ${chatAuthor.get(row.subjectId) ?? "a former member"}`);
    else if (row.subjectType === "account_pair") {
      // `subjectId.split(",")` on a non-empty string always yields a first element (`a` is a
      // real `string`, never `undefined`, no matter what TypeScript's own destructuring type
      // claims without `noUncheckedIndexedAccess`) — only the SECOND element is genuinely
      // optional, for a malformed pair with no comma at all. `b ?? ""` is the guard that fact
      // actually needs; a matching guard on `a` would be dead code defending against a state
      // `.split(",")` cannot produce.
      const [a, b] = row.subjectId.split(",");
      about.set(row.id, `${pairName.get(a) ?? "A former member"} and ${pairName.get(b ?? "") ?? "a former member"}`);
    } else about.set(row.id, `A trade (${row.subjectId})`);
  }
  return about;
}

/**
 * The operator's queue: open flags, oldest first, no severity sort (ruling 30). Exactly TWO
 * queries regardless of the page's contents — `pendingFlagQuery` itself, and `aboutFor`'s single
 * `Promise.all` of at most three batched lookups (which itself costs 0-3 round trips, never one
 * per row) — the same "batched, not per-row" discipline `listLeagueActivity` established.
 */
export async function listPendingFlags(db: Db, input: ListPendingFlagsInput = {}): Promise<PendingFlagsPage> {
  const pageSize = input.limit ?? INTEGRITY_CONFIG.queue.pageSize;
  const rows = await pendingFlagQuery(db, input);
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const about = await aboutFor(db, page);

  return {
    // `about.get(row.id)!`: `aboutFor`'s own loop is exhaustive over every `FlagSubjectType`
    // (`review`/`chat_message`/`account_pair`/else-`trade`), so it sets an entry for every row
    // in `page` — a fallback here would defend against a state `aboutFor` cannot produce.
    rows: page.map((row) =>
      queueRowFor({
        flagId: row.id,
        flagType: row.flagType as FlagType,
        raisedAt: row.raisedAt.toISOString(),
        about: about.get(row.id)!,
      }),
    ),
    nextBefore: hasMore
      ? (() => {
          const last = page[page.length - 1]!;
          return { raisedAt: last.raisedAt.toISOString(), id: last.id };
        })()
      : null,
  };
}

const FALLBACK_SUBJECT_MEMBER = "A former member";

/** The reported content, or the account pair, as an operator needs to see it — one query per
 *  subject type, dispatched by `flagDetail`'s own single lookup of the flag row. */
async function subjectFor(db: Db, subjectType: FlagSubjectType, subjectId: string): Promise<FlagSubjectView> {
  if (subjectType === "review") {
    const [row] = await db
      .select({ body: reviews.body, authorName: users.displayName })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(eq(reviews.id, subjectId));
    return row === undefined
      ? { kind: "review", reviewId: subjectId, body: "This review is no longer here.", authorName: FALLBACK_SUBJECT_MEMBER }
      : { kind: "review", reviewId: subjectId, body: row.body, authorName: row.authorName };
  }
  if (subjectType === "chat_message") {
    const [row] = await db
      .select({ body: chatMessages.body, authorName: users.displayName })
      .from(chatMessages)
      .innerJoin(users, eq(users.id, chatMessages.authorUserId))
      .where(eq(chatMessages.id, Number(subjectId)));
    return row === undefined
      ? { kind: "chat_message", messageId: subjectId, body: null, authorName: FALLBACK_SUBJECT_MEMBER }
      : { kind: "chat_message", messageId: subjectId, body: row.body, authorName: row.authorName };
  }
  if (subjectType === "account_pair") {
    // `idA` is always a real `string` — `subjectId.split(",")` on a non-empty string always
    // yields a first element, whatever TypeScript's own destructuring type claims without
    // `noUncheckedIndexedAccess`. Only `idB` is genuinely optional (a malformed pair with no
    // comma at all), so `ids` always holds at least `idA` and the ternary `aboutFor`'s sibling
    // block used to need here would be dead code defending against a state this can't produce.
    const [idA, idB] = subjectId.split(",");
    const ids = idB === undefined ? [idA] : [idA, idB];
    const rows = await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, ids));
    const nameOf = (id: string | undefined) => rows.find((r) => r.id === id)?.name ?? FALLBACK_SUBJECT_MEMBER;
    return { kind: "account_pair", userIds: [idA, idB ?? ""], names: [nameOf(idA), nameOf(idB)] };
  }
  return { kind: "trade", tradeId: subjectId };
}

/**
 * `review_report` and `chat_report` flags have reporters — `review_reports` and
 * `chat_message_reports` are this plan's two insert-only signal tables (ruling 5). Every other
 * subject type answers empty — a platform detector or a future report table names its own
 * reporters when it lands.
 *
 * Fix round 1 (review HIGH): the `chat_report` branch was missing entirely — `chat_message_
 * reports` was populated by `reportMessage` from the first commit but never read back here, so
 * every chat flag's detail view showed zero reporters no matter how many people reported it.
 * Shaped exactly like the review branch: reporters itemized individually, in report order, never
 * aggregated into a count or a verdict — the operator reads who and why, not a tally.
 */
async function reportersFor(db: Db, subjectType: FlagSubjectType, subjectId: string): Promise<readonly ReporterView[]> {
  if (subjectType === "review") {
    const rows = await db
      .select({ userId: reviewReports.reporterUserId, name: users.displayName, reason: reviewReports.reason, reportedAt: reviewReports.createdAt })
      .from(reviewReports)
      .innerJoin(users, eq(users.id, reviewReports.reporterUserId))
      .where(eq(reviewReports.reviewId, subjectId))
      .orderBy(asc(reviewReports.createdAt));
    return rows.map((row) => ({ userId: row.userId, name: row.name, reason: row.reason, reportedAt: row.reportedAt.toISOString() }));
  }
  if (subjectType === "chat_message") {
    const rows = await db
      .select({ userId: chatMessageReports.reporterUserId, name: users.displayName, reason: chatMessageReports.reason, reportedAt: chatMessageReports.createdAt })
      .from(chatMessageReports)
      .innerJoin(users, eq(users.id, chatMessageReports.reporterUserId))
      .where(eq(chatMessageReports.messageId, Number(subjectId)))
      .orderBy(asc(chatMessageReports.createdAt));
    return rows.map((row) => ({ userId: row.userId, name: row.name, reason: row.reason, reportedAt: row.reportedAt.toISOString() }));
  }
  return [];
}

/**
 * The relevant audit trail: the PLATFORM chain's events about this flag by id (`flag_raised`,
 * `flag_resolved`, and `review_removed` when `content_removed` reached it — all three carry
 * `payload.flagId`), plus, where the subject has a league (an `account_pair` flag, the only
 * subject type this plan raises WITH a `leagueId` — ruling 1, `review_report`/`chat_report` flags
 * carry `leagueId: null`), that league's own chain events for the two accounts named — context
 * for an investigation the platform chain alone cannot supply. Bounded at exactly two queries,
 * the second skipped outright when there is no league to ask.
 */
async function trailFor(db: Db, flagId: string, leagueId: string | null, subjectType: FlagSubjectType, subjectId: string): Promise<readonly AuditEvent[]> {
  const platformRows = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.chainScope, INTEGRITY_CONFIG.chain.platformScope), sql`${auditEvents.payload} ->> 'flagId' = ${flagId}`))
    .orderBy(asc(auditEvents.occurredAt));

  if (leagueId === null || subjectType !== "account_pair") return platformRows.map(toEvent);

  const actorIds = subjectId.split(",").filter((id) => id.length > 0);
  const leagueRows =
    actorIds.length === 0
      ? []
      : await db
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.chainScope, leagueId), inArray(auditEvents.actorId, actorIds)))
          .orderBy(asc(auditEvents.occurredAt))
          .limit(INTEGRITY_CONFIG.queue.trailLimit);

  return [...platformRows.map(toEvent), ...leagueRows.map(toEvent)].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

/**
 * The resolving operator's own display name — fix round 1, FIX 5: the detail page needs to say
 * WHO decided, not just render a bare "already resolved" sentence. A single query, run only
 * when a flag actually IS resolved (`flagDetail`'s own caller already knows `resolvedByUserId`
 * is non-null by the time this is called).
 *
 * No fallback, unlike `subjectFor`/`aboutFor`'s "a former member": `integrity_flags.
 * resolved_by_user_id` carries a REAL foreign key onto `users.id` (`references(() => users.id)`,
 * no `onDelete`, so Postgres refuses either write — the flag's own stamp `UPDATE`, or a later
 * `DELETE FROM users` — the moment the other would leave this column dangling). A missing row
 * here is not a rare edge case to degrade gracefully from; it is a constraint violation that
 * would already have stopped the write that tried to produce it. `row!.name` says that plainly
 * rather than writing a fallback branch no test could ever legitimately reach.
 */
async function resolverNameFor(db: Db, resolvedByUserId: string): Promise<string> {
  const [row] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, resolvedByUserId));
  return row!.name;
}

/**
 * The detail read: one flag, its subject, its reporters and its relevant audit trail — bounded
 * at exactly FIVE queries for an OPEN flag regardless of how much history either chain holds:
 * the flag row itself, `subjectFor` (one), `reportersFor` (one), and `trailFor`'s own two. A
 * RESOLVED flag costs one query more (`resolverNameFor`, sequenced after the batch since it
 * only runs once `resolution` is known non-null) — six total. `flags.test.ts` asserts both
 * bounds with `countingDb`.
 *
 * Returns `null` for a flag id that names nothing — the route (`GET`-equivalent Server Component
 * per Task 5's brief) turns that into `notFound()`, never a 403 or a 500.
 */
export async function flagDetail(db: Db, flagId: string): Promise<FlagDetail | null> {
  const [flagRow] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flagId));
  if (flagRow === undefined) return null;

  const subjectType = flagRow.subjectType as FlagSubjectType;
  const [subject, reporters, trailEvents] = await Promise.all([
    subjectFor(db, subjectType, flagRow.subjectId),
    reportersFor(db, subjectType, flagRow.subjectId),
    trailFor(db, flagRow.id, flagRow.leagueId, subjectType, flagRow.subjectId),
  ]);

  const trail = trailEvents.map(flagTrailRowFor).filter((row): row is NonNullable<typeof row> => row !== null);

  // `resolveFlag`'s stamp UPDATE sets `resolved_at`, `resolved_by_user_id`, `resolution` and
  // `resolution_note` together, in the one statement — a row where the first three are non-null
  // but `resolution_note` is somehow still null cannot come from that write, so it is folded
  // into the same "not resolved" guard rather than given its own fallback (`?? ""`) to defend a
  // state this table's one writer cannot produce.
  const resolution =
    flagRow.resolvedAt === null || flagRow.resolvedByUserId === null || flagRow.resolution === null || flagRow.resolutionNote === null
      ? null
      : {
          decision: flagRow.resolution as ResolutionDecision,
          note: flagRow.resolutionNote,
          resolvedAt: flagRow.resolvedAt.toISOString(),
          resolvedByUserId: flagRow.resolvedByUserId,
          resolvedByName: await resolverNameFor(db, flagRow.resolvedByUserId),
        };

  return flagDetailFor(
    { id: flagRow.id, flagType: flagRow.flagType as FlagType, raisedAt: flagRow.raisedAt.toISOString(), leagueId: flagRow.leagueId, evidence: flagRow.evidence, resolution },
    subject,
    reporters,
    trail,
  );
}
