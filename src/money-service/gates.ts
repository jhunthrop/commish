import type { ReadonlyDb } from "@/db/client";
import type { KycStatus } from "@/db/schema";
import { accountBalance } from "@/money-service/read";
import { accountIdFor } from "@/money/accounts";
import { MONEY_REFUSALS, type MoneyRefusalReason } from "@/money/config";
import type { MoneyStatesConfig, StateCode } from "@/money/states";

/**
 * The dossier's §4.2-4.4 as a single choke point, built once (Task 5 Step 2): every money door
 * in the product — the deposit door here, the paid-join door (Task 8), the withdrawal door
 * (Task 6, with its own documented self-exclusion carve-out) — calls this ONE function, in this
 * ONE order, and refuses with the same closed `MONEY_REFUSALS` sentences. Two doors implementing
 * "who may move money" separately is how one of them drifts.
 *
 * FAIL-FAST ORDER, per the brief and deliberately from cheapest-and-broadest to narrowest:
 *  1. STATE ENABLEMENT — `states.enabled` (`MONEY_STATES` in production, decision 7), which
 *     ships EMPTY: today this first gate refuses every caller everywhere, and the whole phase
 *     ships dark behind it. The state is self-attested at the door this phase and recorded as
 *     attested on every ledger row (Phase 5 Step 3 replaces the producer, not this consumer).
 *     A `MoneyStateEntry` cannot be typed into `enabled` without its `minAge`; the AGE that
 *     entry names is enforced by the KYC seam (Task 7) at verification time, because this
 *     product deliberately stores no date of birth — `kyc_status === "verified"` (gate 2) is
 *     the only age attestation the platform holds, so a gate-side age check would have nothing
 *     to read that KYC has not already answered.
 *  2. KYC — `kyc_status === "verified"` (the users column, Task 2; written only by Task 7's
 *     callback path). Says why in plain words: federal rules, before a balance.
 *  3. SELF-EXCLUSION — `self_excluded_at IS NULL`. One-way stamp; exclusion closes every door
 *     money ENTERS (deposit, paid join). Task 6's withdrawal door reuses gates 1-2 and
 *     documents why this one does not apply to money leaving.
 *  4. RECEIVABLE CLEAR — spend doors only (plan invariant 5): while a returned deposit's
 *     shortfall sits on `platform_receivable:<id>`, every paid door is closed. The DEPOSIT door
 *     deliberately skips this gate — the next completed deposit is HOW the receivable settles
 *     (`recordDepositCompleted`, `./deposits.ts`), so refusing deposits while owed would
 *     deadlock the member out of ever clearing it.
 */

/** Which class of door is asking. Spend doors add the receivable gate; the deposit door must not. */
export type MoneyDoor = "deposit" | "spend";

/** The two `users` columns the gates read, as a shape any caller's row satisfies. */
export interface MoneyGateSubject {
  readonly id: string;
  readonly kycStatus: KycStatus;
  readonly selfExcludedAt: Date | null;
}

export type MoneyGateOutcome = { readonly ok: true } | { readonly ok: false; readonly status: 403; readonly reason: MoneyRefusalReason };

const refused = (reason: MoneyRefusalReason): MoneyGateOutcome => ({ ok: false, status: 403, reason });

/**
 * True when `userId` owes the platform nothing from a returned deposit — the fourth guard on
 * every deposit-spend path (the brief's `moneyGates.receivableClear`). A SUM over the book
 * (`accountBalance`), never the rollup, per the read side's own law.
 */
export async function receivableIsClear(db: ReadonlyDb, userId: string): Promise<boolean> {
  return (await accountBalance(db, accountIdFor("platform_receivable", userId))) <= 0;
}

/** See the module docblock: the one choke point, checks in the enumerated fail-fast order. */
export async function moneyGates(
  db: ReadonlyDb,
  user: MoneyGateSubject,
  stateOfEntry: StateCode,
  door: MoneyDoor,
  states: MoneyStatesConfig,
): Promise<MoneyGateOutcome> {
  const entry = states.enabled.find((candidate) => candidate.state === stateOfEntry);
  if (entry === undefined) return refused(MONEY_REFUSALS.stateNotEnabled);
  if (user.kycStatus !== "verified") return refused(MONEY_REFUSALS.kycRequired);
  if (user.selfExcludedAt !== null) return refused(MONEY_REFUSALS.selfExcluded);
  if (door === "spend" && !(await receivableIsClear(db, user.id))) {
    return refused(MONEY_REFUSALS.balanceOwed);
  }
  return { ok: true };
}
