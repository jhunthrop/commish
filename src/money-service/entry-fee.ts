import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { moneyEntries, moneyTransactions, users } from "@/db/schema";
import { accountIdFor } from "@/money/accounts";
import { MONEY_REFUSALS } from "@/money/config";
import type { MoneyStatesConfig, StateCode } from "@/money/states";
import { moneyGates } from "./gates";
import { ensureAndLockMoneyAccounts, postMoneyTransaction, type PostDeps } from "./post";

/**
 * Entry fees at the doors that already exist (Phase 4, Task 8): the two in-transaction postings
 * that thread money through `joinLeagueInTx` (`@/league-service/join`) and `releaseSeat`
 * (`@/league-service/release`) WITHOUT changing either door's shape. Neither function here opens
 * a transaction or takes the `leagues` lock itself — both run inside the caller's transaction,
 * under the `leagues[X] FOR UPDATE` that caller already holds as its own first statement, which
 * is the global lock law arriving pre-satisfied rather than re-implemented.
 *
 * THE FREE-SEASON LAW lives one level up, on purpose: a league whose `entry_fee_cents` is `0`
 * never calls into this module at all — the caller's own short-circuit is what the statement-log
 * spy (`recordStatements`, `@/db/test-db`) proves as "a free join touches zero `money_*`
 * tables", and a gate inside this module could never make that claim, because reaching it is
 * already a money-table read away.
 */

/** What the fee collector needs injected: the posting deps plus the state list the gates read
 *  (`MONEY_STATES` in production — empty until the founder names a launch state, so every paid
 *  join refuses at the first gate; tests prove the enabled path with a test-only entry). */
export interface EntryFeeDeps extends PostDeps {
  readonly states: MoneyStatesConfig;
}

export interface CollectEntryFeeInput {
  readonly leagueId: string;
  readonly userId: string;
  /** The fee from the LOCKED `leagues` row the caller holds — never from a request body. */
  readonly entryFeeCents: number;
  /** The joiner's attested state of entry (decision 7's self-attestation this phase). */
  readonly stateOfEntry: StateCode;
}

export type CollectEntryFeeOutcome =
  | { readonly ok: true; readonly transactionId: string }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * Collects one seat's entry fee inside the caller's join transaction: gates via `moneyGates`
 * (door `"spend"`), then posts `entry_fee` — debit `user_available:<userId>`, credit
 * `league_escrow:<leagueId>`, the FULL fee (the rake is swept at settlement, ruling 6) — audited
 * `entry_fee_collected` on the league's own chain with the amount in the payload (the fee is a
 * published league term, ruling 10 and the Task 2 pre-ruling).
 *
 * THE RECEIVABLE RE-CHECK (Task 5 review carry, binding): `moneyGates`' fourth gate reads the
 * receivable as an UNLOCKED sum — advisory by design, because a concurrent ACH-return can book a
 * debt between that read and this posting. So after `ensureAndLockMoneyAccounts` takes the row
 * locks, the receivable's LOCKED rollup is re-read and a positive balance refuses with the same
 * `balanceOwed` sentence — the authoritative answer, decided while no concurrent transaction can
 * move it. The gate is the cheap early no; the re-check is the one that counts.
 *
 * FK ACQUISITIONS, ENUMERATED (the lock-order suite's own discipline; the caller's docblock
 * carries the composed order). In statement order this function takes:
 *  - `users[userId]`: plain SELECT, no lock.
 *  - `moneyGates`' receivable sum: plain SELECT over `money_entries`, no lock.
 *  - `money_accounts FOR UPDATE` for `league_escrow:<leagueId>`, `platform_receivable:<userId>`
 *    and `user_available:<userId>`, in SORTED id order via `ensureAndLockMoneyAccounts` — the
 *    identical deterministic order every money writer takes, so this posting queues (never
 *    cycles) against any concurrent standalone posting sharing a rollup row.
 *  - `postMoneyTransaction`'s own statements: its `leagues FOR UPDATE` re-locks the row the
 *    caller already holds (no new edge), its account locks re-lock the rows above (a pure
 *    prefix, no new edge), the `money_transactions`/`money_entries` inserts and rollup UPDATEs
 *    lock nothing new, and the `entry_fee_collected` anchor append lands on the league chain.
 *
 * Refusals return with ZERO rows written (`postMoneyTransaction`'s own guarantee for the balance
 * floor; the gates and the re-check return before any insert) — the caller's savepoint is what
 * additionally unwinds the seat insert, so `expectNoPostingTookPlace` and "no seat taken" hold
 * together.
 */
