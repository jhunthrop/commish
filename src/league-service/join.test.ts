import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, draftActions, drafts, integrityFlags, leagues, memberNotices, sessionSignals, teams, users } from "@/db/schema";
import type { AuditEventType } from "@/domain/audit";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { canonicalPairId, defaultSweepDeps, type SweepDeps } from "@/integrity-service/multi-account";
import { SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";
import { ENFORCEMENT_REFUSALS } from "./enforcement";
import { acceptInvite, createInvite } from "./invites";
import {
  DRAFT_ALREADY_STARTED,
  joinPublicLeague,
  LEAGUE_FULL,
  NOT_PUBLIC,
  recordTierBlockedJoin,
  returnFromSignIn,
  triggerMultiAccountSweep,
  type JoinLeagueOutcome,
} from "./join";
import { claimSeatHold, liveHoldsFor } from "./seat-hold";

const db = createTestDb();
const clock = { now: () => "2026-08-20T17:00:00.000Z" };
let nextId = 0;
const newId = () => `team_${++nextId}`;
const deps = () => ({ db, newId, clock });

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

/**
 * A `Db` whose `transaction(...)` rejects with the given error but whose reads still hit the
 * real database — the league row lock (`FOR UPDATE`, taken before the "already a member" check)
 * is expected to prevent two concurrent same-user joins from ever racing each other into the
 * unique-index backstop, so no test in this file can schedule that race reliably. Mirrors
 * `invites.test.ts`'s helper of the same name and shape.
 */
function dbWhoseTransactionThrows(error: unknown): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "transaction") return () => Promise.reject(error);
      return Reflect.get(target, prop, receiver);
    },
  }) as Db;
}

/** The shape `postgres-js` raises through Drizzle: the driver fields sit one level under `.cause`. */
const uniqueViolation = (constraint: string) =>
  Object.assign(new Error("duplicate key value violates unique constraint"), {
    cause: { code: "23505", constraint_name: constraint },
  });

async function seedLeague(over: {
  readonly id?: string;
  readonly teamCount?: number;
  readonly filled?: number;
  readonly isPublicMatchmade?: boolean;
  readonly draftStatus?: "scheduled" | "in_progress" | "complete";
  readonly experienceTier?: "beginner" | "experienced";
  readonly startTrigger?: "scheduled" | "when_full";
} = {}): Promise<string> {
  const id = over.id ?? "open";
  await db.insert(leagues).values({
    id,
    name: "Rookie Snake Room",
    format: "snake",
    teamCount: over.teamCount ?? 12,
    stakeTier: 0,
    experienceTier: over.experienceTier ?? "beginner",
    isPublicMatchmade: over.isPublicMatchmade ?? true,
    commissionerUserId: "owner",
  });
  await db.insert(drafts).values({
    id: `${id}_draft`,
    leagueId: id,
    format: "snake",
    status: over.draftStatus ?? "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
    startTrigger: over.startTrigger ?? "scheduled",
  });
  for (let i = 0; i < (over.filled ?? 0); i++) {
    const userId = `${id}_seat_${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Seat ${i}` });
    await db.insert(teams).values({ id: `${id}_t${i}`, leagueId: id, userId, name: `Team ${i}` });
  }
  return id;
}

/** Gives `userId` `count` OTHER completed leagues — a one-team league apiece, matching
 *  `browse.test.ts`'s and `enforcement.test.ts`'s own identical helper — so their seat in
 *  whatever league the caller seeds them into next reads as a veteran's. */
