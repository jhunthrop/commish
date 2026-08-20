import { eq } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { auditChains, auditEvents } from "@/db/schema";
import type { AuditEvent, AuditEventInput } from "@/domain/audit";
import { GENESIS_HASH, linkEvent, scopeFor, type ChainAnchor } from "@/integrity/chain";

/**
 * The one way anything in this product writes an audit event.
 *
 * There is no update, no delete and no upsert, and there never will be: this interface IS the
 * application-layer half of "append-only" (the database trigger is the second half and the hash
 * chain is the third). `recordAll` is a batch APPEND, not a mutation — it exists so a draft pick
 * that produces two events, or a Plan C trade that produces several, takes the anchor lock once
 * instead of once per event.
 *
 * BOTH methods take the caller's `DbTx` rather than a `Db`. That is the whole contract: an audit
 * event commits with the write it records, or neither commits. It is the exact opposite of the
 * publishing rule in `docs/conventions.md` ("publishing is best-effort and must never fail the
 * write"), and the difference is deliberate — a Redis frame nobody received is a client that
 * refetches, while a mutation nobody recorded is a hole in the record this whole phase exists to
 * be able to trust.
 *
 * CHAIN SCOPE. One chain per league, plus one platform chain for the league-less events
 * (`session_started`, `profile_updated`, `review_removed`, Plan B's `admin_action`) — never one
 * global chain. The append lives INSIDE the caller's business transaction (see above), so the
 * anchor row lock is held for the whole business transaction, not just the append. A single
 * global chain would put every write in the product behind one row lock, capping platform-wide
 * throughput at `1 / (mean business transaction duration)` — with a draft pick's transaction
 * running 5-20ms, a ceiling of roughly 50-200 writes/second for the ENTIRE platform, reached by
 * about a thousand leagues drafting at once on a Sunday evening. Per-league chains reduce
 * contention to contention that already exists: a draft is already single-writer per draft, and
 * twelve managers setting lineups on a Sunday morning at ~15ms each is not a queue. The matched
 * concurrency test pair in `audit-logger.test.ts` is the proof — same scope serializes into a
 * gapless linked run, different scopes never block each other at all. Both halves are held to
 * what they claim: the same-scope test waits on `pg_stat_activity` for a genuinely blocked
 * backend rather than on a hopeful `setTimeout`, and the different-scope test races against a
 * COMMITTED neighbour anchor, so a lock broadened past one row blocks on a row it can actually
 * see and blows the test's statement timeout. Verified by mutation, in both directions.
 *
 * The platform chain stays a single row only because every platform-chain append is a short
 * transaction by construction (a sign-in at 20/s against a ~2ms transaction is 4% utilization of
 * one row). If a later plan ever wants to append a platform event from inside a long
 * transaction, that is the moment to shard the platform chain — not before.
 *
 * LOCK ORDER (ruling 3, the global rule, AS RESTATED): the audit anchor is ALWAYS THE LAST LOCK a
 * transaction takes, no exceptions — and "lock" INCLUDES AN IMPLICIT FOREIGN-KEY LOCK. Postgres
 * takes `FOR KEY SHARE` on the REFERENCED row when a statement inserts or updates a referencing
 * one, and `FOR KEY SHARE` conflicts with `FOR UPDATE`. An `INSERT INTO member_notices` is
 * therefore a lock on `leagues` and on `users`, and `commitDraftState`'s inserts are locks on
 * `leagues`, `teams` and `players`.
 *
 * That sentence is the whole finding. The rule used to read "no non-anchor lock after the anchor"
 * and three transactions honored it while inserting FK-carrying rows afterwards, because an
 * implicit FK lock does not look like a lock. It produced a REAL cycle: `joinLeagueInTx` held
 * `leagues[X] FOR UPDATE` and waited for `audit_chains[X]`, while the draft-pick transaction held
 * `audit_chains[X]` and waited for `leagues[X] FOR KEY SHARE` through its `member_notices`
 * insert. Postgres broke it after `deadlock_timeout` by killing a pick or a join that the user
 * did nothing to deserve.
 *
 * So: `applyAction` (`src/draft-service/store.ts`) holds `drafts FOR UPDATE` first and does every
 * notice insert, every caller-supplied write and the whole season commit BEFORE it reaches this
 * row; `setLineup` holds `stat_weeks FOR SHARE` first; `joinLeagueInTx` holds `league_invites`
 * then `leagues` first; `removeReview` writes its notice before appending. Every one of them
 * reaches this row afterwards, and nothing reaches any of them from here — so no lock-ordering
 * cycle exists anywhere in the codebase. Because a transaction touches at most one anchor, and
 * the anchor is always taken last, two transactions can never take two anchor locks in opposite
 * orders. `src/integrity-service/lock-order.test.ts` drives the two transactions that used to
 * deadlock against a real Postgres and holds that claim to it.
 *
 * The one statement any caller may run after the anchor is
 * `attachAuditEvent` (`notify.ts`), and only because it updates `member_notices.audit_event_id`,
 * a column with no foreign key, which makes Postgres re-check nothing and lock nothing.
 *
 * FAILURE MODE (ruling 4, the opposite of publishing): an audit append failure FAILS the
 * caller's business transaction. No catch, no best-effort, no fallback path. `docs/
 * conventions.md` rules that publishing a realtime frame must never fail the write it announces
 * — a client that missed a frame refetches. An audit event is the mirror image: a mutation
 * nobody recorded is a hole in the record this whole phase exists to make trustworthy, and that
 * is strictly worse than the mutation not happening at all.
 */
