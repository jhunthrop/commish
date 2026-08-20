import { and, eq, isNull } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { chatMessages, integrityFlags, leagues, reviews, users } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { decisionIsAvailable, RESOLUTION_DECISIONS, SUBJECT_OF, type FlagSubjectType, type FlagType, type ResolutionDecision } from "@/integrity/flags";
import type { NoticeType } from "@/integrity/notices";
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
 * `content_removed`'s actual removal, dispatched by the flag's own `subjectType`. NEITHER
 * report-driven subject type is wired yet: Task 4 lands `review` by calling the existing
 * `removeReview` INSIDE `resolveFlag`'s own transaction, and Task 6 lands `chat_message` the same
 * way for `chat-service` — both by modifying this function, per the plan's own task list. So this
 * always throws today.
 *
 * A THROW, not a graceful `{ ok: false }`, is deliberate and load-bearing: by the time this runs,
 * `resolveFlag`'s stamp `UPDATE` has already applied inside this same transaction, and the ONLY
 * way to undo it is Postgres's own `ROLLBACK` on a rejected promise — the identical audit-fails-
 * the-tx discipline `raiseFlag` and `grantAdmin` already lean on for a failed `audit.record`. A
 * caller getting back a flag stamped "resolved: content_removed" with no removal performed and no
 * `flag_resolved` event to explain it would be exactly the hole in the record this whole plan
 * exists to close.
 */
async function removeSubject(subjectType: string): Promise<never> {
  throw new Error(`resolveFlag: content_removed has no remover wired for subject type "${subjectType}" yet (Tasks 4 and 6 land these).`);
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
 * (`decisionIsAvailable`), and refuses a note past `INTEGRITY_CONFIG.moderation.noteMaxLength` —
 * both checked before the transaction opens, the same "fail fast, no partial write" shape
 * `removeReview`'s own reason-length check uses.
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
  if (input.note.length > INTEGRITY_CONFIG.moderation.noteMaxLength) {
    return { ok: false, status: 400, reason: `Keep the note to ${INTEGRITY_CONFIG.moderation.noteMaxLength} characters or fewer. The member reads it.` };
  }

  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();
  const notify = input.notify ?? notifyAffectedMember;
  const now = new Date(clock.now());

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(integrityFlags)
      .set({ resolvedAt: now, resolvedByUserId: input.operatorUserId, resolution: input.decision, resolutionNote: input.note })
      .where(and(eq(integrityFlags.id, input.flagId), isNull(integrityFlags.resolvedAt)))
      .returning();
    if (row === undefined) return alreadyResolvedOrMissing(tx, input.flagId);

    // content_removed performs the removal INSIDE this transaction, so a decision and its
    // consequence cannot come apart. Tasks 4 and 6 supply the two removers; see `removeSubject`.
    if (input.decision === "content_removed") await removeSubject(row.subjectType);

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
}
