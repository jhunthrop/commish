import { MONEY_REFUSALS } from "./config";

/** One paid place: `place` 1 is first, 2 is second, and so on. A place with no entry here is
 *  unpaid — there is no zero-amount row, because founder decision 9 (no proration, prizes fixed
 *  in advance) means every paid place is a fixed number decided before the season starts. */
export interface PrizeTableEntry {
  readonly place: number;
  readonly amountCents: number;
}

export type PrizeTable = readonly PrizeTableEntry[];

export type PrizeTableInvariantResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/**
 * The invariant founder decision 10 exists to enforce: a published prize table is only ever valid
 * if its prizes plus the platform's fixed rake equal the pot EXACTLY — never approximately, never
 * percent-of-pool (the UIGEA posture the fixed-rake design is built around). The pot is
 * `entryFeeCents * seats`; the rake taken out of it is `rakeCents * seats`; what remains must be
 * exactly what the table pays out.
 *
 * Structural sanity runs first and cannot be skipped by an otherwise-balanced table: a table with
 * a non-positive, repeated, or non-integer place, a gap in the paid sequence, or a non-positive
 * prize amount, is refused before the arithmetic identity is even checked, the same "refuse the
 * shape before the sum" discipline `balancedOrRefuse` (`./posting`) uses.
 *
 * RULING: paid places must be CONTIGUOUS from 1 (1..N, no gaps) — `[{ place: 1, ... }, { place: 3,
 * ... }]` refuses even when its totals otherwise balance. A paid league advertises "pays 1st
 * through Nth"; a skipped place has no product meaning and is far more likely to be a data-entry
 * error (a typo'd place number) than a deliberate design, so the stricter reading is the safer one
 * for money.
 *
 * `entryFeeCents`, `rakeCents`, `seats` and every `entry.amountCents` are each checked against
 * `Number.isSafeInteger`, and so are the three sums this function computes from them (`pot`,
 * `totalRake`, `totalPrizes`): two individually representable amounts can still sum past
 * `Number.MAX_SAFE_INTEGER` and lose exact-cent precision, which a money invariant can never
 * tolerate (`MONEY_CONFIG.reconcileToleranceCents` is zero for the identical reason).
 */
export function prizeTableInvariant(
  entryFeeCents: number,
  rakeCents: number,
  seats: number,
  table: PrizeTable,
): PrizeTableInvariantResult {
  if (!isNonNegativeInt(entryFeeCents) || !isNonNegativeInt(rakeCents) || !isPositiveInt(seats)) {
    return { ok: false, reason: MONEY_REFUSALS.invalidPrizeTableInputs };
  }
  if (
    !Number.isSafeInteger(entryFeeCents) ||
    !Number.isSafeInteger(rakeCents) ||
    !Number.isSafeInteger(seats)
  ) {
    return { ok: false, reason: MONEY_REFUSALS.amountOverflow };
  }

  const seenPlaces = new Set<number>();
  for (const entry of table) {
    if (!isPositiveInt(entry.place) || seenPlaces.has(entry.place) || !isPositiveInt(entry.amountCents)) {
      return { ok: false, reason: MONEY_REFUSALS.invalidPrizeTableEntry };
    }
    if (!Number.isSafeInteger(entry.amountCents)) {
      return { ok: false, reason: MONEY_REFUSALS.amountOverflow };
    }
    seenPlaces.add(entry.place);
  }

  // RULING: places must run 1..N with no gaps — see this function's own docblock.
  for (let place = 1; place <= seenPlaces.size; place += 1) {
    if (!seenPlaces.has(place)) {
      return { ok: false, reason: MONEY_REFUSALS.invalidPrizeTableEntry };
    }
  }

  const pot = entryFeeCents * seats;
  const totalRake = rakeCents * seats;
  const totalPrizes = table.reduce((sum, entry) => sum + entry.amountCents, 0);
  if (!Number.isSafeInteger(pot) || !Number.isSafeInteger(totalRake) || !Number.isSafeInteger(totalPrizes)) {
    return { ok: false, reason: MONEY_REFUSALS.amountOverflow };
  }
  if (totalPrizes !== pot - totalRake) {
    return { ok: false, reason: MONEY_REFUSALS.prizeTableMismatch };
  }

  return { ok: true };
}
