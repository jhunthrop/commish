import { eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { draftActions, drafts, teams } from "@/db/schema";
import type { DraftAction } from "@research-ts/domain/draft";
import type { Clock } from "@research-ts/domain/timing";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import {
  behavioralSimilarity,
  deviceSimilarity,
  ipCorrelation,
  multiAccountSuspicion,
  type AddressObservation,
  type CadenceProfile,
  type DeviceProfile,
  type NetworkProfile,
  type SignalWeights,
} from "@/integrity/similarity";
import { getAuditLogger, type AuditLogger } from "./audit-logger";
// From `./raise-flag` directly, not `./flags` (Task 7) — this detector only ever RAISES a flag,
// never resolves one, and `./raise-flag` is the self-contained slice that keeps it that way; see
// that module's own docblock.
import { raiseFlag } from "./raise-flag";
import { signalsForUsers, type SessionSignal } from "./session-signals";

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * "u_b:u_a" and "u_a:u_b" are one question about one pair, never two. Sorting before joining is
 * what makes `raiseFlag`'s open-subject unique index (`account_pair` + `subjectId`) actually
 * dedupe a mirror-image sighting instead of opening a second row for it — the whole reason a
 * sweep can run twice (once from each side's `joinLeagueInTx`, or a manual re-run on top of a
 * trigger that already fired) and still land exactly one open flag per pair.
 *
 * Colon, not comma: `subjectFor`/`aboutFor`/`trailFor` (`@/integrity-service/flags`) split on
 * this same character, and a user id can legally contain a comma-free-but-otherwise-arbitrary
 * string from a future identity provider — a colon is no safer a bet in the abstract, but it is
 * the one this product's ids (WorkOS-issued, URL-safe) are known never to contain today.
 */
export function canonicalPairId(a: string, b: string): string {
  return [a, b].sort().join(":");
}

/** What one league-member account looks like to the detector, batched-read and pre-derived —
 *  never a row `deviceSimilarity`/`ipCorrelation`/`behavioralSimilarity` sees directly. */
interface AccountProfile {
  readonly userId: string;
  readonly device: DeviceProfile;
  readonly network: NetworkProfile;
  readonly cadence: CadenceProfile;
}

/**
 * A `session_signals` row reduced to one client-fingerprint STRING — `deviceSimilarity`'s
 * `DeviceProfile.signatures` never sees a row, only this. `userAgent`/`acceptLanguage` are the
 * two headers this phase has to fingerprint a client with; a row with NEITHER observed carries
 * no device signal at all and must not become a signature every no-data account shares (two
 * accounts that have never signed in would otherwise correlate at 1, the false positive this
 * guards against), so it is skipped rather than folded in as `"|"`.
 */
function signatureOf(signal: SessionSignal): string | null {
  if (signal.userAgent === null && signal.acceptLanguage === null) return null;
  return `${signal.userAgent ?? ""}|${signal.acceptLanguage ?? ""}`;
}

/**
 * Every distinct client signature this account signed in with, most recent first (`signalsForUsers`
 * already orders `occurredAt` desc) and capped at `maxSignaturesPerAccount` — the same growth-question
 * discipline `INTEGRITY_CONFIG.multiAccount.signals` documents on that field itself.
 */
function deviceProfileFor(signals: readonly SessionSignal[]): DeviceProfile {
  const cap = INTEGRITY_CONFIG.multiAccount.signals.maxSignaturesPerAccount;
  const signatures: string[] = [];
  const seen = new Set<string>();
  for (const signal of signals) {
    const signature = signatureOf(signal);
    if (signature === null || seen.has(signature)) continue;
    seen.add(signature);
    signatures.push(signature);
    if (signatures.length >= cap) break;
  }
  return { signatures };
}

/**
 * Every address this account signed in from, `ip_source` carried through so `ipCorrelation` can
 * keep counting only `"platform_verified"` rows (ruling 8) — a row with no observed address
 * (`ipHash === null`) contributes nothing, the same "absent is not evidence" rule
 * `deviceProfileFor` follows for a signal-less row.
 */
function networkProfileFor(signals: readonly SessionSignal[]): NetworkProfile {
  const addresses: AddressObservation[] = [];
  for (const signal of signals) {
    if (signal.ipHash === null) continue;
    addresses.push({ hash: signal.ipHash, source: signal.ipSource });
  }
  return { addresses };
}

/** The median of a non-empty list, `0` for an empty one (never reached with the sample floor
 *  `behavioralSimilarity` itself enforces, but honest for a caller with no floor of its own). */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * How long this account takes between its own draft picks, in seconds — `CadenceProfile`'s
 * "draft picks, most likely" (`@/integrity/similarity`'s own docblock), made literal:
 * `MAKE_PICK` is the one draft action every format submits with a real, submitting team behind
 * it (`NOMINATE`/`BID`/`SET_QUEUE` exist too, but a pick is the one action every draft format
 * and every league produces, so it is the one honest cross-format sample). `timestamps` is
 * already this account's own picks, in submission order — `sweepLeagueForMultiAccounts` sorts
 * before calling this so the gaps below are real consecutive gaps, not an artifact of query order.
 */
function cadenceProfileFor(timestamps: readonly Date[]): CadenceProfile {
  const gapsSeconds: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    gapsSeconds.push((timestamps[i]!.getTime() - timestamps[i - 1]!.getTime()) / 1000);
  }
  return { medianSeconds: median(gapsSeconds), actions: timestamps.length };
}

function isMakePick(action: unknown): action is DraftAction & { readonly type: "MAKE_PICK" } {
  return typeof action === "object" && action !== null && (action as { type?: unknown }).type === "MAKE_PICK";
}

/**
 * Reads exactly THREE batched queries regardless of how many members the league has — never one
 * per pair, never one per member — because an N² read over an N² comparison is how a detector
 * becomes the slowest thing in the join path (the spec's own framing, `countingDb` in
 * `multi-account.test.ts` asserts the count):
 *
 * 1. This league's members — `teams`, one row per seat.
 * 2. `signalsForUsers` — every `session_signals` row for every member, one query.
 * 3. This league's own draft's `MAKE_PICK` actions — one join, filtered to the league's single
 *    draft (`drafts.league_id` is unique — one draft per league).
 *
 * Everything after this is derivation over what these three already returned: no further I/O.
 */
async function profilesFor(db: Db, leagueId: string): Promise<readonly AccountProfile[]> {
  const members = await db.select({ userId: teams.userId, teamId: teams.id }).from(teams).where(eq(teams.leagueId, leagueId));
  const userIds = [...new Set(members.map((member) => member.userId))];
  if (userIds.length === 0) return [];

  const [signals, actionRows] = await Promise.all([
    signalsForUsers(db, userIds),
    db
      .select({ action: draftActions.action, timestamp: draftActions.timestamp })
      .from(draftActions)
      .innerJoin(drafts, eq(drafts.id, draftActions.draftId))
      .where(eq(drafts.leagueId, leagueId)),
  ]);

  const signalsByUser = new Map<string, SessionSignal[]>();
  for (const signal of signals) {
    const bucket = signalsByUser.get(signal.userId);
    if (bucket === undefined) signalsByUser.set(signal.userId, [signal]);
    else bucket.push(signal);
  }

  const teamOwner = new Map(members.map((member) => [member.teamId, member.userId]));
  const picksByUser = new Map<string, Date[]>();
  for (const row of actionRows) {
    if (!isMakePick(row.action)) continue;
    const ownerId = teamOwner.get(row.action.teamId);
    if (ownerId === undefined) continue; // a pick by a team no longer in this member list — nothing to attribute it to
    const bucket = picksByUser.get(ownerId);
    if (bucket === undefined) picksByUser.set(ownerId, [row.timestamp]);
    else bucket.push(row.timestamp);
  }

  return userIds.map((userId) => {
    const ownSignals = signalsByUser.get(userId) ?? [];
    const ownTimestamps = (picksByUser.get(userId) ?? []).sort((a, b) => a.getTime() - b.getTime());
    return {
      userId,
      device: deviceProfileFor(ownSignals),
      network: networkProfileFor(ownSignals),
      cadence: cadenceProfileFor(ownTimestamps),
    };
  });
}

/** Every unordered pair from a list, once each — `n·(n-1)/2` of them, a small constant for
 *  `LEAGUE_CONFIG.maxTeams`. */
function pairsOf<T>(items: readonly T[]): ReadonlyArray<readonly [T, T]> {
  const pairs: Array<readonly [T, T]> = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      pairs.push([items[i]!, items[j]!]);
    }
  }
  return pairs;
}

