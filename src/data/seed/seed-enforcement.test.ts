import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, TEST_DATABASE_URL } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, integrityFlags, leagues, lineupSlots, memberNotices, tradeProposals } from "@/db/schema";
import { createDraftStore } from "@/draft-service/store";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { seedPlayers } from "./seed-players";
import { seedEnforcement, type SeedEnforcementDeps } from "./seed-enforcement";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };

// `deliver` is the one seam this test stubs, the identical shape `seed-trades.test.ts`'s own
// `noopDeps` uses: the real `deliverNotice` publishes to Redis, and this file has none to
// publish to. `store` is a REAL `DraftStore` (`createDraftStore`), wired to a no-op `publish`
// and `deliverNotice` for the identical reason — `getDraftStore()`'s own singleton has no seam
// of its own to inject a fake into.
const deps: SeedEnforcementDeps = {
  deliver: async () => {},
  store: createDraftStore({ db, publish: async () => null, clock, deliverNotice: async () => {} }),
};

beforeEach(async () => {
  vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
  vi.stubEnv("DATABASE_URL", TEST_DATABASE_URL);
  await truncateAll(db);
  await seedPlayers(db, createMockStatsProvider());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedEnforcement", () => {
  it("holds a real trade past the auto-hold threshold, in a public matchmade league", async () => {
    const result = await seedEnforcement(db, clock, deps);
    expect(result.heldTrade.outcome).toBe("held");

    const [trade] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, result.heldTrade.tradeId!));
    expect(trade?.status).toBe("held");

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.heldTrade.leagueId));
    expect(league?.isPublicMatchmade).toBe(true);

    const flags = await db.select().from(integrityFlags).where(eq(integrityFlags.subjectType, "held_trade"));
    expect(flags).toHaveLength(1);
    expect(flags[0]!.flagType).toBe("trade_hold");
    expect(flags[0]!.subjectId).toBe(trade!.id);
    expect(flags[0]!.resolvedAt).toBeNull();

    const notices = await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "trade_held_for_review"));
    expect(notices).toHaveLength(2);
  });

  it("auto-sets exactly one manager's lineup at a real locked week", async () => {
    const result = await seedEnforcement(db, clock, deps);
    expect(result.lineupAutoSet.teamsSet).toBe(1);

    const [league] = await db.select().from(leagues).where(eq(leagues.id, result.lineupAutoSet.leagueId));
    expect(league?.isPublicMatchmade).toBe(true);

    const autoSetTeamId = `${result.lineupAutoSet.leagueId}_team_3`;
    const autoSetRows = await db.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, autoSetTeamId), eq(lineupSlots.weekNumber, 2)));
    expect(autoSetRows.length).toBeGreaterThan(0);

    const notices = await db.select().from(memberNotices).where(eq(memberNotices.noticeType, "lineup_auto_set"));
    expect(notices).toHaveLength(1);
  });

  it("starts a due draft through the real ticker action, never a direct startDraft call", async () => {
    const result = await seedEnforcement(db, clock, deps);
    expect(result.draftAutoStart.started).toBe(true);

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, result.draftAutoStart.draftId));
    expect(draft?.status).toBe("in_progress");

    const source = readFileSync(join(process.cwd(), "src", "data", "seed", "seed-enforcement.ts"), "utf8");
    expect(source).not.toContain(".startDraft(");
  });

  it("is safe to run twice — no error, no duplicate trade, the same one held flag and lineup", async () => {
    const first = await seedEnforcement(db, clock, deps);
    const second = await seedEnforcement(db, clock, deps);

    expect(second.heldTrade.outcome).toBe(first.heldTrade.outcome);
    expect(second.heldTrade.tradeId).toBe(first.heldTrade.tradeId);
    expect(second.lineupAutoSet.teamsSet).toBe(0); // already set — a re-run leaves it alone.
    expect(second.draftAutoStart.started).toBe(true); // already started — stays started.

    const flags = await db.select().from(integrityFlags).where(eq(integrityFlags.subjectType, "held_trade"));
    expect(flags).toHaveLength(1);
    const trades = await db.select().from(tradeProposals).where(eq(tradeProposals.leagueId, first.heldTrade.leagueId));
    expect(trades).toHaveLength(1);
  });

  it("seeds through the real services, so what an operator sees locally is what the detector does", () => {
    const source = readFileSync(join(process.cwd(), "src", "data", "seed", "seed-enforcement.ts"), "utf8");
    expect(source).not.toContain("insert(integrityFlags)");
    expect(source).not.toContain("insert(tradeProposals)");
    expect(source).not.toContain("insert(lineupSlots)");
    expect(source).not.toContain("insert(memberNotices)");
  });
});