export async function collectEntryFeeInTx(tx: DbTx, input: CollectEntryFeeInput, deps: EntryFeeDeps): Promise<CollectEntryFeeOutcome> {
  const [subject] = await tx
    .select({ id: users.id, kycStatus: users.kycStatus, selfExcludedAt: users.selfExcludedAt })
    .from(users)
    .where(eq(users.id, input.userId));
  // A seat this deep in the join transaction always has a user row behind it; a missing one is a
  // caller bug, not a refusal a member should ever read.
  if (subject === undefined) throw new Error(`collectEntryFeeInTx: no user row for "${input.userId}".`);

  const gate = await moneyGates(tx, subject, input.stateOfEntry, "spend", deps.states);
  if (!gate.ok) return gate;

  const available = accountIdFor("user_available", input.userId);
  const escrow = accountIdFor("league_escrow", input.leagueId);
  const receivable = accountIdFor("platform_receivable", input.userId);
  const locked = await ensureAndLockMoneyAccounts(tx, [available, escrow, receivable]);
  // The re-check that counts — see the docblock. The rollup is readable here BECAUSE the row is
  // locked: `postMoneyTransaction` advances it in the same transaction as every entry, so under
  // this lock it cannot disagree with the book.
  if (locked.get(receivable)!.balanceCents > 0) {
    return { ok: false, status: 403, reason: MONEY_REFUSALS.balanceOwed };
  }

  const posted = await postMoneyTransaction(
    tx,
    {
      kind: "entry_fee",
      leagueId: input.leagueId,
      stateOfEntry: input.stateOfEntry,
      entries: [
        { accountId: available, direction: "debit", amountCents: input.entryFeeCents },
        { accountId: escrow, direction: "credit", amountCents: input.entryFeeCents },
      ],
      auditEvent: {
        eventType: "entry_fee_collected",
        actorId: input.userId,
        actorType: "user",
        leagueId: input.leagueId,
        payload: { amountCents: input.entryFeeCents },
      },
    },
    deps,
  );
  if (!posted.ok) return { ok: false, status: 409, reason: posted.reason };
  return { ok: true, transactionId: posted.transactionId };
}

export interface RefundEntryFeeInput {
  readonly leagueId: string;
  readonly userId: string;
}

/** One member's net entry-fee position in one league, read from the BOOK — see
 *  `entryFeeContributionInTx`. */
export interface EntryFeeContribution {
  /** Fees debited minus refunds credited, on this member's available account, for this league. */
  readonly netCents: number;
  /** `state_of_entry` from the LATEST fee posting, or `null` when the book holds no fee at all —
   *  the state a reversal (refund) or a payout attribution (settlement's per-seat rake) carries. */
  readonly lastFeeState: string | null;
}

/**
 * WHAT WENT IN, read from the book rather than re-attested — the read `refundEntryFeeInTx` has
 * always decided its amount from, extracted (Task 10) because settlement needs the identical
 * fact per seat: each seat's net contribution is what the escrow actually holds for it, and each
 * seat's latest fee state is the per-seat attribution the rake sweep stamps (plan ruling 10).
 * One reader, two consumers, or the refund's arithmetic and the settlement's could drift.
 */
