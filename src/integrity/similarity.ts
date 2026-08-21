import { INTEGRITY_CONFIG } from "./config";

/**
 * Where an address on a `NetworkProfile` entry came from — the same vocabulary
 * `session_signals.ip_source` (`@/integrity-service/session-signals`'s `IpSource`) stores,
 * duplicated here rather than imported so this pure module keeps consuming only
 * `INTEGRITY_CONFIG.multiAccount` and nothing else: `src/integrity-service` is the Postgres-backed
 * caller INTO `src/integrity` (it already imports `INTEGRITY_CONFIG`), and a type import running
 * the other direction would put a dependency edge where none belongs, purity aside. `ipCorrelation`
 * only ever counts `"platform_verified"` rows — see `INTEGRITY_CONFIG.multiAccount.weights`'s own
 * docblock for why.
 */
export type AddressSource = "xff_unverified" | "platform_verified";

/**
 * Every client signature (one per distinct device fingerprint) an account has ever signed in
 * with. Task 9 derives this from `session_signals` rows; `deviceSimilarity` never sees a row.
 */
export interface DeviceProfile {
  readonly signatures: readonly string[];
}

/** One address this account has signed in from, and whether the platform itself ever verified it
 *  — see `AddressSource`. */
export interface AddressObservation {
  readonly hash: string;
  readonly source: AddressSource;
}

/** Every address on record for an account, verified and unverified alike — `ipCorrelation` is the
 *  one place that tells them apart. */
export interface NetworkProfile {
  readonly addresses: readonly AddressObservation[];
}

/**
 * How long this account takes to act — draft picks, most likely, since Task 9 is the only caller
 * — reduced to one number (the median, in seconds) plus the sample size that median rests on.
 */
export interface CadenceProfile {
  readonly medianSeconds: number;
  readonly actions: number;
}

/** One heuristic's opinion of a single account pair, each on the same 0..1 scale. */
export interface SignalScores {
  readonly device: number;
  readonly ip: number;
  readonly behavioral: number;
}

/** `INTEGRITY_CONFIG.multiAccount.weights`'s own shape, named so `multiAccountSuspicion` does not
 *  have to repeat it inline. */
export interface SignalWeights {
  readonly device: number;
  readonly ip: number;
  readonly behavioral: number;
}

/**
 * `|A ∩ B| / |A ∪ B|` over two sets of strings. `0`, never `NaN`, when the union is empty — an
 * empty union is the degenerate case a Jaccard implementation gets wrong once, and a `NaN`
 * reaching `multiAccountSuspicion`'s weighted sum would silently poison the whole score.
 */
function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  let intersectionSize = 0;
  for (const value of setA) {
    if (setB.has(value)) intersectionSize += 1;
  }
  return intersectionSize / union.size;
}

/**
 * The overlap of the client signatures each account has ever signed in with — a Jaccard
 * similarity over `signatures`. `1` for two accounts that have only ever signed in from the same
 * one client; `0` for two that share nothing, including when either has never signed in at all.
 */
export function deviceSimilarity(a: DeviceProfile, b: DeviceProfile): number {
  return jaccard(a.signatures, b.signatures);
}

/**
 * The overlap of the addresses each account has signed in from — but ONLY the ones the platform
 * itself observed (`source === "platform_verified"`). Every hash written before Fly's proxy
 * overwrites `X-Forwarded-For` is caller-influenced, so it is not evidence of anything (ruling 8):
 * two accounts whose only shared address is `"xff_unverified"` correlate at `0`, not at `1`.
 */
export function ipCorrelation(a: NetworkProfile, b: NetworkProfile): number {
  const verifiedHashes = (profile: NetworkProfile): string[] =>
    profile.addresses.filter((address) => address.source === "platform_verified").map((address) => address.hash);
  return jaccard(verifiedHashes(a), verifiedHashes(b));
}

/**
 * How alike two accounts' pace is: `1 - min(1, |medianA - medianB| / cadenceToleranceSeconds)`,
 * floored at `0` rather than going negative when the two are nothing alike. Answers `0` — not a
 * guess — when either side's median rests on fewer than `minActionsForBehavioral` actions: a
 * median over two picks is noise, and noise fed into a weighted sum is a flag raised about a real
 * person on the strength of nothing.
 */
export function behavioralSimilarity(a: CadenceProfile, b: CadenceProfile): number {
  const { cadenceToleranceSeconds, minActionsForBehavioral } = INTEGRITY_CONFIG.multiAccount.signals;
  if (a.actions < minActionsForBehavioral || b.actions < minActionsForBehavioral) return 0;
  const distance = Math.abs(a.medianSeconds - b.medianSeconds) / cadenceToleranceSeconds;
  return 1 - Math.min(1, distance);
}

/**
 * The weighted mean of `scores` over `weights`, normalized by the weights actually in play — a
 * plain `Σ(w·s)` would silently halve every existing score's meaning the day a weight currently
 * at `0` (the IP release gate) flips on. `0`, never `NaN`, when every weight is `0`: a detector
 * with nothing switched on has nothing to say about a pair, not an undefined opinion about one.
 */
export function multiAccountSuspicion(scores: SignalScores, weights: SignalWeights): number {
  const signals: ReadonlyArray<keyof SignalScores> = ["device", "ip", "behavioral"];
  let weightedSum = 0;
  let weightSum = 0;
  for (const signal of signals) {
    weightedSum += weights[signal] * scores[signal];
    weightSum += weights[signal];
  }
  return weightSum === 0 ? 0 : weightedSum / weightSum;
}
