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
} as const satisfies MoneyStatesConfig;

/**
 * The SHAPE of `MONEY_STATES`, as the one seam a money gate reads it through: `moneyGates`
 * (`src/money-service/gates.ts`, Task 5) takes this in its deps rather than importing the
 * constant, so its tests can prove the enabled-state path with a test-only entry while the
 * shipped list stays empty — the production caller passes `MONEY_STATES` itself, and the
 * `satisfies` above holds the constant to this shape.
 */
export interface MoneyStatesConfig {
  readonly enabled: readonly MoneyStateEntry[];
  readonly neverEligible: readonly StateCode[];
}

/** Money is live only once at least one state has been named. Every money-real surface — entry
 *  fee collection, the wallet, the free-season sentence — reads this rather than checking
 *  `MONEY_STATES.enabled` directly, so the whole phase has exactly one dark/live switch. */
export function moneyIsLive(): boolean {
  return MONEY_STATES.enabled.length > 0;
}

/**
 * The front door's state-eligibility line (front door blueprint, 2026-09-02): `null` while money
 * is dark — the line renders ONLY when money is live, and a null is an absent line, never filler
 * — and, once a list is named, a sentence derived entirely from the config itself: the count of
 * enabled states and the real minimum ages they carry, with the pointer at the state list's own
 * page. Takes the config as a parameter (the `moneyGates` seam's identical reasoning) so a test
 * can exercise the live sentence with a test-only entry while the shipped list stays empty; the
 * production caller passes `MONEY_STATES`.
 */
export function stateEligibilityLine(config: MoneyStatesConfig = MONEY_STATES): string | null {
  if (config.enabled.length === 0) return null;
  const ages = config.enabled.map((entry) => entry.minAge);
  const minAge = Math.min(...ages);
  const maxAge = Math.max(...ages);
  const agePhrase = minAge === maxAge ? `${minAge}+` : `${minAge}+ (${maxAge}+ in some states)`;
  const stateCount = `${config.enabled.length} ${config.enabled.length === 1 ? "state" : "states"}`;
  return `Real money is open in ${stateCount} · ${agePhrase} · state list under How it works`;
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
