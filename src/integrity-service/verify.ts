import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "@research/db/client";
import { auditChainCheckpoints, auditChains, auditEvents } from "@/db/schema";
import type { AuditEvent } from "@/domain/audit";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { GENESIS_HASH, computeEventHash, verifyLinkedRun, type ChainAnchor, type ChainBreakReason, type HashFn } from "@/integrity/chain";

export type ChainVerificationResult =
  | { readonly valid: true; readonly scope: string; readonly verifiedThrough: number; readonly hashed: number }
  | {
      readonly valid: false;
      readonly scope: string;
      readonly firstBrokenEventId: string;
      readonly firstBrokenSequence: number;
      readonly reason: ChainBreakReason;
    };

export interface VerifyOptions {
  /** Injected only so a test can count the work. Production never passes it. */
  readonly hash?: HashFn;
  readonly batchSize?: number;
}

/** A stored row, as the pure verifier wants it: `occurredAt` back in its hashed spelling. */
function toEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

async function page(db: Db, scope: string, after: number, batchSize: number): Promise<readonly AuditEvent[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.chainScope, scope), gt(auditEvents.sequence, after)))
    .orderBy(asc(auditEvents.sequence))
    .limit(batchSize);
  return rows.map(toEvent);
}

/**
 * What `audit_chains` SWEARS this scope holds: how many events, and what the last one hashed to.
 *
 * A scope with no anchor row at all reads as the genesis anchor, which is the honest reading of
 * "nothing has ever been appended here" — and it makes "no anchor row but rows exist" (an anchor
 * somebody deleted) a mismatch rather than a special case, because zero is not what the walk
 * will have found.
 */
async function swornAnchor(db: Db, scope: string): Promise<ChainAnchor> {
  const [row] = await db.select().from(auditChains).where(eq(auditChains.scope, scope));
  if (row === undefined) return { headSequence: 0, headHash: GENESIS_HASH };
  return { headSequence: row.headSequence, headHash: row.headHash };
}

/**
 * The accusation, with BOTH numbers in it. An operator reading a broken chain needs to know
 * which of the two accounts is short and by how much, because "the anchor says five and the rows
 * say three" and "the anchor says three and the rows say five" are different incidents.
 *
 * The divergence point is the first sequence the two accounts stop agreeing about: one past the
 * shorter of the two when they differ in LENGTH, and the head sequence itself when they agree on
 * the count but not on the hash (nothing after it is in dispute; that one row is).
 */
function anchorMismatch(scope: string, sworn: ChainAnchor, walked: ChainAnchor): ChainVerificationResult {
  const firstBrokenSequence =
    sworn.headSequence === walked.headSequence ? sworn.headSequence : Math.min(sworn.headSequence, walked.headSequence) + 1;
  return {
    valid: false,
    scope,
    firstBrokenEventId: `audit_chains claims ${sworn.headSequence} event(s) ending ${sworn.headHash}; the walk found ${walked.headSequence} ending ${walked.headHash}`,
    firstBrokenSequence,
    reason: "anchor_mismatch",
  };
}

/**
 * Walks forward from `from` to the end of the chain, one page at a time, reconciles what it found
 * against the chain's own anchor, and advances the checkpoint on success. Never advances it on
 * failure: every later run re-detects the same break rather than stepping over it, which is what
 * makes a break something a human eventually sees.
 *
 * THE RECONCILIATION IS THE POINT, and it is why deletion is visible at all. Three checks, in
 * order:
 *
 *  1. the walk's terminus against `audit_chains` — a truncated tail, a rewound anchor, an anchor
 *     nobody updated, and a chain whose every row is gone all land here;
 *  2. the frozen checkpoint against `audit_chains` — the one case check 1 cannot see, because an
 *     adversary who deletes the tail AND rewinds the anchor to match leaves two accounts that
 *     agree with each other. The checkpoint is a THIRD account, frozen earlier, and a checkpoint
 *     that verified more events than the anchor now claims is an anchor rewind stated in the
 *     chain's own records;
 *  3. only then is a new checkpoint frozen. A walk that ends in an accusation must never move the
 *     checkpoint forward, for the same reason a broken run must not.
 *
 * `verifiedThrough: 0` with `valid: true` is legal ONLY when the anchor agrees there is nothing
 * here. Writing a checkpoint for such a scope would violate `audit_chain_checkpoints`'s FK to
 * `audit_chains` — and there is nothing to checkpoint yet regardless.
 */
