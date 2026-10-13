import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, TEST_DATABASE_URL } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { draftActions, draftSlotPreferences, drafts, leagues, rosterSlots, teams } from "@/db/schema";
import { createDraftStore } from "@/draft-service/store";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { seedPlayers } from "./seed-players";
import { seedFormatDemos } from "./seed-format-demos";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };

// A REAL `DraftStore` (mirrors `seed-enforcement.test.ts`'s own `deps`) — this file's whole
// point is that every arc runs through the exact store the real API routes use, so faking the
// store itself would prove nothing. Only `publish`/`deliverNotice` are stubbed: this test has no
// live Redis to publish to.
const store = createDraftStore({ db, publish: async () => null, clock, deliverNotice: async () => {} });

beforeEach(async () => {
  vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
  vi.stubEnv("DATABASE_URL", TEST_DATABASE_URL);
  await truncateAll(db);
  await seedPlayers(db, createMockStatsProvider());
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedFormatDemos", () => {
  it("drafts a real superflex league through the engine, landing a second quarterback in SUPERFLEX", async () => {
    const result = await seedFormatDemos(db, clock, { store });
    expect(result.superflex.secondQuarterbackSlotted).toBe(true);

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.superflex.leagueId));
    expect(league?.rosterSlots.some((slot) => slot.slot === "SUPERFLEX")).toBe(true);

    const team1Roster = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, `${result.superflex.leagueId}_team_1`));
    const superflexSlot = team1Roster.find((slot) => slot.slot === "SUPERFLEX");
    expect(superflexSlot).toBeDefined();

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, `${result.superflex.leagueId}_draft`));
    expect(draft?.status).toBe("complete");
  });

  it("skips a real queueless turn and redeems it out of band, through real actions", async () => {
    const result = await seedFormatDemos(db, clock, { store });
    expect(result.skipAndOwe.redeemed).toBe(true);

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, `${result.skipAndOwe.leagueId}_draft`));
    expect(draft?.status).toBe("complete");

    // The redemption is a real, persisted `draft_actions` row — not a direct roster write.
    const actions = await db.select().from(draftActions).where(eq(draftActions.draftId, `${result.skipAndOwe.leagueId}_draft`));
    const timerExpires = actions.filter((row) => (row.action as { type: string }).type === "TIMER_EXPIRE");
    expect(timerExpires.length).toBeGreaterThan(0);

    const finalState = await store.getDraftState(`${result.skipAndOwe.leagueId}_draft`);
    expect(finalState?.owedPicks[result.skipAndOwe.skippedTeamId] ?? []).toHaveLength(0);
  });

  it("draws a real order from a real preference row", async () => {
    const result = await seedFormatDemos(db, clock, { store });
    expect(result.slotPreference.matchedRealDraw).toBe(true);

    const [preferenceRow] = await db
      .select()
      .from(draftSlotPreferences)
      .where(and(eq(draftSlotPreferences.draftId, `${result.slotPreference.leagueId}_draft`), eq(draftSlotPreferences.teamId, result.slotPreference.preferringTeamId)));
    expect(preferenceRow?.ranking).toEqual([2, 1]);

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, `${result.slotPreference.leagueId}_draft`));
    expect(draft?.status).not.toBe("scheduled");
  });

  it("fills a real sit-and-go league through the real join transaction, rewriting the kickoff", async () => {
    const result = await seedFormatDemos(db, clock, { store });
    expect(result.sitAndGo.kickoffRewritten).toBe(true);

    const leagueTeams = await db.select().from(teams).where(eq(teams.leagueId, result.sitAndGo.leagueId));
    expect(leagueTeams).toHaveLength(2);

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, `${result.sitAndGo.leagueId}_draft`));
    expect(draft?.startTrigger).toBe("when_full");
    // Rewritten to "soon" — well before the 7-day placeholder every OTHER seeded draft's own
    // kickoff sits at.
    const hoursFromNow = (draft!.kickoffAt.getTime() - Date.parse(clock.now())) / (60 * 60 * 1000);
    expect(hoursFromNow).toBeLessThan(1);
  });

  it("is safe to run twice — no duplicate leagues, no double-redemption, the kickoff stays put", async () => {
    const first = await seedFormatDemos(db, clock, { store });
    const [firstSitAndGoDraft] = await db.select().from(drafts).where(eq(drafts.id, `${first.sitAndGo.leagueId}_draft`));

    const second = await seedFormatDemos(db, clock, { store });

    expect(second.superflex.leagueId).toBe(first.superflex.leagueId);
    expect(second.skipAndOwe.skippedTeamId).toBe(first.skipAndOwe.skippedTeamId);
    expect(second.slotPreference.assignedSlot).toBe(first.slotPreference.assignedSlot);
    // A second run's own last-seat join takes the `alreadyMember` branch and rewrites nothing —
    // the kickoff a real fill trigger already set stays exactly where the first run left it.
    const [secondSitAndGoDraft] = await db.select().from(drafts).where(eq(drafts.id, `${second.sitAndGo.leagueId}_draft`));
    expect(secondSitAndGoDraft?.kickoffAt.getTime()).toBe(firstSitAndGoDraft?.kickoffAt.getTime());

    const superflexTeams = await db.select().from(teams).where(eq(teams.leagueId, first.superflex.leagueId));
    expect(superflexTeams).toHaveLength(2);
  });

  it("seeds through the real services, never a direct write to a draft's own outcome tables", () => {
    const source = readFileSync(join(process.cwd(), "src", "data", "seed", "seed-format-demos.ts"), "utf8");
    // Every roster, pick and preference-draw outcome here comes from a real applied action —
    // `store.applyAction`/`store.startDraft` — never a hand-assembled row. Unlike
    // `seed-enforcement.ts`'s own auto-start arc (which must go through `autoStartDueDrafts` to
    // prove the TICKER's own path), the superflex/skip-owe/slot-preference arcs here are exactly
    // the "a commissioner presses Start" shape, so a direct `store.startDraft(...)` call is the
    // real service, not a shortcut around it.
    expect(source).not.toContain("insert(rosterSlots)");
    expect(source).not.toContain("insert(draftActions)");
    expect(source).not.toContain("insert(draftSlotPreferences)");
  });
});
