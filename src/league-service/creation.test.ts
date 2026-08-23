import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, drafts, leagues, scoringSettings, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { LEAGUE_CONFIG } from "@/league";
import { SUPERFLEX_ROSTER_SLOTS } from "@/league/roster-shape";
import { ENFORCEMENT_REFUSALS } from "./enforcement";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { createLeague, type CreateLeagueInput, type LeagueOwner } from "./creation";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;
const deps = (cache?: Pick<ReferenceCache, "invalidateScoringSettings">) => ({ db, clock, newId, cache });

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

const MEMBER_OWNER: LeagueOwner = { kind: "member", userId: "u1", teamName: "Dana's Team" };

function memberOwner(userId: string, teamName = "Dana's Team"): LeagueOwner {
  return { kind: "member", userId, teamName };
}

function validInput(): CreateLeagueInput {
  return {
    name: "Sunday Money",
    format: "snake",
    teamCount: LEAGUE_CONFIG.defaults.teamCount,
    scoringPreset: "ppr",
    auctionBudget: null,
    rosterSlots: STANDARD_ROSTER_SLOTS,
    owner: MEMBER_OWNER,
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: false,
  };
}

/** A recording stand-in for the injected reference cache, so a test can assert exactly what was invalidated. */
function recordingReferenceCache(): Pick<ReferenceCache, "invalidateScoringSettings"> & { invalidateScoringSettings: ReturnType<typeof vi.fn> } {
  return { invalidateScoringSettings: vi.fn(async () => {}) };
}

/** Gives `userId` `count` OTHER completed leagues — matches `@/league-service`'s own suites
 *  (`browse.test.ts`, `join.test.ts`, `enforcement.test.ts`), each with its own identical copy. */
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

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  counter = 0;
  await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Dana Whitfield" });
});

afterAll(async () => {
  await truncateAll(db);
});

