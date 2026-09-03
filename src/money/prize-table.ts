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

/**
 * The pot a published table actually pays — the sum of its prizes, which is `pot - rake` by the
 * invariant below. THE one place a "The pot" figure is derived (front door blueprint, 2026-09-02):
 * a shelf row and a join sheet advertising a paid league both read this sum of the STORED table,
 * never `entryFeeCents * seats` recomputed at a render site, so what the card promises is
 * exactly what settlement pays.
 */
export function prizePotCents(table: PrizeTable): number {
  return table.reduce((sum, entry) => sum + entry.amountCents, 0);
}

/**
 * How the pot splits across the podium when a table is derived rather than hand-published: the
 * create sheet's default (front door blueprint, 2026-09-02) — ZERO RAKE, the whole pot paid,
 * 50/30/20 across places 1..3 with rounding remainders to 1st. Zero rake on purpose: a default
 * may not invent platform economics, and "the pot pays the podium" is the crew pitch's own
 * sentence. Places whose floored share rounds to zero cents drop off the tail (shares decrease
 * monotonically, so contiguity from 1st survives), and their cents fold into 1st — the result
 * satisfies `prizeTableInvariant(entryFeeCents, 0, seats, table)` by construction, which the
 * tests assert rather than assume.
 *
 * `[]` for a non-positive fee or seat count: a free league publishes no table at all
 * (`leagues.payout_table` is `null`), never a zero-amount one.
 */
export function defaultPodiumPrizeTable(entryFeeCents: number, seats: number): PrizeTable {
  if (!isPositiveInt(entryFeeCents) || !isPositiveInt(seats)) return [];
  const pot = entryFeeCents * seats;
  if (!Number.isSafeInteger(pot)) return [];
  const shares = [0.5, 0.3, 0.2];
  const floored = shares.map((share) => Math.floor(pot * share));
  const paid = floored.filter((amount) => amount > 0);
  if (paid.length === 0) return [{ place: 1, amountCents: pot }];
  const remainder = pot - paid.reduce((sum, amount) => sum + amount, 0);
  return paid.map((amount, index) => ({ place: index + 1, amountCents: index === 0 ? amount + remainder : amount }));
}

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
