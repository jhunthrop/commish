/**
 * The state-eligibility half of the money vocabulary (founder decision 7): the config mechanism
 * ships now, EMPTY BY DEFAULT. No state is enabled anywhere until the founder names the list with
 * counsel — `moneyIsLive()` is the single switch the whole phase ships dark behind, and every
 * money-real surface (the join path's fee collection, the wallet, the front door's "every league
 * is free this season" sentence) reads it rather than inferring liveness from something else.
 */

/** The fifty states plus the District of Columbia — the full domain `stateOfEntry` draws from. */
export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
] as const;

export type StateCode = (typeof US_STATE_CODES)[number];

/** One row of `MONEY_STATES.enabled`: a state the founder has named, with the minimum age it
 *  requires. The shape itself is the compiler's enforcement — a state cannot be added without
 *  stating its minimum age — `assertEnableable` below is the runtime half, pinning the never-
 *  eligible five even if one were ever typed into `enabled` by hand. */
export interface MoneyStateEntry {
  readonly state: StateCode;
  readonly minAge: number;
}

/**
 * Known matrix facts (payments dossier §4, `docs/research/2026-08-24-phase4-payments-research.md`
 * line 158, Saturday Down South's 2026 state tracker): Hawaii, Idaho, Montana, Nevada and
 * Washington have never permitted paid fantasy sports, DFS or season-long alike. That is a legal
 * fact about those five states, not a founder decision awaiting counsel, so it is pinned as its
 * own list rather than folded into `enabled`'s empty default.
 *
 * CA is not on either list; the 2025 AG opinion reached DFS and explicitly not season-long, and
 * counsel must reconcile that with the DFPI agent-of-payee guidance before CA is ever enabled
 * (Phase 8 item 1).
 */
export const MONEY_STATES = {
  /** Empty by default. The founder names this list with counsel — nothing else ever should. */
  enabled: [] as readonly MoneyStateEntry[],
  neverEligible: ["HI", "ID", "MT", "NV", "WA"] as readonly StateCode[],
} as const;

/** Money is live only once at least one state has been named. Every money-real surface — entry
 *  fee collection, the wallet, the free-season sentence — reads this rather than checking
 *  `MONEY_STATES.enabled` directly, so the whole phase has exactly one dark/live switch. */
export function moneyIsLive(): boolean {
  return MONEY_STATES.enabled.length > 0;
}

/**
 * The runtime guard a future writer to `MONEY_STATES.enabled` (Phase 8 item 1) must call before
 * adding a state: throws for any of the five states that have never permitted paid fantasy sports,
 * regardless of what minimum age it was typed in with. Every other state — including CA, which
 * carries the separate counsel-reconciliation note above rather than a runtime refusal — is
 * enableable as far as this function is concerned.
 */
export function assertEnableable(state: StateCode): void {
  if (MONEY_STATES.neverEligible.includes(state)) {
    throw new Error(`assertEnableable: ${state} has never permitted paid fantasy sports and cannot be enabled.`);
  }
}