describe("createLeague", () => {
  it("creates the league, its scoring, the commissioner's team and a scheduled draft in one go", async () => {
    const result = await createLeague(deps(), {
      name: "Sunday Money",
      format: "snake",
      teamCount: LEAGUE_CONFIG.defaults.teamCount,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: STANDARD_ROSTER_SLOTS,
      owner: memberOwner("u1"),
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
    expect(league).toMatchObject({ name: "Sunday Money", format: "snake", teamCount: 12, commissionerUserId: "u1", houseRung: null });
    expect(league!.rosterSlots).toEqual(STANDARD_ROSTER_SLOTS);

    const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, result.leagueId));
    expect(settings).toMatchObject(PPR_SCORING);

    const teamRows = await db.select().from(teams).where(eq(teams.leagueId, result.leagueId));
    expect(teamRows).toHaveLength(1);
    expect(teamRows[0]).toMatchObject({ id: result.teamId, userId: "u1", name: "Dana's Team" });

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, result.draftId));
    // Scheduled a week out, so the auto-tightening clock starts in a slow tier.
    expect(draft).toMatchObject({ leagueId: result.leagueId, format: "snake", status: "scheduled", auctionBudget: null });
    expect(draft!.kickoffAt.toISOString()).toBe("2026-08-24T12:00:00.000Z");
  });

  it("takes the commissioner's chosen time at creation instead of computing one", async () => {
    const result = await createLeague(deps(), {
      ...validInput(),
      kickoffAt: "2026-09-12T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [draft] = await db.select().from(drafts).where(eq(drafts.id, result.draftId));
    expect(draft!.kickoffAt.toISOString()).toBe("2026-09-12T23:00:00.000Z");
  });

  it("still computes a default when no time is chosen, so nothing that exists today breaks", async () => {
    const result = await createLeague(deps(), validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [draft] = await db.select().from(drafts).where(eq(drafts.id, result.draftId));
    const expected = new Date(Date.parse(clock.now()) + LEAGUE_CONFIG.defaults.draftDaysFromCreation * 24 * 60 * 60 * 1000);
    expect(draft!.kickoffAt.toISOString()).toBe(expected.toISOString());
  });

  it("carries the auction budget through for an auction league", async () => {
    const result = await createLeague(deps(), {
      name: "Auction Night", format: "auction", teamCount: 10, scoringPreset: "te_premium",
      auctionBudget: 200, rosterSlots: STANDARD_ROSTER_SLOTS, owner: memberOwner("u1"),
      experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
    });
    if (!result.ok) throw new Error(result.reason);
    const [draft] = await db.select().from(drafts).where(eq(drafts.id, result.draftId));
    expect(draft!.auctionBudget).toBe(200);
  });

  it("refuses a commissioner with no user row, in plain language, and writes nothing", async () => {
    // The FK failure is logged with its real detail; keep the suite's output pristine.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await createLeague(deps(), {
        name: "Ghost League", format: "snake", teamCount: 12, scoringPreset: "ppr", auctionBudget: null,
        rosterSlots: STANDARD_ROSTER_SLOTS, owner: memberOwner("nobody", "Ghost"),
        experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
      });
      expect(result).toEqual({ ok: false, status: 500, reason: "We couldn't create that league. Please try again." });
      expect(await db.select().from(leagues)).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("invalidates the new league's cached scoring settings after a successful create", async () => {
    const cache = recordingReferenceCache();
    const result = await createLeague(deps(cache), {
      name: "Sunday Money", format: "snake", teamCount: LEAGUE_CONFIG.defaults.teamCount, scoringPreset: "ppr",
      auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, owner: memberOwner("u1"),
      experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(cache.invalidateScoringSettings).toHaveBeenCalledTimes(1);
    expect(cache.invalidateScoringSettings).toHaveBeenCalledWith(result.leagueId);
  });

  it("logs, but does not fail the create, when the cache invalidation itself throws", async () => {
    // The league is already committed by the time this runs — a Redis outage on the way out
    // must never undo an already-successful create.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failingCache: Pick<ReferenceCache, "invalidateScoringSettings"> = {
        invalidateScoringSettings: async () => { throw new Error("redis down"); },
      };
      const result = await createLeague(deps(failingCache), {
        name: "Cache Outage League", format: "snake", teamCount: LEAGUE_CONFIG.defaults.teamCount, scoringPreset: "ppr",
        auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, owner: memberOwner("u1"),
        experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
      });
      expect(result.ok).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[league] scoring settings cache invalidation failed",
        expect.objectContaining({ leagueId: result.ok ? result.leagueId : undefined }),
        expect.any(Error),
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("does not invalidate scoring settings when league creation fails", async () => {
    const cache = recordingReferenceCache();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await createLeague(deps(cache), {
        name: "Ghost League", format: "snake", teamCount: 12, scoringPreset: "ppr", auctionBudget: null,
        rosterSlots: STANDARD_ROSTER_SLOTS, owner: memberOwner("nobody", "Ghost"),
        experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
      });
      expect(result.ok).toBe(false);
      expect(cache.invalidateScoringSettings).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("records the matchmaking facts a public browse reads: visibility, stake tier and experience tier", async () => {
    const result = await createLeague(deps(), {
      name: "Open Auction Night",
      format: "auction",
      teamCount: 10,
      scoringPreset: "ppr",
      auctionBudget: 200,
      rosterSlots: STANDARD_ROSTER_SLOTS,
      owner: memberOwner("u1"),
      experienceTier: "experienced",
      stakeTier: 2,
      isPublicMatchmade: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
    expect(league).toMatchObject({ experienceTier: "experienced", stakeTier: 2, isPublicMatchmade: true });
  });

  // Phase 3.5, Task 7: the sit-and-go trigger's own column.
  it("defaults the draft's start trigger to 'scheduled', unaffected for every existing caller", async () => {
    const result = await createLeague(deps(), validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [draft] = await db.select().from(drafts).where(eq(drafts.id, result.draftId));
    expect(draft!.startTrigger).toBe("scheduled");
  });

  it("writes 'when_full' straight through when the caller asks for it", async () => {
    const result = await createLeague(deps(), { ...validInput(), isPublicMatchmade: true, startTrigger: "when_full" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [draft] = await db.select().from(drafts).where(eq(drafts.id, result.draftId));
    expect(draft!.startTrigger).toBe("when_full");
  });

  it("keeps a league private and unlisted unless it is created public on purpose", async () => {
    const result = await createLeague(deps(), {
      name: "Group Chat Only",
      format: "snake",
      teamCount: 12,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: STANDARD_ROSTER_SLOTS,
      owner: memberOwner("u1"),
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
    expect(league).toMatchObject({ isPublicMatchmade: false, stakeTier: 0, experienceTier: "beginner" });
  });

  it("records the league's own creation as the first event on its chain", async () => {
    const result = await createLeague({ db, clock, newId, audit: logger }, validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.chainScope, result.leagueId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: "league_created",
      sequence: 1,
      actorId: MEMBER_OWNER.userId,
      actorType: "user",
      leagueId: result.leagueId,
    });
    expect(rows[0]!.payload).toEqual({
      name: "Sunday Money", format: "snake", teamCount: 12, stakeTier: 0,
      isPublicMatchmade: false, experienceTier: "beginner", scoringPreset: "ppr", medianGame: false,
    });
    expect(rows[0]!.occurredAt.toISOString()).toBe(clock.now());
  });

  it("leaves no audit event behind when the league write fails", async () => {
    // The same-transaction contract, proved at a real call site and not only in the logger's own
    // test: `createLeague` already wraps everything in one transaction, and the audit append is
    // inside it, so a duplicate-id failure loses both halves together.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await createLeague({ db, clock, newId: () => "fixed_id", audit: logger }, validInput());
      const second = await createLeague({ db, clock, newId: () => "fixed_id", audit: logger }, validInput());
      expect(second.ok).toBe(false);
      expect(await db.select().from(auditEvents)).toHaveLength(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  describe("the creation-side hole (Task 3, ruling 6)", () => {
    it("refuses to let a veteran create a public league declared for beginners", async () => {
      // The gate Step 6 does not contain. A creator never passes through `publicJoinPrecondition`,
      // so without this a veteran can build the exact league the segregation exists to keep them
      // out of and then wait for it to fill.
      await giveCompletedSeasons("u_vet", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
      const result = await createLeague(deps(), {
        ...validInput(),
        owner: memberOwner("u_vet"),
        isPublicMatchmade: true,
        experienceTier: "beginner",
      });
      expect(result).toEqual({ ok: false, status: 409, reason: ENFORCEMENT_REFUSALS.create });
    });

    it("lets the same veteran create the same league privately, or publicly for everyone", async () => {
      await giveCompletedSeasons("u_vet2", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
      const privateResult = await createLeague(deps(), {
        ...validInput(),
        owner: memberOwner("u_vet2"),
        isPublicMatchmade: false,
        experienceTier: "beginner",
      });
      expect(privateResult).toMatchObject({ ok: true });

      const publicExperienced = await createLeague(deps(), {
        ...validInput(),
        owner: memberOwner("u_vet2"),
        isPublicMatchmade: true,
        experienceTier: "experienced",
      });
      expect(publicExperienced).toMatchObject({ ok: true });
    });

    it("does not gate a newcomer creating the identical public, beginner-declared league", async () => {
      const result = await createLeague(deps(), {
        ...validInput(),
        owner: memberOwner("u1"),
        isPublicMatchmade: true,
        experienceTier: "beginner",
      });
      expect(result).toMatchObject({ ok: true });
    });

    it("writes nothing when a creation is refused — no league row, no team, no audit event", async () => {
      await giveCompletedSeasons("u_vet3", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
      const before = await db.select().from(leagues);
      const result = await createLeague({ db, clock, newId, audit: logger }, {
        ...validInput(),
        owner: memberOwner("u_vet3"),
        isPublicMatchmade: true,
        experienceTier: "beginner",
      });
      expect(result.ok).toBe(false);
      expect(await db.select().from(leagues)).toEqual(before);
      expect(await db.select().from(auditEvents)).toEqual([]);
    });

    it("lets segregation off through the same rollback switch the join gate reads", async () => {
      await giveCompletedSeasons("u_vet4", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
      const config = INTEGRITY_CONFIG.participation as { enforceTierSegregation: boolean };
      const original = config.enforceTierSegregation;
      config.enforceTierSegregation = false;
      try {
        const result = await createLeague(deps(), {
          ...validInput(),
          owner: memberOwner("u_vet4"),
          isPublicMatchmade: true,
          experienceTier: "beginner",
        });
        expect(result).toMatchObject({ ok: true });
      } finally {
        config.enforceTierSegregation = original;
      }
    });
  });

  describe("roster shape resolution (Task 1, superflex)", () => {
    it("resolves a named shape to its rows when no explicit rosterSlots are given", async () => {
      const result = await createLeague(deps(), {
        ...validInput(),
        rosterSlots: undefined,
        rosterShape: "superflex",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
      expect(league!.rosterSlots).toEqual(SUPERFLEX_ROSTER_SLOTS);
    });

    it("falls back to the configured default shape when neither rosterSlots nor rosterShape is given", async () => {
      const result = await createLeague(deps(), {
        ...validInput(),
        rosterSlots: undefined,
        rosterShape: undefined,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
      expect(league!.rosterSlots).toEqual(STANDARD_ROSTER_SLOTS);
    });

    it("still prefers explicit rosterSlots over a rosterShape given alongside it", async () => {
      const result = await createLeague(deps(), {
        ...validInput(),
        rosterSlots: STANDARD_ROSTER_SLOTS,
        rosterShape: "superflex",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
      expect(league!.rosterSlots).toEqual(STANDARD_ROSTER_SLOTS);
    });
  });

  // Phase 3.5 addendum, Task 13, Step 3: "createLeague learns that a league can have no owner."
  // `writeLeagueInTx`'s house branch is what `spawnHouseLeagueInTx` (`./house-factory.ts`) calls
  // from inside the reconciler's own transaction; these tests exercise the identical branch
  // straight through the public `createLeague` entry point, which is the one place a caller who
  // is not the reconciler could reach it — and the one place the coverage gate on this directory
  // (`vitest.config.ts`, gate 17) can see it exercised without a house-catalog fixture.
  describe("a house owner (Task 13)", () => {
    function houseInput(): CreateLeagueInput {
      return { ...validInput(), owner: { kind: "house", rung: "open_12" }, isPublicMatchmade: true };
    }

    it("writes commissioner_user_id null and house_rung set, and seats no team at all", async () => {
      const result = await createLeague(deps(), houseInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.teamId).toBeNull();

      const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
      expect(league).toMatchObject({ commissionerUserId: null, houseRung: "open_12" });

      const teamRows = await db.select().from(teams).where(eq(teams.leagueId, result.leagueId));
      expect(teamRows).toHaveLength(0);
    });

    it("skips the creation-side tier gate entirely — there is no userId for it to check", async () => {
      // A veteran-only precondition over a self-declared tier has nothing to ask when nobody
      // declared it as themselves (ruling 39) — this proves the house branch never even reaches
      // `tierJoinPrecondition`, by using the identical beginner-tier, public shape the member
      // test above refuses, and getting `ok: true` instead.
      await giveCompletedSeasons("u_vet_house", INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
      const result = await createLeague(deps(), { ...houseInput(), experienceTier: "beginner" });
      expect(result).toMatchObject({ ok: true });
    });

    it("records the league_created event as system-authored, with no actor", async () => {
      const result = await createLeague({ db, clock, newId, audit: logger }, houseInput());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const rows = await db.select().from(auditEvents).where(eq(auditEvents.chainScope, result.leagueId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ eventType: "league_created", actorId: null, actorType: "system" });
    });
  });
});