/**
 * What the sweep needs handed in rather than reaching for itself — `weights`/`flagThreshold` are
 * the spec's exit criterion made literal: a config-only edit (`sweepWith`'s own test) changes
 * flagging outcomes with no code change, which only holds if the sweep never reads
 * `INTEGRITY_CONFIG.multiAccount` on its own. `defaultSweepDeps` below is what every REAL caller
 * (the join-time trigger, the manual re-run script) actually passes.
 */
export interface SweepDeps {
  readonly weights: SignalWeights;
  readonly flagThreshold: number;
  readonly newId: () => string;
  readonly clock?: Clock;
  /** Defaults to the process-wide logger (`getAuditLogger()`). */
  readonly audit?: AuditLogger;
}

/** The real config, for the two real callers — never read by `sweepLeagueForMultiAccounts`
 *  itself (see `SweepDeps`'s own docblock). */
export function defaultSweepDeps(newId: () => string = () => crypto.randomUUID()): SweepDeps {
  return { weights: INTEGRITY_CONFIG.multiAccount.weights, flagThreshold: INTEGRITY_CONFIG.multiAccount.flagThreshold, newId };
}

export interface SweepResult {
  readonly leagueId: string;
  readonly pairsCompared: number;
  readonly flagsRaised: number;
}

/**
 * Compare every pair of accounts in ONE league and raise a flag for each pair over the
 * threshold. Never platform-wide — the spec bounds this for compute cost AND for false-positive
 * exposure, and the second reason is the one that matters: two strangers on one office network
 * who have never met are not a question anybody should be asked to answer.
 *
 * It is a SWEEP WITH TRIGGERS, not a subscriber (ruling 11). There are TWO, and each fires at a
 * moment one of the sweep's inputs comes into existence — both AFTER their own transaction
 * commits, never inside it, see `sweepQuietly` below and those files' own docblocks for the
 * lock-order reasoning:
 *
 *  1. A SEAT IS FILLED (`@/league-service/join`, `@/league-service/invites`). The pair set of a
 *     league changes exactly here and nowhere else.
 *  2. A DRAFT COMPLETES (`@/draft-service/store`). The behavioral signal changes exactly here:
 *     `profilesFor` derives cadence from this league's own `MAKE_PICK` rows, and a league has
 *     none of them until its draft has run. Final review, HIGH 2: with trigger 1 alone the
 *     detector could never raise anything in production — a join is refused once the draft
 *     leaves `scheduled`, so at every real firing of trigger 1 the behavioral score is pinned at
 *     `behavioralSimilarity`'s sample floor of 0 and the remaining weight cannot reach
 *     `flagThreshold`. `multi-account.test.ts`'s "the trigger timing that actually ships" drives
 *     both moments for real and pins that arithmetic.
 *
 * `scripts/sweep-multi-account.ts` is the manual re-run for a league whose signals moved after
 * both triggers had already fired. A subscriber on every session start would re-derive the same
 * answer thousands of times for a question whose inputs change twice.
 *
 * FLAGS ONLY. There is no branch in this file, or reachable from it, that takes any action
 * against an account — proved by `src/integrity/flag-only.test.ts` rather than asserted here.
 *
 * Each flag that crosses the threshold is raised in its OWN transaction, sequentially, rather
 * than batched into one: a sweep that raises three real flags and then hits an error on a fourth
 * pair must not roll the first three back — the person whose join triggered this did nothing
 * wrong, and neither did the two accounts already correctly flagged.
 */
