import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, draftActions, drafts, integrityFlags, leagues, sessionSignals, teams, users } from "@/db/schema";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { canonicalPairId, defaultSweepDeps, type SweepDeps } from "@/integrity-service/multi-account";
import { DRAFT_ALREADY_STARTED, joinPublicLeague, LEAGUE_FULL, NOT_PUBLIC, triggerMultiAccountSweep, type JoinLeagueOutcome } from "./join";

const db = createTestDb();
const clock = { now: () => "2026-08-20T17:00:00.000Z" };
let nextId = 0;
const newId = () => `team_${++nextId}`;
const deps = () => ({ db, newId, clock });

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

async function seedLeague(over: {
  readonly id?: string;
  readonly teamCount?: number;
  readonly filled?: number;
  readonly isPublicMatchmade?: boolean;
  readonly draftStatus?: "scheduled" | "in_progress" | "complete";
} = {}): Promise<string> {
  const id = over.id ?? "open";
  await db.insert(leagues).values({
    id,
    name: "Rookie Snake Room",
    format: "snake",
    teamCount: over.teamCount ?? 12,
    stakeTier: 0,
    experienceTier: "beginner",
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
  });
  for (let i = 0; i < (over.filled ?? 0); i++) {
    const userId = `${id}_seat_${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Seat ${i}` });
    await db.insert(teams).values({ id: `${id}_t${i}`, leagueId: id, userId, name: `Team ${i}` });
  }
  return id;
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
      expect(spy).toHaveBeenCalledWith("[integrity] multi-account sweep failed after a league join", { leagueId: "lg_broken" }, expect.any(Error));
      spy.mockRestore();
    });
  });
});
