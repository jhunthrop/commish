import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { auditEvents, draftActions, drafts, integrityFlags, leagues, sessionSignals, teams, users } from "@/db/schema";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { triggerMultiAccountSweep } from "@/league-service/join";
import { createAuditLogger } from "./audit-logger";
import { flagDetail, listPendingFlags } from "./flags";
import { listLeagueActivity } from "./activity";
import { canonicalPairId, defaultSweepDeps, sweepLeagueForMultiAccounts, type SweepDeps } from "./multi-account";

const db = createTestDb();
// Seconds deliberately NOT ending in "0": an ISO instant's own "SS.mmm" would otherwise read as
// a false-positive "score fragment" to the step-4 test's `/0\.\d{2}/` leak check below (e.g.
// "...:00.000Z" contains the literal substring "0.00"). This is a property of the STRING, not of
// what `listLeagueActivity` actually returns — a different clock sidesteps it honestly.
const NOW = "2026-08-20T18:00:07.000Z";

let idSeq = 0;
const nextId = (): string => `id_${(idSeq += 1)}`;
const logger = createAuditLogger({ newId: () => `evt_${nextId()}` });

const baseDeps: SweepDeps = {
  weights: INTEGRITY_CONFIG.multiAccount.weights,
  flagThreshold: INTEGRITY_CONFIG.multiAccount.flagThreshold,
  newId: nextId,
  clock: { now: () => NOW },
};

beforeEach(async () => {
  await truncateAll(db);
  idSeq = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

// ---------------------------------------------------------------------------------------------
// Low-level fixture primitives. Composed into the named scenarios the brief asks for below.
// ---------------------------------------------------------------------------------------------

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id }).onConflictDoNothing();
}

async function seedLeague(leagueId: string, commissionerUserId: string): Promise<void> {
  await seedUser(commissionerUserId);
  await db.insert(leagues).values({ id: leagueId, name: leagueId, format: "snake", teamCount: 10, commissionerUserId }).onConflictDoNothing();
}

async function seedTeam(leagueId: string, teamId: string, userId: string): Promise<void> {
  await seedUser(userId);
  await db.insert(teams).values({ id: teamId, leagueId, userId, name: userId });
}

interface SignalInput {
  readonly userAgent: string | null;
  readonly acceptLanguage: string | null;
  readonly ipHash?: string | null;
  readonly ipSource?: "xff_unverified" | "platform_verified";
  /** Seconds after `NOW`. `signalsForUsers` orders `occurredAt` DESC, so a higher offset here is
   *  a MORE recent sign-in — the one `deviceProfileFor`'s cap keeps when an account has more
   *  distinct signatures than `maxSignaturesPerAccount`. */
  readonly occurredAtOffsetSeconds?: number;
}

/** One `session_signals` row, inserted directly — `recordSessionSignals` needs
 *  `SESSION_SIGNAL_SALT` and a live transaction neither of which this fixture wants to fake. */
async function seedSignal(userId: string, input: SignalInput): Promise<void> {
  await db.insert(sessionSignals).values({
    id: nextId(),
    userId,
    occurredAt: new Date(Date.parse(NOW) + (input.occurredAtOffsetSeconds ?? 0) * 1000),
    userAgent: input.userAgent,
    acceptLanguage: input.acceptLanguage,
    ipHash: input.ipHash ?? null,
    ipSource: input.ipSource ?? "xff_unverified",
  });
}

async function seedDraft(leagueId: string, draftId: string): Promise<void> {
  await db.insert(drafts).values({ id: draftId, leagueId, format: "snake", status: "in_progress", kickoffAt: new Date(NOW) }).onConflictDoNothing();
}

const sequenceByDraft = new Map<string, number>();

/** Real `MAKE_PICK` rows on `draftId`'s own action log, one per `timestampsIso`, all attributed
 *  to `teamId` — `cadenceProfileFor`'s own consecutive-gap median is what these exist to drive. */
async function seedPicks(draftId: string, teamId: string, timestampsIso: readonly string[]): Promise<void> {
  const start = sequenceByDraft.get(draftId) ?? 0;
  await db.insert(draftActions).values(
    timestampsIso.map((timestamp, i) => ({
      draftId,
      sequence: start + i + 1,
      action: { v: 1, type: "MAKE_PICK", timestamp, teamId, playerId: nextId() },
      timestamp: new Date(timestamp),
    })),
  );
  sequenceByDraft.set(draftId, start + timestampsIso.length);
}

