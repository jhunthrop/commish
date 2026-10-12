import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { users } from "@/db/schema";
import type { Clock } from "@research/domain/timing";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * The self-exclusion door's SET writer (Task 7 Step 2): stamps `users.self_excluded_at` for the
 * caller, one way, from the account room. `moneyGates` (`./gates.ts`) reads this column for every
 * money door that lets money IN; this is the flag going real.
 *
 * IDEMPOTENT, never an error on a repeat call: a member re-confirming "close my account to paid
 * play" is not a mistake to reject, and re-stamping would move the timestamp for no reason a UI
 * ever needs. The existing stamp answers every time after the first.
 *
 * FIX ROUND (Task 7 review): now a `db.transaction`, and `self_exclusion_set` is appended ONLY on
 * the branch that actually stamps the row — `grantAdmin`'s own "the toggle's own guard lives in
 * the UPDATE's WHERE, so a no-op writes no duplicate event" precedent. The guarded
 * `UPDATE ... WHERE self_excluded_at IS NULL` is the ONE atomic statement that decides both
 * questions (did this call change anything, and is the row therefore safe to audit) — no separate
 * read-then-write race window. The anchor lock (inside `audit.record`) is taken last, after the
 * row update, the same order every writer in this codebase holds to.
 */
export async function setSelfExclusion(db: Db, userId: string, clock: Clock = systemClock, audit: AuditLogger = getAuditLogger()): Promise<string> {
  const now = new Date(clock.now());

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ selfExcludedAt: now })
      .where(and(eq(users.id, userId), isNull(users.selfExcludedAt)))
      .returning({ selfExcludedAt: users.selfExcludedAt });

    if (updated !== undefined) {
      await audit.record(tx, {
        eventType: "self_exclusion_set",
        actorId: userId,
        actorType: "user",
        leagueId: null,
        payload: {},
        occurredAt: clock.now(),
      });
      // `updated.selfExcludedAt` is the value this statement itself just set — never null, by
      // construction of the `SET` clause above.
      return updated.selfExcludedAt!.toISOString();
    }

    // The guard above matched zero rows: either this user does not exist, or (the ordinary case)
    // they are already excluded. Reading the row back rather than assuming which, so the answer
    // always matches what is actually stored.
    const [current] = await tx.select({ selfExcludedAt: users.selfExcludedAt }).from(users).where(eq(users.id, userId));
    if (current === undefined || current.selfExcludedAt === null) {
      throw new Error(`setSelfExclusion: no user row for "${userId}".`);
    }
    return current.selfExcludedAt.toISOString();
  });
}

export type ExclusionPreviewResult =
  | { readonly ok: true; readonly displayName: string; readonly selfExcludedAt: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The read-then-confirm half of `clearSelfExclusion` (operator review, 2026-08-27, finding
 * D1/D3): the member's own name and the date they excluded themselves, before an operator
 * reopens paid play for their account. Refuses with the identical sentence `clearSelfExclusion`
 * itself refuses with for the same two cases (no such user, or not currently excluded) — a
 * preview that disagreed with the write it previews would be worse than no preview at all.
 */
export async function exclusionPreview(db: Db, userId: string): Promise<ExclusionPreviewResult> {
  const [user] = await db.select({ id: users.id, displayName: users.displayName, selfExcludedAt: users.selfExcludedAt }).from(users).where(eq(users.id, userId));
  if (user === undefined || user.selfExcludedAt === null) {
    return { ok: false, reason: `"${userId}" is not a user, or is not excluded.` };
  }
  return { ok: true, displayName: user.displayName, selfExcludedAt: user.selfExcludedAt.toISOString() };
}

export interface ClearSelfExclusionInput {
  /** The excluded member. */
  readonly userId: string;
  /** The operator clearing it, from `withAdmin`'s own verified session — never from the body. */
  readonly operatorUserId: string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

export type ClearSelfExclusionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * The self-exclusion door's CLEAR writer: operator-only, from the admin room, `grantAdmin`'s own
 * shape (`src/integrity-service/grant-admin.ts`), copied deliberately: the toggle's own guard
 * lives in the `UPDATE`'s `WHERE`, so a clear attempt against a user who is not excluded (or does
 * not exist) matches zero rows and reports that honestly instead of writing a duplicate audit
 * event about a change that did not happen.
 *
 * FIX ROUND (Task 7 review, controller ruling): appends `self_exclusion_cleared`, which REPLACES
 * the `admin_action` event this writer used to append. No prior `admin_action` row from this
 * writer exists in any real data (Task 7 shipped and was fixed in the same review cycle before
 * this writer's first production use), so the replacement is clean — a clear now reads as its own
 * named fact on the chain, not a generic `admin_action` a reader has to inspect the payload of to
 * identify.
 *
 * LOCK ORDER: the anchor (inside `audit.record`) is taken last, after the guarded `users` update,
 * the global rule every writer in this codebase holds to.
 */
export async function clearSelfExclusion(db: Db, input: ClearSelfExclusionInput): Promise<ClearSelfExclusionResult> {
  const clock = input.clock ?? systemClock;
  const audit = input.audit ?? getAuditLogger();

  return db.transaction(async (tx) => {
    const [subject] = await tx
      .update(users)
      .set({ selfExcludedAt: null })
      .where(and(eq(users.id, input.userId), isNotNull(users.selfExcludedAt)))
      .returning({ id: users.id });
    if (subject === undefined) return { ok: false, reason: `"${input.userId}" is not a user, or is not excluded.` };

    await audit.record(tx, {
      eventType: "self_exclusion_cleared",
      actorId: input.operatorUserId,
      actorType: "user",
      leagueId: null,
      payload: { subjectUserId: subject.id },
      occurredAt: clock.now(),
    });
    return { ok: true };
  });
}
