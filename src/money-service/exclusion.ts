import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
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
 */
export async function setSelfExclusion(db: Db, userId: string, clock: Clock = systemClock): Promise<string> {
  const [before] = await db.select({ selfExcludedAt: users.selfExcludedAt }).from(users).where(eq(users.id, userId));
  if (before === undefined) throw new Error(`setSelfExclusion: no user row for "${userId}".`);
  if (before.selfExcludedAt !== null) return before.selfExcludedAt.toISOString();

  const now = new Date(clock.now());
  await db.update(users).set({ selfExcludedAt: now }).where(eq(users.id, userId));
  return now.toISOString();
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
 * The self-exclusion door's CLEAR writer: operator-only, from the admin room, audited as
 * `admin_action` (Task 7 Step 2's exact requirement) — `grantAdmin`'s own shape
 * (`src/integrity-service/grant-admin.ts`), copied deliberately: the toggle's own guard lives in
 * the `UPDATE`'s `WHERE`, so a clear attempt against a user who is not excluded (or does not
 * exist) matches zero rows and reports that honestly instead of writing a duplicate audit event
 * about a change that did not happen.
 *
 * The append lives INSIDE this transaction (`AuditLogger`'s own contract): a clear nobody
 * recorded is a hole in the record this whole phase exists to make trustworthy.
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
      eventType: "admin_action",
      actorId: input.operatorUserId,
      actorType: "user",
      leagueId: null,
      payload: { action: "self_exclusion_cleared", subjectUserId: subject.id },
      occurredAt: clock.now(),
    });
    return { ok: true };
  });
}
