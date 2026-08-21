import { and, eq, isNull } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { integrityFlags } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import { SUBJECT_OF, type FlagSubjectType, type FlagType } from "@/integrity/flags";
import { getAuditLogger, type AuditLogger } from "./audit-logger";

/**
 * `raiseFlag` and its narrow dependencies — split out of `flags.ts` (Task 7, fix for the fairness
 * detector's own reachability contract), which otherwise imports `reverseTradeInTx` (`@/league-
 * service/trade-reversal`) for `resolveFlag`'s `trade_reversed` branch. `trade-fairness.ts` and
 * `multi-account.ts` both import `raiseFlag` to RAISE a flag, never to resolve one — and
 * `src/integrity/flag-only.test.ts`'s own contract is that NOTHING reachable from the fairness
 * detector's import graph can reach a trade-mutating module. Before this split, `raiseFlag` lived
 * in `flags.ts` beside `resolveFlag`, so importing `raiseFlag` from `"./flags"` pulled in
 * `resolveFlag`'s own imports too — including `reverseTradeInTx` — and the detector's closure
 * reached `trade-transfer.ts` and `trade-reversal.ts` through a file it had no business touching
 * at all. This module is self-contained (no import of `flags.ts`, no import of anything trade-
 * shaped), so `trade-fairness.ts` importing FROM HERE directly, rather than through `flags.ts`,
 * keeps the guard's claim true again. `flags.ts` re-exports everything below verbatim, so every
 * OTHER existing caller (`review-service/reviews.ts`, `chat-service/moderation.ts`, `multi-
 * account.ts`, the admin routes) is unaffected — this is a move, not a behavior change.
 */

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
  /** The reviewed thing. For `account_pair`, the two user ids sorted and joined with a separator
   *  (ruling 28, `canonicalPairId`, `@/integrity-service/multi-account`) — so "a:b" and "b:a" are
   *  one subject. */
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