async function walk(db: Db, scope: string, from: ChainAnchor, options: VerifyOptions): Promise<ChainVerificationResult> {
  const batchSize = options.batchSize ?? INTEGRITY_CONFIG.verification.batchSize;
  let anchor = from;
  let hashed = 0;
  for (;;) {
    const events = await page(db, scope, anchor.headSequence, batchSize);
    if (events.length === 0) break;
    const run = verifyLinkedRun(events, anchor, options.hash);
    hashed += run.hashed;
    if (!run.valid) {
      return { valid: false, scope, firstBrokenEventId: run.break.eventId, firstBrokenSequence: run.break.sequence, reason: run.break.reason };
    }
    anchor = run.through;
    if (events.length < batchSize) break;
  }

  const sworn = await swornAnchor(db, scope);
  if (sworn.headSequence !== anchor.headSequence || sworn.headHash !== anchor.headHash) {
    return anchorMismatch(scope, sworn, anchor);
  }

  const [frozen] = await db.select().from(auditChainCheckpoints).where(eq(auditChainCheckpoints.scope, scope));
  if (frozen !== undefined && frozen.verifiedThroughSequence > sworn.headSequence) {
    return {
      valid: false,
      scope,
      firstBrokenEventId: `audit_chain_checkpoints froze ${frozen.verifiedThroughSequence} verified event(s); audit_chains now claims only ${sworn.headSequence}`,
      firstBrokenSequence: sworn.headSequence + 1,
      reason: "anchor_mismatch",
    };
  }

  if (anchor.headSequence === 0) return { valid: true, scope, verifiedThrough: 0, hashed };

  await db
    .insert(auditChainCheckpoints)
    .values({ scope, verifiedThroughSequence: anchor.headSequence, verifiedThroughHash: anchor.headHash })
    .onConflictDoUpdate({
      target: auditChainCheckpoints.scope,
      set: { verifiedThroughSequence: anchor.headSequence, verifiedThroughHash: anchor.headHash, verifiedAt: new Date() },
    });
  return { valid: true, scope, verifiedThrough: anchor.headSequence, hashed };
}

/**
 * The routine check: re-hashes only what has been appended since this scope was last verified.
 *
 * It also re-checks the checkpointed row ITSELF, which is what turns "we verified through 3" from
 * a claim into something falsifiable — a tamper exactly on the boundary row would otherwise be
 * invisible to both walks until the next full one.
 *
 * A tamper strictly BEFORE the checkpoint is deliberately invisible here. That is the cost of an
 * incremental check, it is the reason `verifyFullChainIntegrity` exists, and it is asserted in
 * both directions by the tests.
 */
export async function verifyChainIntegrity(db: Db, scope: string, options: VerifyOptions = {}): Promise<ChainVerificationResult> {
  const [checkpoint] = await db.select().from(auditChainCheckpoints).where(eq(auditChainCheckpoints.scope, scope));
  if (checkpoint === undefined || checkpoint.verifiedThroughSequence === 0) {
    return walk(db, scope, { headSequence: 0, headHash: GENESIS_HASH }, options);
  }

  const [boundary] = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.chainScope, scope), eq(auditEvents.sequence, checkpoint.verifiedThroughSequence)));
  // RECOMPUTED, not compared column-to-column: a tamper that overwrites `payload` but leaves the
  // stored `event_hash` column alone (exactly what `tamperWithAuditEvent` does — there is no
  // trigger left standing to fix it up, that's the point) would be invisible to a check that only
  // diffs two already-stored hash values. Always the REAL hash function, never `options.hash` —
  // this is a fixed, one-row check, not the per-event work the incremental test counts, so an
  // injected spy must not see it.
  if (boundary === undefined || computeEventHash(toEvent(boundary)) !== checkpoint.verifiedThroughHash) {
    return {
      valid: false,
      scope,
      firstBrokenEventId: boundary?.eventId ?? `sequence ${checkpoint.verifiedThroughSequence} (missing)`,
      firstBrokenSequence: checkpoint.verifiedThroughSequence,
      reason: "checkpoint_mismatch",
    };
  }

  return walk(db, scope, { headSequence: checkpoint.verifiedThroughSequence, headHash: checkpoint.verifiedThroughHash }, options);
}

/**
 * The safety net: from genesis, every time, whatever the checkpoint says. Never on a request
 * path — `scripts/verify-audit-chain.ts` is its only caller today, and
 * `INTEGRITY_CONFIG.verification.fullVerifyIntervalHours` is the cadence a scheduler gets.
 *
 * It ignores the checkpoint as a STARTING POINT — that is what makes it the safety net for a
 * tamper behind the checkpoint — but it still reads the frozen checkpoint at the end, as
 * `walk`'s second reconciliation. That is not a contradiction: starting from a checkpoint would
 * make the full walk trust it, while cross-checking it against the anchor makes the full walk
 * hold BOTH stored summaries to the rows. Before that reconciliation existed, this function was
 * strictly WEAKER than the incremental walk against a deleted chain, which is the exact
 * inversion a safety net must never have.
 */
export async function verifyFullChainIntegrity(db: Db, scope: string, options: VerifyOptions = {}): Promise<ChainVerificationResult> {
  return walk(db, scope, { headSequence: 0, headHash: GENESIS_HASH }, options);
}

/** Every chain that exists, incremental by default. Ordered so the script's output is stable. */
export async function verifyAllChains(db: Db, options: VerifyOptions & { readonly full?: boolean } = {}): Promise<readonly ChainVerificationResult[]> {
  const rows = await db.select({ scope: auditChains.scope }).from(auditChains).orderBy(asc(auditChains.scope));
  const verify = options.full === true ? verifyFullChainIntegrity : verifyChainIntegrity;
  const results: ChainVerificationResult[] = [];
  for (const row of rows) results.push(await verify(db, row.scope, options));
  return results;
}
