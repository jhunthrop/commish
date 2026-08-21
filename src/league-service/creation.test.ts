import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, drafts, leagues, scoringSettings, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { LEAGUE_CONFIG } from "@/league";
import type { ReferenceCache } from "@/stats-pipeline/reference-cache";
import { createLeague, type CreateLeagueInput } from "./creation";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;
const deps = (cache?: Pick<ReferenceCache, "invalidateScoringSettings">) => ({ db, clock, newId, cache });

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

function validInput(): CreateLeagueInput {
  return {
    name: "Sunday Money",
    format: "snake",
    teamCount: LEAGUE_CONFIG.defaults.teamCount,
    scoringPreset: "ppr",
    auctionBudget: null,
    rosterSlots: STANDARD_ROSTER_SLOTS,
    commissionerUserId: "u1",
    teamName: "Dana's Team",
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: false,
  };
}

/** A recording stand-in for the injected reference cache, so a test can assert exactly what was invalidated. */
function recordingReferenceCache(): Pick<ReferenceCache, "invalidateScoringSettings"> & { invalidateScoringSettings: ReturnType<typeof vi.fn> } {
  return { invalidateScoringSettings: vi.fn(async () => {}) };
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
      commissionerUserId: "u1",
      teamName: "Dana's Team",
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
    expect(league).toMatchObject({ name: "Sunday Money", format: "snake", teamCount: 12, commissionerUserId: "u1" });
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

  it("carries the auction budget through for an auction league", async () => {
    const result = await createLeague(deps(), {
      name: "Auction Night", format: "auction", teamCount: 10, scoringPreset: "te_premium",
      auctionBudget: 200, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "u1", teamName: "Dana's Team",
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
        rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "nobody", teamName: "Ghost",
        experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
      });
      expect(result).toEqual({ ok: false, reason: "We couldn't create that league. Please try again." });
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
      auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "u1", teamName: "Dana's Team",
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
        auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "u1", teamName: "Dana's Team",
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
        rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: "nobody", teamName: "Ghost",
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
      commissionerUserId: "u1",
      teamName: "Dana's Team",
      experienceTier: "experienced",
      stakeTier: 2,
      isPublicMatchmade: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.leagueId));
    expect(league).toMatchObject({ experienceTier: "experienced", stakeTier: 2, isPublicMatchmade: true });
  });

  it("keeps a league private and unlisted unless it is created public on purpose", async () => {
    const result = await createLeague(deps(), {
      name: "Group Chat Only",
      format: "snake",
      teamCount: 12,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: STANDARD_ROSTER_SLOTS,
      commissionerUserId: "u1",
      teamName: "Dana's Team",
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
      actorId: validInput().commissionerUserId,
      actorType: "user",
      leagueId: result.leagueId,
    });
    expect(rows[0]!.payload).toEqual({
      name: "Sunday Money", format: "snake", teamCount: 12, stakeTier: 0,
      isPublicMatchmade: false, experienceTier: "beginner", scoringPreset: "ppr",
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
});