export interface AuditLogger {
  record(tx: DbTx, input: AuditEventInput): Promise<AuditEvent>;
  recordAll(tx: DbTx, inputs: readonly AuditEventInput[]): Promise<readonly AuditEvent[]>;
}

/**
 * Locks one chain's anchor row for the rest of the caller's transaction, creating it at genesis
 * the first time that scope is written to.
 *
 * `SELECT … FOR UPDATE` and not `pg_advisory_lock`, for the same reason `src/draft-service/
 * store.ts` gives: this connection reaches Postgres through PgBouncer in transaction pooling
 * mode, where session-scoped state does not survive a statement boundary. A row lock is
 * transaction-scoped by construction.
 *
 * Auto-provisioning is race-safe under two writers creating the SAME new chain concurrently:
 * `INSERT … ON CONFLICT DO NOTHING` lets both transactions attempt the insert, exactly one row
 * survives, and the `SELECT … FOR UPDATE` that follows is what serializes the two writers onto
 * it — the second blocks on the lock rather than racing the first for who reads first.
 *
 * LOCK ORDER (ruling 3): this is always the LAST lock a transaction takes, a transaction appends
 * to at most one chain, and "lock" includes the implicit `FOR KEY SHARE` an INSERT takes on every
 * row it references. `applyAction` holds `drafts`, `setLineup` holds `stat_weeks`,
 * `joinLeagueInTx` holds `league_invites` then `leagues` — every one of them reaches this row
 * afterwards, with every FK-taking write of its own already done, and nothing reaches any of them
 * from here, so no cycle exists. See the interface docblock above for the cycle this rule was
 * rewritten to close.
 */
async function lockAnchor(tx: DbTx, scope: string): Promise<ChainAnchor> {
  await tx.insert(auditChains).values({ scope, headHash: GENESIS_HASH }).onConflictDoNothing();
  const [row] = await tx.select().from(auditChains).where(eq(auditChains.scope, scope)).for("update");
  // Unreachable through Postgres: the insert above either created the row or found it committed.
  if (row === undefined) throw new Error(`Audit chain "${scope}" vanished between insert and lock.`);
  return { headSequence: row.headSequence, headHash: row.headHash };
}

export function createAuditLogger({ newId }: { readonly newId: () => string }): AuditLogger {
  async function recordAll(tx: DbTx, inputs: readonly AuditEventInput[]): Promise<readonly AuditEvent[]> {
    if (inputs.length === 0) return [];

    const scopes = new Set(inputs.map((input) => scopeFor(input.leagueId)));
    if (scopes.size > 1) {
      throw new Error(`One transaction may append to one chain; this batch spans ${[...scopes].join(", ")}.`);
    }
    const scope = [...scopes][0]!;

    let anchor = await lockAnchor(tx, scope);
    const events: AuditEvent[] = [];
    for (const input of inputs) {
      // linkEvent hashes here, INSIDE the lock and before any insert, so a payload the canonical
      // encoder refuses fails the caller's transaction rather than writing a row it cannot hash.
      const event = linkEvent(input, anchor, newId());
      events.push(event);
      anchor = { headSequence: event.sequence, headHash: event.eventHash };
    }

    await tx.insert(auditEvents).values(events.map((event) => ({ ...event, occurredAt: new Date(event.occurredAt) })));
    // The rollup, advanced in the same transaction as the append it summarizes — the
    // balance-as-rollup convention, applied to the table it was written for. `updatedAt` comes
    // from the event's own injected clock, never from an ambient one.
    await tx
      .update(auditChains)
      .set({ headSequence: anchor.headSequence, headHash: anchor.headHash, updatedAt: new Date(events.at(-1)!.occurredAt) })
      .where(eq(auditChains.scope, scope));

    return events;
  }

  return {
    recordAll,
    async record(tx, input) {
      const [event] = await recordAll(tx, [input]);
      return event!;
    },
  };
}

/**
 * The process-wide logger, mirroring `getPublisher()`. Ids are `crypto.randomUUID()` at this one
 * edge, the same way every other id in this codebase is minted at a route or a service entry.
 */
let shared: AuditLogger | undefined;
export function getAuditLogger(): AuditLogger {
  shared ??= createAuditLogger({ newId: () => crypto.randomUUID() });
  return shared;
}
