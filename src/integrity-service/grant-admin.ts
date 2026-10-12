import { and, eq } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { users } from "@/db/schema";
import type { Clock } from "@research/domain/timing";
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
 * MOVED HERE FROM `flags.ts` in fix round 1 (Task 9's review, finding HIGH): `grantAdmin` and
 * `raiseFlag` living in the same file meant a same-file call needed no `import` — the ONE way
 * `src/integrity/flag-only.test.ts`'s `importClosureOf` can ever see this function is a real
 * import edge, so colocating it with the detector's own dependency (`raiseFlag`) left the
 * flags-only guarantee for that whole file resting on manual review, not on either automated
 * check the test file claims to provide. This is now the ONE module the flag-only grep excludes
 * by name (`ACCOUNT_ACTION_PATTERNS`'s own exception list) — the sanctioned authority-granting
 * module, reachable only by `import`, which the import-closure test now actually proves
 * `multi-account.ts` cannot reach.
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
