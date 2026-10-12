import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrityFlags, rosterSlots, teams, tradeProposals } from "@/db/schema";
import { createTestDb, TEST_DATABASE_URL } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { seedPlayers } from "./seed-players";
import { seedTrades } from "./seed-trades";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };

// `notify` is left at its real default (`notifyAffectedMember`) — it only writes to
// `member_notices` through the transaction this test's own `db` already has, no external
// dependency involved. `deliver` is the one seam this test stubs, the identical shape
// `trades.test.ts`'s own `deliverNoticeFake` uses: the real `deliverNotice` publishes to Redis,
// and this file has none to publish to.
const noopDeps = { deliver: async () => {} };

beforeEach(async () => {
  // `seedPlayers`/`seedTrades` both refuse to run against a database they cannot prove is
  // local — the test database IS local, so say so explicitly (mirrors `seed-season-league.test.ts`).
  vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
  vi.stubEnv("DATABASE_URL", TEST_DATABASE_URL);
  await truncateAll(db);
  // The real committed dataset, not a hand-rolled fixture: `seedTrades`' whole point is that the
  // gap between two real players' averages — not a number this test invents — is what decides
  // which of the three fixtures crosses the fairness threshold.
  await seedPlayers(db, createMockStatsProvider());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedTrades", () => {
  it("produces exactly one flag from three trades, and the flag names the grotesque one", async () => {
    const result = await seedTrades(db, clock, undefined, noopDeps);
    expect(result.tradesAccepted).toBe(3);
    expect(result.flagsRaised).toBe(1);

    const proposals = await db.select().from(tradeProposals).where(eq(tradeProposals.leagueId, result.leagueId));
    expect(proposals).toHaveLength(3);
    expect(proposals.every((row) => row.status === "accepted")).toBe(true);

    const flags = await db.select().from(integrityFlags).where(eq(integrityFlags.subjectType, "trade"));
    expect(flags).toHaveLength(1);
    const grotesque = proposals.find((row) => row.id.endsWith("_trade_grotesque"));
    expect(flags[0]!.subjectId).toBe(grotesque!.id);
    expect(flags[0]!.flagType).toBe("trade_fairness");
    // Open — never pre-resolved. The operator queue is where this gets answered, not the seed.
    expect(flags[0]!.resolvedAt).toBeNull();
  });

  it("deals every team a full, legal roster", async () => {
    const result = await seedTrades(db, clock, undefined, noopDeps);
    const teamRows = await db.select().from(teams).where(eq(teams.leagueId, result.leagueId));
    expect(teamRows).toHaveLength(4);
    for (const team of teamRows) {
      const slots = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, team.id));
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.every((slot) => slot.playerId !== null)).toBe(true);
    }
  });

  it("is safe to run twice — no error, no duplicate trades, the same one flag", async () => {
    const first = await seedTrades(db, clock, undefined, noopDeps);
    const second = await seedTrades(db, clock, undefined, noopDeps);
    expect(second.tradesAccepted).toBe(first.tradesAccepted);
    expect(second.flagsRaised).toBe(first.flagsRaised);

    const proposals = await db.select().from(tradeProposals).where(eq(tradeProposals.leagueId, first.leagueId));
    expect(proposals).toHaveLength(3);
    const flags = await db.select().from(integrityFlags).where(eq(integrityFlags.subjectType, "trade"));
    expect(flags).toHaveLength(1);
  });

  it("seeds through the real services, so what an operator sees locally is what the detector does", () => {
    // The founder rule against mock data on real surfaces, checked rather than asserted.
    const source = readFileSync(join(process.cwd(), "src", "data", "seed", "seed-trades.ts"), "utf8");
    expect(source).not.toContain("insert(integrityFlags)");
    expect(source).not.toContain("insert(tradeProposals)");
  });
});
