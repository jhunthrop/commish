import { and, eq, isNull } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { integrityFlags, users } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import { SUBJECT_OF, type FlagSubjectType, type FlagType } from "@/integrity/flags";
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
