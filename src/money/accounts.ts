/**
 * The account vocabulary: the closed set of account kinds the double-entry ledger ever posts
 * against, which side of the accounting equation each kind sits on, and the one place an account
 * id string is built or parsed — so a service-layer writer (`src/money-service/**`, a later task)
 * and a wallet component never invent their own `"user_available:" + userId` string in two places
 * that could drift.
 */

/**
 * `fbo_pool` — the pooled FBO account at the partner bank (founder decision 1): the one account
 *   real money physically sits in.
 * `provider_clearing` — in-flight money a `PaymentsProvider` (Seam A, a later task) reports as
 *   pending, not yet settled into or out of the pool.
 * `platform_receivable` — money the platform is owed but has not yet collected (a card-deposit
 *   fee surfaced to the platform rather than eaten, per founder decision 10's open question).
 * `user_available` — a member's spendable balance. Owner-scoped: one row per user.
 * `league_escrow` — a paid league's collected entry fees, held until settlement or refund.
 *   Owner-scoped: one row per league.
 * `held_for_review` — a member's balance frozen by an open integrity flag (`src/integrity-
 *   service/flags.ts`) rather than spendable or withdrawable. Owner-scoped: one row per user.
 * `platform_rake` — the platform's collected fixed per-entry fee (founder decision 10: fixed,
 *   NEVER percent-of-pool).
 * `platform_forfeiture` — money forfeited to the platform rather than refunded (a canceled
 *   withdrawal that never completed, an unresolved review that closes against the member).
 */
export const MONEY_ACCOUNT_KINDS = [
  "fbo_pool",
  "provider_clearing",
  "platform_receivable",
  "user_available",
  "league_escrow",
  "held_for_review",
  "platform_rake",
  "platform_forfeiture",
] as const;

export type MoneyAccountKind = (typeof MONEY_ACCOUNT_KINDS)[number];

/** The four kinds `accountIdFor`/`parseAccountId` scope to one owner id; the other four are
 *  platform-wide singletons with no owner suffix at all. */
const OWNER_SCOPED_KINDS: readonly MoneyAccountKind[] = [
  "user_available",
  "league_escrow",
  "held_for_review",
  "platform_receivable",
];

/** `fbo_pool` and `platform_receivable` are the two accounts that hold money the platform can
 *  point to (real cash at the bank, a receivable owed to it) — assets, in the accounting sense.
 *  Every other kind is a claim against that money (what a user, a league or the platform's own
 *  rake is owed out of it) — a liability. */
const ASSET_KINDS: readonly MoneyAccountKind[] = ["fbo_pool", "platform_receivable"];

export type MoneyAccountSide = "asset" | "liability";

/** Which side of the accounting equation `kind` sits on. The one function every balance
 *  computation defers to, so "asset" and "liability" are never hand-classified twice. */
export function accountSide(kind: MoneyAccountKind): MoneyAccountSide {
  return ASSET_KINDS.includes(kind) ? "asset" : "liability";
}

/**
 * The one function that knows an account's balance sign convention: an asset account's balance
 * grows with debits (money coming in) and shrinks with credits, a liability account's balance
 * grows with credits (a claim against the pool growing) and shrinks with debits — the ordinary
 * double-entry convention, restated here so no caller re-derives it (or gets it backwards) at a
 * call site.
 */
export function signedBalance(kind: MoneyAccountKind, debitsCents: number, creditsCents: number): number {
  return accountSide(kind) === "asset" ? debitsCents - creditsCents : creditsCents - debitsCents;
}

export type MoneyAccountId = string;

/**
 * Builds the one canonical id string for an account: `"<kind>:<ownerId>"` for the four
 * owner-scoped kinds, or the bare kind name for the four singletons. Overloaded so a caller
 * naming a singleton kind cannot even type-check an owner id argument in, and a caller naming an
 * owner-scoped kind cannot omit one.
 */
export function accountIdFor(
  kind: "user_available" | "league_escrow" | "held_for_review" | "platform_receivable",
  ownerId: string,
): MoneyAccountId;
export function accountIdFor(
  kind: "fbo_pool" | "provider_clearing" | "platform_rake" | "platform_forfeiture",
): MoneyAccountId;
export function accountIdFor(kind: MoneyAccountKind, ownerId?: string): MoneyAccountId {
  const isOwnerScoped = OWNER_SCOPED_KINDS.includes(kind);
  if (isOwnerScoped) {
    if (!ownerId) {
      throw new Error(`accountIdFor: "${kind}" requires an owner id.`);
    }
    return `${kind}:${ownerId}`;
  }
  if (ownerId) {
    throw new Error(`accountIdFor: "${kind}" is a singleton account and takes no owner id.`);
  }
  return kind;
}

export interface ParsedMoneyAccountId {
  readonly kind: MoneyAccountKind;
  readonly ownerId: string | null;
}

/**
 * The inverse of `accountIdFor`: round-trips any id that function built back into its kind and
 * owner id (`null` for a singleton). Refuses an id naming an unknown kind, and refuses an id
 * whose owner-id shape does not match its kind — an owner-scoped kind with no suffix, or a
 * singleton kind carrying one — the same two shapes `accountIdFor` itself refuses to build, so
 * the parser cannot be handed something the builder would never have produced.
 */
export function parseAccountId(id: MoneyAccountId): ParsedMoneyAccountId {
  const separatorIndex = id.indexOf(":");
  const kind = separatorIndex === -1 ? id : id.slice(0, separatorIndex);
  if (!MONEY_ACCOUNT_KINDS.includes(kind as MoneyAccountKind)) {
    throw new Error(`parseAccountId: "${id}" does not name a known money account kind.`);
  }
  const ownerId = separatorIndex === -1 ? null : id.slice(separatorIndex + 1);
  const isOwnerScoped = OWNER_SCOPED_KINDS.includes(kind as MoneyAccountKind);
  if (isOwnerScoped && (ownerId === null || ownerId === "")) {
    throw new Error(`parseAccountId: "${id}" is missing the owner id "${kind}" requires.`);
  }
  if (!isOwnerScoped && ownerId !== null) {
    throw new Error(`parseAccountId: "${id}" names the singleton account "${kind}" but carries an owner id.`);
  }
  return { kind: kind as MoneyAccountKind, ownerId };
}
