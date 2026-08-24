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
 * a non-positive, repeated, or non-integer place, or a non-positive prize amount, is refused
 * before the arithmetic identity is even checked, the same "refuse the shape before the sum"
 * discipline `balancedOrRefuse` (`./posting`) uses.
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

  const seenPlaces = new Set<number>();
  for (const entry of table) {
    if (!isPositiveInt(entry.place) || seenPlaces.has(entry.place) || !isPositiveInt(entry.amountCents)) {
      return { ok: false, reason: MONEY_REFUSALS.invalidPrizeTableEntry };
    }
    seenPlaces.add(entry.place);
  }

  const pot = entryFeeCents * seats;
  const totalRake = rakeCents * seats;
  const totalPrizes = table.reduce((sum, entry) => sum + entry.amountCents, 0);
  if (totalPrizes !== pot - totalRake) {
    return { ok: false, reason: MONEY_REFUSALS.prizeTableMismatch };
  }

  return { ok: true };
}