async function giveCompletedSeasons(userId: string, count: number): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
  for (let i = 0; i < count; i++) {
    const leagueId = `${userId}_history_${i}`;
    await db.insert(leagues).values({
      id: leagueId,
      name: leagueId,
      format: "snake",
      teamCount: 1,
      commissionerUserId: userId,
      seasonCompletedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    await db.insert(teams).values({ id: `${leagueId}_team`, leagueId, userId, name: "Team" });
  }
}

async function noticesFor(userId: string) {
  return db.select().from(memberNotices).where(eq(memberNotices.userId, userId));
}

async function auditEventsOn(scope: string, eventType: AuditEventType) {
  return db.select().from(auditEvents).where(and(eq(auditEvents.chainScope, scope), eq(auditEvents.eventType, eventType)));
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  counter = 0;
  await db.insert(users).values([
    { id: "owner", email: "owner@test.local", displayName: "Commissioner Casey" },
    { id: "joiner", email: "joiner@test.local", displayName: "Robin Vale" },
  ]);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("joinPublicLeague", () => {
  it("gives the caller a team named after them, and reports it as a fresh join", async () => {
    const leagueId = await seedLeague();
    const result = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    expect(result).toEqual({ ok: true, leagueId, teamId: "team_1", alreadyMember: false });

    const [row] = await db.select().from(teams).where(eq(teams.id, "team_1"));
    expect(row).toMatchObject({ leagueId, userId: "joiner", name: "Robin Vale" });
  });

  it("is idempotent: joining twice returns the same team and creates nothing", async () => {
    const leagueId = await seedLeague();
    const first = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    const second = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    expect(second).toEqual({ ok: true, leagueId, teamId: (first as { teamId: string }).teamId, alreadyMember: true });
    expect(await db.select().from(teams).where(eq(teams.leagueId, leagueId))).toHaveLength(1);
  });

  it("refuses a league that is not publicly listed", async () => {
    const leagueId = await seedLeague({ isPublicMatchmade: false });
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false, status: 404, reason: NOT_PUBLIC,
    });
  });

  it("refuses a league whose draft has already started", async () => {
    const leagueId = await seedLeague({ draftStatus: "in_progress" });
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false, status: 409, reason: DRAFT_ALREADY_STARTED,
    });
  });

  it("refuses a full league", async () => {
    const leagueId = await seedLeague({ teamCount: 2, filled: 2 });
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false, status: 409, reason: LEAGUE_FULL,
    });
  });

  it("refuses a league that does not exist, identically to one that is not publicly listed", async () => {
    // Not `LEAGUE_MISSING`: a caller posting a league id must not be able to tell "no such
    // league" apart from "a real league that just isn't public" — see `publicJoinPrecondition`'s
    // docblock. The two cases answer byte-identically.
    const missing = await joinPublicLeague(deps(), { leagueId: "nope", userId: "joiner" });
    expect(missing).toEqual({ ok: false, status: 404, reason: NOT_PUBLIC });

    const privateLeagueId = await seedLeague({ id: "private", isPublicMatchmade: false });
    const notPublic = await joinPublicLeague(deps(), { leagueId: privateLeagueId, userId: "joiner" });
    expect(notPublic).toEqual(missing);
  });

  it("lets an existing member back in even after the league closed behind them", async () => {
    // A member re-arriving must succeed for free whatever the path's own gate now says —
    // the same rule that makes re-opening your own expired invite link a success.
    const leagueId = await seedLeague();
    const first = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, leagueId));
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: true, leagueId, teamId: (first as { teamId: string }).teamId, alreadyMember: true,
    });
  });

  it("never seats more managers than the league has room for, under concurrent joins", async () => {
    const leagueId = await seedLeague({ teamCount: 4, filled: 3 });
    await db.insert(users).values([
      { id: "racer_a", email: "racer_a@test.local", displayName: "Racer A" },
      { id: "racer_b", email: "racer_b@test.local", displayName: "Racer B" },
    ]);
    const results = await Promise.all([
      joinPublicLeague(deps(), { leagueId, userId: "racer_a" }),
      joinPublicLeague(deps(), { leagueId, userId: "racer_b" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, status: 409, reason: LEAGUE_FULL }]);
    expect(await db.select().from(teams).where(eq(teams.leagueId, leagueId))).toHaveLength(4);
  });

  // Phase 3.5, Task 7: `joinLeagueInTx` is where `fireWhenFullInTx` lives — a full write-through
  // proof lives in `fill-trigger.test.ts`; this is the seam-level proof that `joinPublicLeague`
  // really does thread through to it rather than an implementation detail neither test file
  // actually drives.
  it("moves a sit-and-go draft's kickoff when the last public-browse join fills the league", async () => {
    const leagueId = await seedLeague({ teamCount: 3, filled: 2, startTrigger: "when_full" });
    const before = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    expect(before.ok).toBe(true);

    const [draft] = await db.select().from(drafts).where(eq(drafts.leagueId, leagueId));
    expect(draft!.kickoffAt.toISOString()).not.toBe("2026-09-10T17:00:00.000Z");
  });

  it("records member_joined when a public join seats someone", async () => {
    const leagueId = await seedLeague();
    const outcome = await joinPublicLeague({ db, newId, clock, audit: logger }, { leagueId, userId: "joiner" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "member_joined"));
    expect(event).toMatchObject({ actorId: "joiner", actorType: "user", leagueId });
    expect(event!.payload).toEqual({ teamId: outcome.teamId, via: "public_browse" });
  });

  it("records nothing when an already-seated member arrives again", async () => {
    // `joinLeagueInTx` treats re-arrival as a free success. An audit event per page reload would
    // be noise in every member's activity feed and a lie about what happened.
    const leagueId = await seedLeague();
    await joinPublicLeague({ db, newId, clock, audit: logger }, { leagueId, userId: "joiner" });
    await joinPublicLeague({ db, newId, clock, audit: logger }, { leagueId, userId: "joiner" });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "member_joined"))).toHaveLength(1);
  });

  it("treats the unique-index backstop firing as 'already a member', not an error", async () => {
    const leagueId = await seedLeague();
    const joined = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    if (!joined.ok) throw new Error(joined.reason);

    const raced = await joinPublicLeague(
      { db: dbWhoseTransactionThrows(uniqueViolation("teams_league_user_idx")), newId, clock },
      { leagueId, userId: "joiner" },
    );
    expect(raced).toEqual({ ok: true, leagueId, teamId: joined.teamId, alreadyMember: true });
  });

  it("falls through to the generic 500 when the unique-index backstop fires but the compensating lookup finds nothing", async () => {
    // Real Postgres never produces this pairing — see the analogous test in `invites.test.ts`
    // for `acceptInvite`'s own copy of this same backstop.
    const leagueId = await seedLeague();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await joinPublicLeague(
        { db: dbWhoseTransactionThrows(uniqueViolation("teams_league_user_idx")), newId, clock },
        { leagueId, userId: "joiner" },
      );
      expect(result).toEqual({ ok: false, status: 500, reason: "We couldn't join that league just now. Please try again." });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("computes the 'New team' fallback name even for a caller whose profile row is somehow gone", async () => {
    // `teams.userId` is a NOT NULL foreign key to `users.id`, so a caller with no profile row
    // can never actually reach a committed team — the INSERT below fails first. The name
    // expression itself (`teamName ?? profile?.displayName ?? "New team"`) still evaluates
    // BEFORE that insert runs, which is what this proves: the fallback string is real code, not
    // dead weight, even though nothing durable can ever carry it out through real Postgres.
    const leagueId = await seedLeague();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await joinPublicLeague(deps(), { leagueId, userId: "ghost_no_profile" });
      expect(result).toEqual({ ok: false, status: 500, reason: "We couldn't join that league just now. Please try again." });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("triggers a real multi-account sweep after the join commits, and it can raise a real flag", async () => {
    // The join-time trigger (ruling 11), end to end: an existing member and the joiner share
    // one client signature and a matching draft-pick tempo — the same combined shape
    // `multi-account.test.ts` builds by hand — so the sweep this join fires finds a real pair
    // over threshold and raises a real flag, with NO separate call to the sweep anywhere in
    // this test.
    const leagueId = await seedLeague({ teamCount: 4, filled: 1 });
    const seatmate = `${leagueId}_seat_0`;
    const seatmateTeam = `${leagueId}_t0`;
    const draftId = `${leagueId}_draft`;
    // `newId` is `team_${++nextId}`, reset to 0 in `beforeEach`: this is the FIRST join call in
    // this test, so the joiner's team id is deterministically "team_1" — known before the join
    // ever runs, so the joiner's own picks can be seeded ahead of it (the sweep only reads them
    // AFTER commit, and `draft_actions.action` carries no foreign key on the embedded team id).
    const joinerTeam = "team_1";

    await db.insert(sessionSignals).values([
      { id: "sig_seatmate", userId: seatmate, occurredAt: new Date(clock.now()), userAgent: "SharedClient/1.0", acceptLanguage: "en-US", ipHash: null, ipSource: "xff_unverified" },
      { id: "sig_joiner", userId: "joiner", occurredAt: new Date(clock.now()), userAgent: "SharedClient/1.0", acceptLanguage: "en-US", ipHash: null, ipSource: "xff_unverified" },
    ]);
    const minActions = INTEGRITY_CONFIG.multiAccount.signals.minActionsForBehavioral;
    const pickRows = (teamId: string, offsetMs: number) =>
      Array.from({ length: minActions + 1 }, (_, i) => {
        const timestamp = new Date(Date.parse(clock.now()) + offsetMs + i * 30_000);
        return { draftId, action: { v: 1, type: "MAKE_PICK", timestamp: timestamp.toISOString(), teamId, playerId: `p_${teamId}_${i}` }, timestamp };
      });
    const allPickRows = [...pickRows(seatmateTeam, 0), ...pickRows(joinerTeam, 5_000)].map((row, i) => ({ ...row, sequence: i + 1 }));
    await db.insert(draftActions).values(allPickRows);

    const outcome = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    expect(outcome).toMatchObject({ ok: true, alreadyMember: false });

    const [flag] = await db.select().from(integrityFlags).where(isNull(integrityFlags.resolvedAt));
    expect(flag).toMatchObject({ flagType: "multi_account", subjectId: canonicalPairId("joiner", seatmate), leagueId });
  });

  describe("triggerMultiAccountSweep", () => {
    const sweepDeps: SweepDeps = defaultSweepDeps(newId);

    it("does nothing for an outcome that seated nobody new", async () => {
      const notOk: JoinLeagueOutcome = { ok: false, status: 409, reason: "full" };
      const already: JoinLeagueOutcome = { ok: true, leagueId: "lg", teamId: "t1", alreadyMember: true };
      // Neither call reaches `sweepLeagueForMultiAccounts` at all: a `db` that throws the moment
      // anything queries it proves the guard short-circuits before any I/O, not merely that the
      // sweep happened to find nothing.
      const explodingDb = { select: () => { throw new Error("must not be called"); } } as unknown as Db;
      await expect(triggerMultiAccountSweep(explodingDb, notOk, sweepDeps)).resolves.toBeUndefined();
      await expect(triggerMultiAccountSweep(explodingDb, already, sweepDeps)).resolves.toBeUndefined();
    });

    it("logs and swallows a sweep failure rather than throwing it at the join's own caller", async () => {
      // The person joining did nothing wrong — a broken sweep must never turn their join into a
      // 500. `scripts/sweep-multi-account.ts` is the operator's manual re-run for exactly this.
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const brokenDb = {
        select: () => {
          throw new Error("sweep boom");
        },
      } as unknown as Db;
      const outcome: JoinLeagueOutcome = { ok: true, leagueId: "lg_broken", teamId: "t1", alreadyMember: false };
      await expect(triggerMultiAccountSweep(brokenDb, outcome, sweepDeps)).resolves.toBeUndefined();
      // The swallow itself lives in `sweepQuietly` (`@/integrity-service/multi-account`), shared
      // with the draft-completion trigger; the `trigger` tag is what tells an operator reading
      // the log which of the two dropped a sweep.
      expect(spy).toHaveBeenCalledWith("[integrity] multi-account sweep failed", { leagueId: "lg_broken", trigger: "league_join" }, expect.any(Error));
      spy.mockRestore();
    });
  });
});

/**
 * Flips the deploy-wide switch for the duration of one test, then restores it — see
 * `enforcement.test.ts`'s identical helper for why a cast-and-mutate is safe here: the config is
 * a plain object at runtime despite its `as const` typing, and every caller restores it.
 */
async function withEnforcement<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const config = INTEGRITY_CONFIG.participation as { enforceTierSegregation: boolean };
  const original = config.enforceTierSegregation;
  config.enforceTierSegregation = enabled;
  try {
    return await fn();
  } finally {
    config.enforceTierSegregation = original;
  }
}

describe("joinPublicLeague — tier enforcement (Task 3, ruling 6)", () => {
  it("blocks a veteran from a beginner public league, and says why without saying what they did wrong", async () => {
    const leagueId = await seedLeague({ id: "lg_beginner" });
    await giveCompletedSeasons("u_vet", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    expect(await joinPublicLeague(deps(), { leagueId, userId: "u_vet" })).toEqual({
      ok: false,
      status: 409,
      reason: ENFORCEMENT_REFUSALS.join,
    });
  });

  it("lets the same account into the same league the moment segregation is off", async () => {
    // Step 6's rollback, exercised rather than described. The tier is still computed, only the
    // refusal stops firing.
    const leagueId = await seedLeague({ id: "lg_beginner_off" });
    await giveCompletedSeasons("u_vet_off", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await withEnforcement(false, async () => {
      expect(await joinPublicLeague(deps(), { leagueId, userId: "u_vet_off" })).toMatchObject({ ok: true });
    });
  });

  it("leaves private leagues completely alone, for the identical account and the identical tier", async () => {
    // The spec's matched pair for Step 6: two leagues, identical in every field but
    // `is_public_matchmade`, one account, two outcomes. Driven through `acceptInvite`
    // (`./invites`), the invite door, whose `invitePrecondition` never asks this question at all.
    const created = await seedLeague({ id: "lg_private_beginner", isPublicMatchmade: false });
    await giveCompletedSeasons("u_vet_private", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    const invite = await createInvite({ db, clock, random: () => 0.5 }, { leagueId: created, createdByUserId: "owner" });
    if (!invite.ok) throw new Error(invite.reason);
    expect(await acceptInvite({ db, clock, newId }, { code: invite.code, userId: "u_vet_private" })).toMatchObject({ ok: true });
  });

  /**
   * THE THIRD DOOR, PINNED IN BOTH DIRECTIONS (final review F3). `invitePrecondition`
   * (`./invites`) checks expiry and use count and never calls `tierJoinPrecondition`, so an invite
   * exempts a veteran from segregation into a PUBLIC beginner league exactly as much as into a
   * private one. Task 3's review adjudicated that deliberate and this test exists to keep it
   * deliberate: the exemption is about the MECHANISM ("an invite is always a human handing a
   * specific code to a specific person"), not about the league's visibility flag, so a change that
   * narrows it to private leagues reddens here rather than passing quietly.
   *
   * Both directions over ONE league and ONE account, which is what makes it a pin rather than two
   * unrelated assertions: the public join door refuses, the invite door admits.
   */
  it("admits a veteran to a PUBLIC beginner league through the invite door, and refuses the same account at the public join door", async () => {
    const leagueId = await seedLeague({ id: "lg_public_beginner_invite", isPublicMatchmade: true, experienceTier: "beginner" });
    await giveCompletedSeasons("u_vet_public_invite", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);

    // Direction 1: the door the segregation covers.
    expect(await joinPublicLeague(deps(), { leagueId, userId: "u_vet_public_invite" })).toEqual({
      ok: false,
      status: 409,
      reason: ENFORCEMENT_REFUSALS.join,
    });

    // Direction 2: the door it deliberately does not. Same league, same account, same tier.
    const invite = await createInvite({ db, clock, random: () => 0.5 }, { leagueId, createdByUserId: "owner" });
    if (!invite.ok) throw new Error(invite.reason);
    expect(await acceptInvite({ db, clock, newId }, { code: invite.code, userId: "u_vet_public_invite" })).toMatchObject({ ok: true });
  });

  it("answers 404 and not 409 for a league that is not public, exactly as it did before", async () => {
    // The no-oracle discipline, unchanged. The tier clause runs AFTER the public check, so a
    // private league's existence is never confirmed to a stranger by a tier refusal.
    const leagueId = await seedLeague({ id: "lg_private_stranger", isPublicMatchmade: false });
    await giveCompletedSeasons("u_vet_stranger", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    expect(await joinPublicLeague(deps(), { leagueId, userId: "u_vet_stranger" })).toEqual({
      ok: false, status: 404, reason: NOT_PUBLIC,
    });
  });

  it("tells the blocked member once, and not again on a second attempt at the same league", async () => {
    const leagueId = await seedLeague({ id: "lg_beginner_twice" });
    await giveCompletedSeasons("u_vet_twice", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await joinPublicLeague(deps(), { leagueId, userId: "u_vet_twice" });
    await joinPublicLeague(deps(), { leagueId, userId: "u_vet_twice" });
    expect((await noticesFor("u_vet_twice")).filter((n) => n.noticeType === "tier_blocked_join")).toHaveLength(1);
  });

  it("writes the block on the PLATFORM chain, because a league nobody joined is not told about it", async () => {
    const leagueId = await seedLeague({ id: "lg_beginner_audit" });
    await giveCompletedSeasons("u_vet_audit", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    await joinPublicLeague(deps(), { leagueId, userId: "u_vet_audit" });

    expect(await auditEventsOn(leagueId, "system_action")).toHaveLength(0);
    const [event] = await auditEventsOn("platform", "system_action");
    expect(event).toMatchObject({ actorId: null, actorType: "system", leagueId: null });
    expect(event!.payload).toMatchObject({ action: "tier_blocked_join", subjectUserId: "u_vet_audit" });
    expect((event!.payload as { readonly summary?: unknown }).summary).toBeUndefined();

    const [notice] = await noticesFor("u_vet_audit");
    expect(notice).toMatchObject({ leagueId, noticeType: "tier_blocked_join" });
    expect(notice!.auditEventId).toBe(event!.eventId);
  });

  it("logs and swallows a failure to record the block, rather than turning an honest refusal into a 500", async () => {
    const leagueId = await seedLeague({ id: "lg_beginner_broken_notice" });
    await giveCompletedSeasons("u_vet_broken", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenAudit = {
      record: async () => {
        throw new Error("audit boom");
      },
      recordAll: async () => {
        throw new Error("audit boom");
      },
    };
    try {
      const outcome = await joinPublicLeague({ db, newId, clock, audit: brokenAudit }, { leagueId, userId: "u_vet_broken" });
      expect(outcome).toEqual({ ok: false, status: 409, reason: ENFORCEMENT_REFUSALS.join });
      expect(spy).toHaveBeenCalledWith(
        "[league] tier-blocked join notice failed",
        { leagueId, userId: "u_vet_broken" },
        expect.any(Error),
      );
      expect(await noticesFor("u_vet_broken")).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  describe("recordTierBlockedJoin", () => {
    it("is a no-op the second time for the same (userId, leagueId) pair, driven directly", async () => {
      const leagueId = await seedLeague({ id: "lg_direct_dedupe" });
      await db.insert(users).values({ id: "u_direct", email: "u_direct@test.local", displayName: "Direct" });
      await recordTierBlockedJoin(db, { leagueId, userId: "u_direct", occurredAt: clock.now() });
      await recordTierBlockedJoin(db, { leagueId, userId: "u_direct", occurredAt: clock.now() });
      expect(await noticesFor("u_direct")).toHaveLength(1);
      expect(await auditEventsOn("platform", "system_action")).toHaveLength(1);
    });

    it("writes nothing when the named league no longer exists", async () => {
      await db.insert(users).values({ id: "u_ghost", email: "u_ghost@test.local", displayName: "Ghost" });
      await recordTierBlockedJoin(db, { leagueId: "does_not_exist", userId: "u_ghost", occurredAt: clock.now() });
      expect(await noticesFor("u_ghost")).toEqual([]);
      expect(await auditEventsOn("platform", "system_action")).toEqual([]);
    });
  });
});

/**
 * Phase 3.6, Task 6: `joinLeagueInTx`'s own two seat-hold behaviors — capacity now counts a live
 * hold against anybody without that hold's own token, and a hold this join redeems is released
 * (its `consumed_at` stamped) even on a refusal that follows it, never left to expire. The Step 1
 * scenario list (claim, race, expiry, `returnFromSignIn`'s three outcomes) lives in
 * `./seat-hold.test.ts`, beside `claimSeatHold` and `liveHoldsFor` themselves; these two are the
 * join-side nuances that file has no reason to know about.
 */
describe("joinPublicLeague — seat holds (Task 6)", () => {
  it("counts a live hold against capacity for anyone who does not hold that exact token", async () => {
    const leagueId = await seedLeague({ teamCount: 12, filled: 11 });
    expect(await claimSeatHold(db, { leagueId, token: "hold_racer", now: clock.now() })).toMatchObject({ ok: true });

    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false,
      status: 409,
      reason: SEAT_HOLD_REFUSALS.taken,
    });
    // The holder's own token still seats them — the same seat the hold reserved.
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner", holdToken: "hold_racer" })).toMatchObject({ ok: true });
  });

  it("releases a held seat immediately when the holder turns out to be tier-blocked, rather than leaving it to expire", async () => {
    const leagueId = await seedLeague({ id: "lg_hold_tier_block", experienceTier: "beginner" });
    await giveCompletedSeasons("u_vet_hold", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    expect(await claimSeatHold(db, { leagueId, token: "hold_vet", now: clock.now() })).toMatchObject({ ok: true });

    const outcome = await joinPublicLeague(deps(), { leagueId, userId: "u_vet_hold", holdToken: "hold_vet" });
    expect(outcome).toEqual({ ok: false, status: 409, reason: ENFORCEMENT_REFUSALS.join });

    // Released, not merely abandoned: the hold no longer counts as live, freeing the seat for
    // somebody who actually can take it, in the SAME request that refused the tier-blocked holder.
    expect(await liveHoldsFor(db, leagueId, clock.now())).toBe(0);
  });
});

/**
 * Phase 3.6, Task 6, Step 4, F4: "the return" — a signed-in visitor arriving back at the hold
 * interstitial. `returnFromSignIn`'s own module is `./join`, so its full test list (the three
 * outcomes named in the brief's Step 1) lives beside `claimSeatHold`'s in `./seat-hold.test.ts`;
 * this is the one join-side check that belongs here instead — the tier refusal it keeps distinct
 * from `SEAT_HOLD_REFUSALS.taken` rather than collapsing every "no seat" shape into one word.
 */
describe("returnFromSignIn — the tier refusal stays honest (Task 6 Step 4)", () => {
  it("names the real reason for a tier-blocked return, never the generic 'someone else got it'", async () => {
    const leagueId = await seedLeague({ id: "lg_return_tier", experienceTier: "beginner" });
    await giveCompletedSeasons("u_vet_return", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    expect(await claimSeatHold(db, { leagueId, token: "hold_return_vet", now: clock.now() })).toMatchObject({ ok: true });

    expect(await returnFromSignIn(db, { leagueId, userId: "u_vet_return", holdToken: "hold_return_vet", now: clock.now() })).toEqual({
      ok: false,
      reason: ENFORCEMENT_REFUSALS.join,
    });
  });
});