/** `count` timestamps, `gapSeconds` apart, starting `offsetMs` after `NOW`. */
function evenlySpaced(count: number, gapSeconds: number, offsetMs = 0): readonly string[] {
  const start = Date.parse(NOW) + offsetMs;
  return Array.from({ length: count }, (_, i) => new Date(start + i * gapSeconds * 1000).toISOString());
}

async function openFlags(database: Db = db) {
  return database.select().from(integrityFlags).where(isNull(integrityFlags.resolvedAt));
}

// ---------------------------------------------------------------------------------------------
// Named scenarios. Two accounts, a league, and enough signal to produce a specific score shape.
// ---------------------------------------------------------------------------------------------

/**
 * Two accounts that signed in from the SAME one client (`deviceSimilarity` = 1) and draft at the
 * identical pace (`behavioralSimilarity` = 1) — `0.6·1 + 0.4·1 = 1.0`, comfortably over the
 * default threshold on device and behavioral alone. Reused for every scenario in this file that
 * just needs "a pair that clears the bar", including the three known-false-positives: a shared
 * client signature is the honest mechanism behind roommates trading a laptop, a family's one
 * shared computer, and (with the identical cadence alongside it) two friends who happen to draft
 * the same way — the flavor differs, the signal shape a detector actually SEES does not.
 */
