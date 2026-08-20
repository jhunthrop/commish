import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
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
 * Walks forward from `from` to the end of the chain, one page at a time, and advances the
 * checkpoint on success. Never advances it on failure: every later run re-detects the same break
 * rather than stepping over it, which is what makes a break something a human eventually sees.
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

  // A scope nobody has ever appended to (no `audit_chains` row exists at all) walks from genesis
  // and finds nothing, so `anchor` is still exactly the genesis anchor it started from. Writing a
  // checkpoint for it would violate `audit_chain_checkpoints`'s FK to `audit_chains` — and there
  // is nothing to checkpoint yet regardless. `verifyChainIntegrity`'s "empty chain" case and a
  // `--scope` the caller mistyped both end here without touching the database.
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
