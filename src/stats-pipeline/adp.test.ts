import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import { LIST_ADP_REQUEST_COST, LIST_PLAYERS_REQUEST_COST } from "@/stats/provider";
import { ingestAdp } from "./adp";
import { fakeStatsProvider } from "./test-support";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await truncateAll(db);
});

const GRANTING_BUDGET = { reserveBackfill: async () => ({ granted: true as const }) };

const ROSTER = [
  { id: "adp_a", name: "Player A", position: "QB" as const, nflTeam: "SF", headshotUrl: null, adp: null },
  { id: "adp_b", name: "Player B", position: "RB" as const, nflTeam: "SEA", headshotUrl: null, adp: null },
  { id: "adp_c", name: "Player C", position: "WR" as const, nflTeam: "KC", headshotUrl: null, adp: null },
];

async function seedRoster(): Promise<void> {
  await db.insert(players).values(ROSTER.map((p) => ({ ...p })));
}

async function readAdps(): Promise<readonly { id: string; adp: number | null }[]> {
  return db.select({ id: players.id, adp: players.adp }).from(players).orderBy(asc(players.id));
}

describe("ingestAdp", () => {
  it("writes each feed entry's ADP onto its players row and leaves unranked players null", async () => {
    await seedRoster();
    const provider = fakeStatsProvider({
      players: ROSTER,
      games: {},
      adp: [
        { playerId: "adp_a", adp: 11.4 },
        { playerId: "adp_b", adp: 1.6 },
      ],
    });

    const result = await ingestAdp(db, provider, GRANTING_BUDGET);

    expect(result).toEqual({ adpEntries: 2, playersUpdated: 2 });
    expect(await readAdps()).toEqual([
      { id: "adp_a", adp: 11.4 },
      { id: "adp_b", adp: 1.6 },
      { id: "adp_c", adp: null },
    ]);
  });

  it("is idempotent: a second run rewrites the same values and duplicates nothing", async () => {
    await seedRoster();
    const provider = fakeStatsProvider({
      players: ROSTER,
      games: {},
      adp: [{ playerId: "adp_a", adp: 11.4 }],
    });

    const first = await ingestAdp(db, provider, GRANTING_BUDGET);
    const second = await ingestAdp(db, provider, GRANTING_BUDGET);

    expect(second).toEqual(first);
    const rows = await readAdps();
    expect(rows).toHaveLength(ROSTER.length);
    expect(rows.find((row) => row.id === "adp_a")?.adp).toBe(11.4);
  });

  it("moves a stale ADP to the feed's current value rather than keeping the old one", async () => {
    await seedRoster();
    await db.update(players).set({ adp: 99.9 }).where(eq(players.id, "adp_a"));
    const provider = fakeStatsProvider({ players: ROSTER, games: {}, adp: [{ playerId: "adp_a", adp: 3.2 }] });

    await ingestAdp(db, provider, GRANTING_BUDGET);

    expect((await readAdps()).find((row) => row.id === "adp_a")?.adp).toBe(3.2);
  });

  it("counts a ranked player with no players row honestly: supplied by the feed, updated nowhere", async () => {
    // A feed can rank a player (a rookie, a fresh signing) before the roster backfill has seeded
    // the row. The UPDATE simply lands on nothing — but the counts must SAY so, or a permanently
    // short update count would be indistinguishable from a healthy run.
    await seedRoster();
    const rosterPlusRookie = [...ROSTER, { id: "adp_rookie", name: "Rookie", position: "WR" as const, nflTeam: "DAL", headshotUrl: null, adp: null }];
    const provider = fakeStatsProvider({
      players: rosterPlusRookie,
      games: {},
      adp: [
        { playerId: "adp_a", adp: 11.4 },
        { playerId: "adp_rookie", adp: 4.1 },
      ],
    });

    const result = await ingestAdp(db, provider, GRANTING_BUDGET);

    expect(result).toEqual({ adpEntries: 2, playersUpdated: 1 });
  });

  it("answers an empty feed with zero counts and touches no row", async () => {
    await seedRoster();
    await db.update(players).set({ adp: 5.5 }).where(eq(players.id, "adp_b"));
    const provider = fakeStatsProvider({ players: ROSTER, games: {}, adp: [] });

    const result = await ingestAdp(db, provider, GRANTING_BUDGET);

    expect(result).toEqual({ adpEntries: 0, playersUpdated: 0 });
    expect((await readAdps()).find((row) => row.id === "adp_b")?.adp).toBe(5.5);
  });

  it("reserves the player list and the ADP call separately, each at its documented cost", async () => {
    await seedRoster();
    const reserved: number[] = [];
    const budget = {
      reserveBackfill: vi.fn(async (count: number) => {
        reserved.push(count);
        return { granted: true as const };
      }),
    };
    const provider = fakeStatsProvider({ players: ROSTER, games: {}, adp: [{ playerId: "adp_a", adp: 1.5 }] });

    await ingestAdp(db, provider, budget);

    expect(reserved).toEqual([LIST_PLAYERS_REQUEST_COST, LIST_ADP_REQUEST_COST]);
  });

  it("stops before any upstream call when the ledger denies the player list", async () => {
    await seedRoster();
    let listPlayersCalls = 0;
    const base = fakeStatsProvider({ players: ROSTER, games: {}, adp: [{ playerId: "adp_a", adp: 1.5 }] });
    const counting = {
      ...base,
      listPlayers: async () => {
        listPlayersCalls += 1;
        return base.listPlayers();
      },
    };
    const denying = { reserveBackfill: async () => ({ granted: false as const, denial: "budget-exhausted" as const }) };

    await expect(ingestAdp(db, counting, denying)).rejects.toThrow(/STATS_MONTHLY_REQUEST_BUDGET/);
    expect(listPlayersCalls).toBe(0);
    expect((await readAdps()).every((row) => row.adp === null)).toBe(true);
  });

  it("stops before the ADP request when the ledger denies its reservation, naming the feed", async () => {
    await seedRoster();
    let allowed = 1;
    const stingy = {
      reserveBackfill: async () =>
        allowed-- > 0 ? { granted: true as const } : { granted: false as const, denial: "budget-exhausted" as const },
    };
    let listAdpCalls = 0;
    const base = fakeStatsProvider({ players: ROSTER, games: {}, adp: [{ playerId: "adp_a", adp: 1.5 }] });
    const counting = {
      ...base,
      listAdp: async () => {
        listAdpCalls += 1;
        return base.listAdp();
      },
    };

    await expect(ingestAdp(db, counting, stingy)).rejects.toThrow(/the ADP feed/);
    expect(listAdpCalls).toBe(0);
    expect((await readAdps()).every((row) => row.adp === null)).toBe(true);
  });
});