export async function sweepLeagueForMultiAccounts(db: Db, leagueId: string, deps: SweepDeps): Promise<SweepResult> {
  const clock = deps.clock ?? systemClock;
  const profiles = await profilesFor(db, leagueId);
  const pairs = pairsOf(profiles);

  let flagsRaised = 0;
  for (const [a, b] of pairs) {
    const scores = {
      device: deviceSimilarity(a.device, b.device),
      ip: ipCorrelation(a.network, b.network),
      behavioral: behavioralSimilarity(a.cadence, b.cadence),
    };
    const total = multiAccountSuspicion(scores, deps.weights);
    if (total < deps.flagThreshold) continue;

    const occurredAt = clock.now();
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "multi_account",
        subjectId: canonicalPairId(a.userId, b.userId),
        leagueId,
        evidence: { device: scores.device, behavioral: scores.behavioral, ip: scores.ip, total },
        raisedByUserId: null, // the platform's own sweep, not a report — ruling 12
        occurredAt,
        newId: deps.newId,
        audit: deps.audit ?? getAuditLogger(),
      }),
    );
    flagsRaised += 1;
  }

  return { leagueId, pairsCompared: pairs.length, flagsRaised };
}

/** Which moment asked for a sweep. Recorded on the log line a swallowed failure leaves behind,
 *  so an operator re-running the script by hand knows which trigger dropped it. */
export type SweepTrigger = "league_join" | "draft_completed";

/**
 * The sweep, run for its side effect, with the failure isolation every TRIGGER needs — the one
 * place that swallow is implemented, shared by both doors into a league and by the draft store.
 *
 * A failed sweep must never fail the business write that triggered it: the person who joined,
 * and the ten people who just finished a draft, did nothing wrong, and an integrity read falling
 * over is not a reason to reject a seat or roll back a completed season. The error is logged and
 * `npm run integrity:sweep -- --league <id>` is the manual re-run.
 *
 * Callers invoke this AFTER their own `db.transaction(...)` has resolved. Lock order is the
 * reason, not convenience: the sweep appends `flag_raised` to the PLATFORM chain — an anchor lock
 * on a chain the triggering transaction has no reason to touch — while that transaction may
 * still hold `leagues` `FOR UPDATE` (both join doors), `league_invites` `FOR UPDATE` (the invite
 * door) or `drafts` `FOR UPDATE` (the draft store). Taking a third lock, on a chain anchor,
 * while two others are held is exactly the hazard `audit-logger.ts`'s own docblock spent a real
 * incident explaining. Outside the transaction the sweep's writes take no lock the trigger holds.
 */
export async function sweepQuietly(db: Db, leagueId: string, trigger: SweepTrigger, deps: SweepDeps = defaultSweepDeps()): Promise<void> {
  try {
    await sweepLeagueForMultiAccounts(db, leagueId, deps);
  } catch (error: unknown) {
    console.error("[integrity] multi-account sweep failed", { leagueId, trigger }, error);
  }
}