export async function entryFeeContributionInTx(tx: DbTx, input: RefundEntryFeeInput): Promise<EntryFeeContribution> {
  const available = accountIdFor("user_available", input.userId);
  const rows = await tx
    .select({
      kind: moneyTransactions.kind,
      direction: moneyEntries.direction,
      stateOfEntry: moneyEntries.stateOfEntry,
      amountCents: moneyEntries.amountCents,
    })
    .from(moneyEntries)
    .innerJoin(moneyTransactions, eq(moneyEntries.transactionId, moneyTransactions.id))
    .where(
      and(
        eq(moneyEntries.accountId, available),
        eq(moneyTransactions.leagueId, input.leagueId),
        inArray(moneyTransactions.kind, ["entry_fee", "entry_fee_refund"]),
      ),
    )
    .orderBy(asc(moneyEntries.createdAt));

  // The net is a pure DIRECTION sum over the two fee kinds on this member's account — a fee's
  // debit adds, a refund's credit subtracts — never a per-kind special case, so the arithmetic
  // stays honest even against a leg shape no current writer produces.
  let netCents = 0;
  let lastFeeState: string | null = null;
  for (const row of rows) {
    netCents += row.direction === "debit" ? row.amountCents : -row.amountCents;
    if (row.kind === "entry_fee") lastFeeState = row.stateOfEntry;
  }
  return { netCents, lastFeeState };
}

export interface RefundEntryFeeOutcome {
  /** `0` when this member has nothing in this league's escrow — a seat that was never paid for
   *  (seeded, comped) or one whose fee already went back. No posting is made for a zero. */
  readonly refundedCents: number;
  readonly transactionId: string | null;
}

/**
 * The mirror posting (Task 8 Step 4): `entry_fee_refund` — debit `league_escrow:<leagueId>`,
 * credit `user_available:<userId>` — audited `entry_fee_refunded`, called by `releaseSeat`
 * inside its existing transaction (and by Task 9's dissolution, once per seated member).
 *
 * WHAT COMES BACK IS WHAT WENT IN, read from the BOOK rather than re-attested: the amount is the
 * member's net entry-fee contribution to this league (fees debited minus refunds already
 * credited — the join-release-rejoin cycle makes "minus refunds" load-bearing, not decorative),
 * and `state_of_entry` is carried from the latest fee posting itself, because a refund reverses
 * that exact motion and the releasing member attests nothing at this door. A net of zero posts
 * nothing: a member the book never charged has nothing in escrow to hand back, and minting a
 * zero-amount posting would fail `balancedOrRefuse`'s own positive-amount rule anyway.
 *
 * NO GATES, deliberately, on the withdrawal door's own reasoning (`moneyGates`' docblock): a
 * refund is money LEAVING the platform's escrow back to the person it belongs to. A self-excluded
 * member walking away from a paid seat is exactly who exclusion exists to protect, and holding
 * their fee hostage to a gate has no protective rationale behind it.
 *
 * FK ACQUISITIONS: the net read is a plain SELECT; every lock is `postMoneyTransaction`'s own —
 * `leagues FOR UPDATE` (a re-lock of the row `releaseSeat` already holds first, no new edge),
 * then the two rollup rows in sorted order, then the inserts, rollup UPDATEs and the
 * `entry_fee_refunded` anchor append. A refusal from the posting here is a BUG (the escrow holds
 * every net contribution by construction), so it throws and rolls the caller's whole release
 * back rather than deleting a seat while keeping its fee.
 */
export async function refundEntryFeeInTx(tx: DbTx, input: RefundEntryFeeInput, deps: PostDeps): Promise<RefundEntryFeeOutcome> {
  const available = accountIdFor("user_available", input.userId);
  const { netCents, lastFeeState } = await entryFeeContributionInTx(tx, input);
  if (lastFeeState === null || netCents <= 0) return { refundedCents: 0, transactionId: null };

  const posted = await postMoneyTransaction(
    tx,
    {
      kind: "entry_fee_refund",
      leagueId: input.leagueId,
      stateOfEntry: lastFeeState,
      entries: [
        { accountId: accountIdFor("league_escrow", input.leagueId), direction: "debit", amountCents: netCents },
        { accountId: available, direction: "credit", amountCents: netCents },
      ],
      auditEvent: {
        eventType: "entry_fee_refunded",
        actorId: input.userId,
        actorType: "user",
        leagueId: input.leagueId,
        payload: { amountCents: netCents },
      },
    },
    deps,
  );
  if (!posted.ok) throw new Error(`refundEntryFeeInTx: the refund posting refused: ${posted.reason}`);
  return { refundedCents: netCents, transactionId: posted.transactionId };
}