async function twoAccountsOnOneDevice(database: Db, opts: { readonly leagueId: string }): Promise<{ readonly userA: string; readonly userB: string }> {
  const { leagueId } = opts;
  const commish = `${leagueId}_commish`;
  const userA = `${leagueId}_ua`;
  const userB = `${leagueId}_ub`;
  const teamA = `${leagueId}_ta`;
  const teamB = `${leagueId}_tb`;
  const draftId = `${leagueId}_draft`;

  await seedLeague(leagueId, commish);
  await seedTeam(leagueId, teamA, userA);
  await seedTeam(leagueId, teamB, userB);

  await seedSignal(userA, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US" });
  await seedSignal(userB, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US" });

  await seedDraft(leagueId, draftId);
  const minActions = INTEGRITY_CONFIG.multiAccount.signals.minActionsForBehavioral;
  await seedPicks(draftId, teamA, evenlySpaced(minActions + 1, 30));
  await seedPicks(draftId, teamB, evenlySpaced(minActions + 1, 30, 5_000));

  return { userA, userB };
}

/**
 * THE release-gate fixture: device and behavioral both overlap fully, and there is no
 * `platform_verified` address on record for either account at all (`ipCorrelation` is computed
 * honestly and lands on 0 the same way every account's does today — see `session-signals.ts`'s
 * `CURRENT_IP_SOURCE`). Mechanically identical to `twoAccountsOnOneDevice`; named separately
 * because the property it proves ("crosses on device+behavioral, ip weight at zero") is a
 * different claim than "compares only accounts that share the league".
 */
async function pairSharingADeviceButNotAnAddress(database: Db, leagueId: string): Promise<{ readonly userA: string; readonly userB: string }> {
  return twoAccountsOnOneDevice(database, { leagueId });
}

/**
 * The weakest of the three known-false-positive signals: device overlap is PARTIAL (3 of the 5
 * distinct signatures across the pair — Jaccard 0.6), never a shared laptop, while behavioral
 * similarity is exact (`1.0`, the same draft-night pace). `0.6·0.6 + 0.4·1.0 = 0.76` — just over
 * the 0.75 threshold, the weakest flag of the three this file raises.
 */
async function friendsWhoDraftAtTheSameTempo(database: Db, leagueId: string): Promise<{ readonly userA: string; readonly userB: string }> {
  const commish = `${leagueId}_commish`;
  const userA = `${leagueId}_ua`;
  const userB = `${leagueId}_ub`;
  const teamA = `${leagueId}_ta`;
  const teamB = `${leagueId}_tb`;
  const draftId = `${leagueId}_draft`;

  await seedLeague(leagueId, commish);
  await seedTeam(leagueId, teamA, userA);
  await seedTeam(leagueId, teamB, userB);

  // A = {s1, s2, s3}; B = {s1, s2, s3, s4, s5} -> |intersection| 3 / |union| 5 = 0.6.
  for (const ua of ["s1", "s2", "s3"]) await seedSignal(userA, { userAgent: ua, acceptLanguage: "en-US" });
  for (const ua of ["s1", "s2", "s3", "s4", "s5"]) await seedSignal(userB, { userAgent: ua, acceptLanguage: "en-US" });

  await seedDraft(leagueId, draftId);
  const minActions = INTEGRITY_CONFIG.multiAccount.signals.minActionsForBehavioral;
  await seedPicks(draftId, teamA, evenlySpaced(minActions + 1, 20));
  await seedPicks(draftId, teamB, evenlySpaced(minActions + 1, 20, 5_000));

  return { userA, userB };
}

// ---------------------------------------------------------------------------------------------

describe("canonicalPairId", () => {
  it("raises one flag per pair, with a canonical subject id, however the sweep is ordered", () => {
    // "u_a:u_b" and "u_b:u_a" are one question. canonicalPairId sorts, so the open-subject
    // unique index actually catches the second sighting rather than opening a mirror-image
    // duplicate.
    expect(canonicalPairId("u_b", "u_a")).toBe("u_a:u_b");
    expect(canonicalPairId("u_a", "u_b")).toBe("u_a:u_b");
  });
});

describe("sweepLeagueForMultiAccounts", () => {
  it("compares only accounts that share the league it was asked about", async () => {
    // Never platform-wide: the spec bounds this for compute cost AND for false-positive
    // exposure, and the second reason is the one that matters. Two strangers on one office
    // network who have never met are not a question anybody should be asked to answer.
    await twoAccountsOnOneDevice(db, { leagueId: "lg_1" });
    await twoAccountsOnOneDevice(db, { leagueId: "lg_2" });

    const result = await sweepLeagueForMultiAccounts(db, "lg_1", baseDeps);
    expect(result.pairsCompared).toBe(1);
    expect(await openFlags(db)).toHaveLength(1);
  });

  it("stores the scores that raised it, because they will not be true by the time a human looks", async () => {
    await twoAccountsOnOneDevice(db, { leagueId: "lg_evidence" });
    await sweepLeagueForMultiAccounts(db, "lg_evidence", baseDeps);

    const [flag] = await openFlags(db);
    expect(flag!.evidence).toMatchObject({ device: expect.any(Number), behavioral: expect.any(Number), ip: 0, total: expect.any(Number) });
  });

  it("dedupes a real second sighting through raiseFlag's own confirmation path, sweeping twice and once via the join door", async () => {
    // F3 (fix round 1, review MEDIUM): `canonicalPairId`'s sort algebra was proven in isolation,
    // but nothing drove a SECOND sighting of the same pair through the REAL path. This does:
    // `sweepLeagueForMultiAccounts` runs three times total against one league whose pair stays
    // over threshold the whole time — twice directly, once through `triggerMultiAccountSweep`
    // (the join door's own trigger, cheap to call here with a fabricated `JoinLeagueOutcome`
    // rather than driving a real join end to end, which `join.test.ts`/`invites.test.ts` already
    // do for the wiring itself).
    const { userA, userB } = await twoAccountsOnOneDevice(db, { leagueId: "lg_dedupe" });

    const first = await sweepLeagueForMultiAccounts(db, "lg_dedupe", baseDeps);
    expect(first.flagsRaised).toBe(1);
    const afterFirst = await openFlags(db);
    expect(afterFirst).toHaveLength(1);
    const flagId = afterFirst[0]!.id;

    // Second sighting, direct. `raiseFlag`'s own docblock: "a second detector run finding the
    // same pair is not news" — the open-subject unique index conflicts, `existingOpenFlagFor`
    // reads the SAME row back, and NO second `flag_raised` event is appended (checked below).
    const second = await sweepLeagueForMultiAccounts(db, "lg_dedupe", baseDeps);
    expect(second.flagsRaised).toBe(1); // the sweep still counts a pair over threshold as "raised" —
    // idempotent confirmation, not "found nothing" — see `sweepLeagueForMultiAccounts`'s own docblock.
    const afterSecond = await openFlags(db);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]!.id).toBe(flagId); // the SAME row, not a new one — the confirmation path, not a duplicate

    // Third sighting, through the OTHER door: `triggerMultiAccountSweep` is the exact function
    // `joinPublicLeague`/`acceptInvite` call after their own transaction commits (ruling 11) —
    // exercised here directly rather than driving a full join, since it is a thin, already-tested
    // wrapper around this same `sweepLeagueForMultiAccounts` call.
    await triggerMultiAccountSweep(db, { ok: true, leagueId: "lg_dedupe", teamId: "irrelevant", alreadyMember: false }, baseDeps);
    const afterThird = await openFlags(db);
    expect(afterThird).toHaveLength(1);
    expect(afterThird[0]!.id).toBe(flagId);
    expect(afterThird[0]!.subjectId).toBe(canonicalPairId(userA, userB));

    // The real, literal manifestation of "confirmation, not a duplicate" for THIS subject type:
    // `account_pair` flags have no reporter table and no `confirmedAt` column (unlike
    // `review_report`/`chat_report`, whose confirmation shows up as a second reporter row) — the
    // audit trail is the record, and it moved exactly once, on the FIRST sighting only.
    const raisedEvents = await db.select().from(auditEvents).where(and(eq(auditEvents.eventType, "flag_raised"), sql`${auditEvents.payload} ->> 'flagId' = ${flagId}`));
    expect(raisedEvents).toHaveLength(1);
  });

  it("does not flag a pair below the threshold, and a config change alone flips that", async () => {
    // The spec's exit criterion: a test proves changing the config changes flagging outcomes
    // with no code change. The sweep takes its weights and threshold as an argument for exactly
    // this. Fixed at device=1 (identical signature), behavioral=0.5 (30s medians apart against a
    // 60s tolerance) -> total = 0.6·1 + 0.4·0.5 = 0.8, deliberately between the two thresholds
    // below.
    const leagueId = "lg_threshold";
    const commish = `${leagueId}_commish`;
    const [userA, userB, teamA, teamB, draftId] = [`${leagueId}_ua`, `${leagueId}_ub`, `${leagueId}_ta`, `${leagueId}_tb`, `${leagueId}_draft`];
    await seedLeague(leagueId, commish);
    await seedTeam(leagueId, teamA, userA);
    await seedTeam(leagueId, teamB, userB);
    await seedSignal(userA, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US" });
    await seedSignal(userB, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US" });
    await seedDraft(leagueId, draftId);
    const minActions = INTEGRITY_CONFIG.multiAccount.signals.minActionsForBehavioral;
    // +2, not +1: an EVEN number of gaps (6, not 5) so `median`'s even-length branch (the
    // average of the two middle values) is exercised here rather than only its odd-length one.
    await seedPicks(draftId, teamA, evenlySpaced(minActions + 2, 30));
    await seedPicks(draftId, teamB, evenlySpaced(minActions + 2, 60, 5_000));

    const sweepWith = (overrides: Partial<SweepDeps>) => sweepLeagueForMultiAccounts(db, leagueId, { ...baseDeps, ...overrides });

    expect(await sweepWith({ flagThreshold: 0.95 })).toMatchObject({ flagsRaised: 0 });
    expect(await sweepWith({ flagThreshold: 0.5 })).toMatchObject({ flagsRaised: 1 });
  });

  it("crosses the threshold on device and behavioral alone, with the ip weight at zero", async () => {
    // THE release-gate test. If this ever fails, the detector has become dependent on a
    // forgeable header and the honest fix is the heuristic, never the weight.
    await pairSharingADeviceButNotAnAddress(db, "lg_gate");
    const result = await sweepLeagueForMultiAccounts(db, "lg_gate", baseDeps);
    expect(result.flagsRaised).toBe(1);
    expect(INTEGRITY_CONFIG.multiAccount.weights.ip).toBe(0);
  });

  it("computes ipCorrelation honestly over a real observed address, and it still lands on 0 today", async () => {
    // Not a hardcoded 0 — `networkProfileFor` really does build a `NetworkProfile` from an
    // observed `ipHash`, and `ipCorrelation` really does see it. It reads 0 anyway, because
    // `session-signals.ts`'s `CURRENT_IP_SOURCE` stamps every row `xff_unverified` until Fly's
    // proxy owns `X-Forwarded-For` — the same release gate the test above proves at the weight.
    const leagueId = "lg_address";
    const [userA, userB, teamA, teamB, draftId] = [`${leagueId}_ua`, `${leagueId}_ub`, `${leagueId}_ta`, `${leagueId}_tb`, `${leagueId}_draft`];
    await seedLeague(leagueId, `${leagueId}_commish`);
    await seedTeam(leagueId, teamA, userA);
    await seedTeam(leagueId, teamB, userB);
    await seedSignal(userA, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US", ipHash: "shared_home_hash" });
    await seedSignal(userB, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US", ipHash: "shared_home_hash" });
    await seedDraft(leagueId, draftId);
    const minActions = INTEGRITY_CONFIG.multiAccount.signals.minActionsForBehavioral;
    await seedPicks(draftId, teamA, evenlySpaced(minActions + 1, 30));
    await seedPicks(draftId, teamB, evenlySpaced(minActions + 1, 30, 5_000));

    await sweepLeagueForMultiAccounts(db, leagueId, baseDeps);
    const [flag] = await openFlags(db);
    expect(flag!.evidence).toMatchObject({ ip: 0 });
  });

  it("reads exactly three batched queries regardless of how many pairs it compares", async () => {
    // An N² read over an N² comparison is how this becomes the slowest thing in the join path.
    // Four members with NO signal at all -> C(4,2) = 6 pairs compared, zero flags raised (every
    // score is 0), and still exactly three queries: the members, `signalsForUsers`, and the
    // draft-actions join.
    const leagueId = "lg_counting";
    await seedLeague(leagueId, `${leagueId}_commish`);
    for (let i = 1; i <= 4; i += 1) await seedTeam(leagueId, `${leagueId}_t${i}`, `${leagueId}_u${i}`);

    const counting = countingDb(db);
    const result = await sweepLeagueForMultiAccounts(counting.db, leagueId, baseDeps);
    expect(result.pairsCompared).toBe(6);
    expect(result.flagsRaised).toBe(0);
    expect(counting.selectCount()).toBe(3);
  });

  it("does not let a signal-less session_signals row become a shared signature between two accounts", async () => {
    // Two accounts whose only rows recorded NOTHING (no `userAgent`, no `acceptLanguage`) would
    // otherwise correlate at deviceSimilarity=1 on the empty string both would fold to — the
    // degenerate case `signatureOf` exists to refuse. A partial row (one header present) is a
    // REAL signature, not another no-data case, so it is folded in as usual.
    const leagueId = "lg_nodata";
    const [userA, userB, teamA, teamB] = [`${leagueId}_ua`, `${leagueId}_ub`, `${leagueId}_ta`, `${leagueId}_tb`];
    await seedLeague(leagueId, `${leagueId}_commish`);
    await seedTeam(leagueId, teamA, userA);
    await seedTeam(leagueId, teamB, userB);
    await seedSignal(userA, { userAgent: null, acceptLanguage: null });
    await seedSignal(userA, { userAgent: null, acceptLanguage: "en-US" });
    await seedSignal(userA, { userAgent: "SomeClient/1.0", acceptLanguage: null });
    await seedSignal(userB, { userAgent: null, acceptLanguage: null });

    const result = await sweepLeagueForMultiAccounts(db, leagueId, baseDeps);
    expect(result.flagsRaised).toBe(0);
  });

  it("folds a repeated sign-in from the same client into one signature, not two", async () => {
    // The same one client signature recorded twice for one account (a second sign-in, nothing
    // new) must not double-count — `deviceProfileFor`'s de-duplication, not `deviceSimilarity`'s
    // own Jaccard math, is what this exercises.
    const leagueId = "lg_dupe";
    const [userA, userB, teamA, teamB, draftId] = [`${leagueId}_ua`, `${leagueId}_ub`, `${leagueId}_ta`, `${leagueId}_tb`, `${leagueId}_draft`];
    await seedLeague(leagueId, `${leagueId}_commish`);
    await seedTeam(leagueId, teamA, userA);
    await seedTeam(leagueId, teamB, userB);
    await seedSignal(userA, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US" });
    await seedSignal(userA, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US", occurredAtOffsetSeconds: 60 });
    await seedSignal(userB, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US" });
    await seedDraft(leagueId, draftId);
    const minActions = INTEGRITY_CONFIG.multiAccount.signals.minActionsForBehavioral;
    await seedPicks(draftId, teamA, evenlySpaced(minActions + 1, 30));
    await seedPicks(draftId, teamB, evenlySpaced(minActions + 1, 30, 5_000));

    await sweepLeagueForMultiAccounts(db, leagueId, baseDeps);
    const [flag] = await openFlags(db);
    // Still 1 (the SAME one signature, seen twice), not diluted by a phantom second one.
    expect((flag!.evidence as { device: number }).device).toBe(1);
  });

  it("caps the signatures folded into one account's profile at maxSignaturesPerAccount", async () => {
    // An account with more distinct client signatures than the cap keeps only its MOST RECENT
    // ones — `signalsForUsers` orders `occurredAt` desc and `deviceProfileFor` stops there.
    const leagueId = "lg_cap";
    const [userA, userB, teamA, teamB] = [`${leagueId}_ua`, `${leagueId}_ub`, `${leagueId}_ta`, `${leagueId}_tb`];
    await seedLeague(leagueId, `${leagueId}_commish`);
    await seedTeam(leagueId, teamA, userA);
    await seedTeam(leagueId, teamB, userB);
    const cap = INTEGRITY_CONFIG.multiAccount.signals.maxSignaturesPerAccount;
    // Offsets 0..cap+4, oldest (offset 0) to newest (offset cap+4) — the cap keeps only the
    // newest `cap` of them, dropping the oldest 5.
    for (let i = 0; i < cap + 5; i += 1) {
      await seedSignal(userA, { userAgent: `UA-${i}`, acceptLanguage: "en-US", occurredAtOffsetSeconds: i });
    }
    // Matches userA's OLDEST signature — one of the five the cap drops.
    await seedSignal(userB, { userAgent: "UA-0", acceptLanguage: "en-US" });

    const result = await sweepLeagueForMultiAccounts(db, leagueId, baseDeps);
    expect(result.pairsCompared).toBe(1);
    expect(result.flagsRaised).toBe(0); // the dropped signature correlates nothing
  });

  it("compares nothing for a league with no members, costing no pair and raising no flag", async () => {
    await seedLeague("lg_empty", "lg_empty_commish");
    const result = await sweepLeagueForMultiAccounts(db, "lg_empty", baseDeps);
    expect(result).toEqual({ leagueId: "lg_empty", pairsCompared: 0, flagsRaised: 0 });
  });

  it("skips a non-MAKE_PICK draft action and a pick attributed to a team no longer in the league", async () => {
    // Neither is a hypothetical: `SET_QUEUE` shares the same action log every `MAKE_PICK` does,
    // and a team a later cleanup removed (or a stray row) would otherwise attribute a real pick
    // to nobody's `AccountProfile`. Both must be inert, not crash the sweep.
    const leagueId = "lg_noise";
    const [userA, userB, teamA, teamB, draftId] = [`${leagueId}_ua`, `${leagueId}_ub`, `${leagueId}_ta`, `${leagueId}_tb`, `${leagueId}_draft`];
    await seedLeague(leagueId, `${leagueId}_commish`);
    await seedTeam(leagueId, teamA, userA);
    await seedTeam(leagueId, teamB, userB);
    await seedSignal(userA, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US" });
    await seedSignal(userB, { userAgent: "SharedClient/1.0", acceptLanguage: "en-US" });
    await seedDraft(leagueId, draftId);

    await db.insert(draftActions).values([
      { draftId, sequence: 1, action: { v: 1, type: "SET_QUEUE", timestamp: NOW, teamId: teamA, playerIds: [] }, timestamp: new Date(NOW) },
      { draftId, sequence: 2, action: { v: 1, type: "MAKE_PICK", timestamp: NOW, teamId: "team_not_in_this_league", playerId: "ghost" }, timestamp: new Date(NOW) },
    ]);
    sequenceByDraft.set(draftId, 2);

    const minActions = INTEGRITY_CONFIG.multiAccount.signals.minActionsForBehavioral;
    await seedPicks(draftId, teamA, evenlySpaced(minActions + 1, 30));
    await seedPicks(draftId, teamB, evenlySpaced(minActions + 1, 30, 5_000));

    const result = await sweepLeagueForMultiAccounts(db, leagueId, baseDeps);
    expect(result.flagsRaised).toBe(1); // the noise neither broke the sweep nor polluted a real profile
  });

  it("stamps a raised flag with the real clock when the caller supplies none — the two real callers' own path", async () => {
    // `defaultSweepDeps` (`join.ts`'s trigger, `sweep-multi-account.ts`) never sets `clock` —
    // only tests do, to make `occurredAt` deterministic. This is the one test that leaves it out
    // too, so the real fallback (`systemClock`) is the thing actually raising the flag.
    const { userA, userB } = await twoAccountsOnOneDevice(db, { leagueId: "lg_realclock" });
    const before = Date.now();
    const result = await sweepLeagueForMultiAccounts(db, "lg_realclock", { ...defaultSweepDeps(nextId), clock: undefined });
    expect(result.flagsRaised).toBe(1);
    const [flag] = await openFlags(db);
    expect(flag!.subjectId).toBe(canonicalPairId(userA, userB));
    expect(Date.parse(flag!.raisedAt.toISOString())).toBeGreaterThanOrEqual(before);
  });

  describe("known false positives, which are CORRECT behavior and not defects", () => {
    it("flags two roommates on one wifi, and that is the right answer", async () => {
      // A flag is a question for a human, never an action against an account. Two roommates in
      // one league SHOULD reach an operator's queue; an operator resolves it `no_action` in ten
      // seconds and nobody is ever told they were looked at (ruling 6). Suppressing this flag
      // would mean suppressing the real case that looks identical from here. DO NOT "FIX" THIS
      // TEST.
      const { userA, userB } = await twoAccountsOnOneDevice(db, { leagueId: "lg_roommates" });
      const result = await sweepLeagueForMultiAccounts(db, "lg_roommates", baseDeps);
      expect(result.flagsRaised).toBe(1);
      const [flag] = await openFlags(db);
      expect(flag!.subjectId).toBe(canonicalPairId(userA, userB));
    });

    it("flags a family sharing one laptop, and that is the right answer", async () => {
      // Same reasoning: one shared client signature is exactly what a shared household computer
      // produces, and it is not this detector's job to decide that's innocent — that decision
      // belongs to the human who resolves the flag, not to code that never raises it.
      await twoAccountsOnOneDevice(db, { leagueId: "lg_family" });
      const result = await sweepLeagueForMultiAccounts(db, "lg_family", baseDeps);
      expect(result.flagsRaised).toBe(1);
    });

    it("flags two friends who happen to draft at the same tempo, and that is the right answer", async () => {
      // The weakest of the three signals producing the weakest of the three flags. It is still a
      // question, it is still cheap to answer, and the alternative is a detector that misses the
      // one-person-two-accounts case it exists for, because one person drafts at one tempo.
      await friendsWhoDraftAtTheSameTempo(db, "lg_friends");
      const result = await sweepLeagueForMultiAccounts(db, "lg_friends", baseDeps);
      expect(result.flagsRaised).toBe(1);
      const [flag] = await openFlags(db);
      expect((flag!.evidence as { total: number }).total).toBeGreaterThanOrEqual(INTEGRITY_CONFIG.multiAccount.flagThreshold);
    });
  });
});

describe("the queue's multi-account detail view, end to end against a real flag", () => {
  it("shows an operator the scores and shows a member of that league nothing at all", async () => {
    await pairSharingADeviceButNotAnAddress(db, "lg_detail");
    // A real league chain event so the member-facing feed has something to show — the property
    // under test is "no score fragment leaks into it", not "it happens to be empty".
    await db.transaction((tx) =>
      logger.record(tx, { eventType: "member_joined", actorId: "lg_detail_ua", actorType: "user", leagueId: "lg_detail", payload: {}, occurredAt: NOW }),
    );
    await sweepLeagueForMultiAccounts(db, "lg_detail", baseDeps);
    const [flag] = await listPendingFlags(db, {}).then((page) => page.rows);

    expect((await flagDetail(db, flag!.flagId))!.evidence).toMatchObject({ device: expect.any(Number) });

    // The same underlying events, read the way a member reads them. Not "the scores are
    // filtered out" — the events are not in this league's chain to be filtered.
    const page = await listLeagueActivity(db, { leagueId: "lg_detail", viewerUserId: "lg_detail_ua" });
    expect(JSON.stringify(page.rows)).not.toMatch(/device|behavioral|suspicion|0\.\d{2}/);
    expect(page.rows.every((row) => row.headline !== "")).toBe(true); // and it is not empty because it broke
  });
});

describe("defaultSweepDeps", () => {
  it("reads INTEGRITY_CONFIG.multiAccount so the two real callers never have to", async () => {
    const deps = defaultSweepDeps();
    expect(deps.weights).toEqual(INTEGRITY_CONFIG.multiAccount.weights);
    expect(deps.flagThreshold).toBe(INTEGRITY_CONFIG.multiAccount.flagThreshold);
    expect(typeof deps.newId()).toBe("string");
  });
});
