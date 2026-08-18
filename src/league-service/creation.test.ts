import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, scoringSettings, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { LEAGUE_CONFIG } from "@/league";
import { createLeague } from "./creation";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;
const deps = () => ({ db, clock, newId });

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
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
      });
      expect(result).toEqual({ ok: false, reason: "We couldn't create that league. Please try again." });
      expect(await db.select().from(leagues)).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
