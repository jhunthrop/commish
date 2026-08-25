import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players, playerStatLines, scoringSettings } from "@/db/schema";
import { STANDARD_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring";
import { buildDraftPool, invalidateRankedPlayersCache, rankedPlayers } from "./pool";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();

const zeroLine = {
  passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0, rushingTouchdowns: 0,
  receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0, fieldGoalsMade: 0,
  extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("buildDraftPool", () => {
  it("ranks every player by projected season points, best first", async () => {
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_p", leagueId: "league_p", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "star", name: "Star Back", position: "RB", nflTeam: "KC" },
      { id: "scrub", name: "Scrub Back", position: "RB", nflTeam: "NYJ" },
      { id: "middle", name: "Middle Receiver", position: "WR", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([
      { ...zeroLine, playerId: "star", week: 1, rushingYards: 200, rushingTouchdowns: 2 },
      { ...zeroLine, playerId: "middle", week: 1, receivingYards: 100, receptions: 5 },
      { ...zeroLine, playerId: "scrub", week: 1, rushingYards: 10 },
    ]);

    const pool = await buildDraftPool(db, leagueId);
    expect(pool.map((p) => p.playerId)).toEqual(["star", "middle", "scrub"]);
    expect(pool.map((p) => p.position)).toEqual(["RB", "WR", "RB"]);
  });

  it("includes players with no stat lines at all, ranked last and ordered by id", async () => {
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_q", leagueId: "league_q", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "b_rookie", name: "B Rookie", position: "WR", nflTeam: "SF" },
      { id: "a_rookie", name: "A Rookie", position: "WR", nflTeam: "SF" },
      { id: "vet", name: "Vet", position: "WR", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([{ ...zeroLine, playerId: "vet", week: 1, receivingYards: 50 }]);

    expect((await buildDraftPool(db, leagueId)).map((p) => p.playerId)).toEqual(["vet", "a_rookie", "b_rookie"]);
  });

  it("leads with ADP ascending and sinks players without ADP below every ranked one, regardless of projection", async () => {
    // The founder-reported failure this ordering ends: 250 fabricated demo players with stat
    // lines outranked 1,646 real NFL players that had none. ADP is the market's draft order —
    // lower = taken earlier — and a player the feed does not rank belongs after every player it
    // does, no matter how loud his (possibly fabricated) projection is.
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_adp", leagueId: "league_adp", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "demo_star", name: "Demo Star", position: "RB", nflTeam: "KC", adp: null },
      { id: "real_late", name: "Real Late Rounder", position: "WR", nflTeam: "SF", adp: 141.2 },
      { id: "real_first", name: "Real First Pick", position: "RB", nflTeam: "SEA", adp: 1.6 },
      { id: "demo_scrub", name: "Demo Scrub", position: "WR", nflTeam: "NYJ", adp: null },
    ]);
    // The demo players are the only ones with stat lines — the exact live-data shape.
    await db.insert(playerStatLines).values([
      { ...zeroLine, playerId: "demo_star", week: 1, rushingYards: 300, rushingTouchdowns: 3 },
      { ...zeroLine, playerId: "demo_scrub", week: 1, receivingYards: 12 },
    ]);

    const pool = await buildDraftPool(db, leagueId);
    expect(pool.map((p) => p.playerId)).toEqual(["real_first", "real_late", "demo_star", "demo_scrub"]);
  });

  it("breaks an ADP tie by projected points, then by id, keeping the order total", async () => {
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_adp_tie", leagueId: "league_adp_tie", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "tie_b_quiet", name: "Tied Quiet B", position: "WR", nflTeam: "SF", adp: 24.5 },
      { id: "tie_a_quiet", name: "Tied Quiet A", position: "WR", nflTeam: "SEA", adp: 24.5 },
      { id: "tie_loud", name: "Tied Loud", position: "RB", nflTeam: "KC", adp: 24.5 },
    ]);
    await db.insert(playerStatLines).values([{ ...zeroLine, playerId: "tie_loud", week: 1, rushingYards: 120 }]);

    const pool = await buildDraftPool(db, leagueId);
    expect(pool.map((p) => p.playerId)).toEqual(["tie_loud", "tie_a_quiet", "tie_b_quiet"]);
  });

  it("ranks by the league's own scoring settings, not the PPR fallback", async () => {
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_r", leagueId: "league_r", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    // This league scores standard, not PPR — pointsPerReception: 0 — which is the whole point:
    // a test that passes identically under PPR would never catch buildDraftPool ignoring the
    // league's own settings row.
    await db.insert(scoringSettings).values({ leagueId, ...STANDARD_SCORING });
    await db.insert(players).values([
      { id: "grinder", name: "Grinder Back", position: "RB", nflTeam: "KC" },
      { id: "possession", name: "Possession Receiver", position: "WR", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([
      { ...zeroLine, playerId: "grinder", week: 1, rushingYards: 50 },
      { ...zeroLine, playerId: "possession", week: 1, receivingYards: 10, receptions: 20 },
    ]);

    // Under this league's standard settings: grinder = 50 * 0.1 = 5pts; possession =
    // 10 * 0.1 = 1pt (20 receptions score nothing since pointsPerReception is 0). Under the
    // PPR fallback the ranking would flip: possession = 10 * 0.1 + 20 * 1 = 21pts, well above
    // grinder's 5 — so this ranking is only correct if the league's own row was read.
    const grinderPoints = computeFantasyPoints(
      { playerId: "grinder", week: 1, ...zeroLine, rushingYards: 50 },
      "RB",
      STANDARD_SCORING,
    );
    const possessionPoints = computeFantasyPoints(
      { playerId: "possession", week: 1, ...zeroLine, receivingYards: 10, receptions: 20 },
      "WR",
      STANDARD_SCORING,
    );
    expect(grinderPoints).toBe(5);
    expect(possessionPoints).toBe(1);
    expect(grinderPoints).toBeGreaterThan(possessionPoints);

    const pool = await buildDraftPool(db, leagueId);
    expect(pool.map((p) => p.playerId)).toEqual(["grinder", "possession"]);
  });
});

describe("rankedPlayers", () => {
  // Self-contained: no league row is needed, because a league with no scoringSettings row
  // falls back to PPR_SCORING, which this suite already relies on.
  it("ranks whole player rows, best first, and buildDraftPool is exactly its projection", async () => {
    await db.insert(players).values([
      { id: "p_low", name: "Low Output", position: "RB", nflTeam: "SF" },
      { id: "p_high", name: "High Output", position: "RB", nflTeam: "KC" },
    ]);
    await db.insert(playerStatLines).values([
      { ...zeroLine, playerId: "p_low", week: 1, rushingYards: 10 },
      { ...zeroLine, playerId: "p_high", week: 1, rushingYards: 200, rushingTouchdowns: 2 },
    ]);

    const ranked = await rankedPlayers(db, "league_without_settings");
    expect(ranked.map((player) => player.id)).toEqual(["p_high", "p_low"]);
    expect(ranked[0]).toMatchObject({ name: "High Output", position: "RB", nflTeam: "KC" });

    const pool = await buildDraftPool(db, "league_without_settings");
    expect(pool.map((entry) => entry.playerId)).toEqual(ranked.map((player) => player.id));
  });

  it("sinks a null-ADP player whichever side of the comparison it lands on", async () => {
    // Two two-player leagues over the same pair, inserted in opposite orders, so the comparator
    // meets the null on each side deterministically — the property must not depend on which
    // element the sort happens to probe first.
    await db.insert(players).values([
      { id: "null_side", name: "Unranked", position: "RB", nflTeam: "SF", adp: null },
      { id: "ranked_side", name: "Ranked", position: "RB", nflTeam: "KC", adp: 8.2 },
    ]);
    await db.insert(playerStatLines).values([{ ...zeroLine, playerId: "null_side", week: 1, rushingYards: 250 }]);

    const ranked = await rankedPlayers(db, "league_null_each_side");
    expect(ranked.map((p) => p.id)).toEqual(["ranked_side", "null_side"]);

    invalidateRankedPlayersCache("league_null_each_side_reversed");
    await db.delete(players).where(sql`true`);
    await db.insert(players).values([
      { id: "ranked_side", name: "Ranked", position: "RB", nflTeam: "KC", adp: 8.2 },
      { id: "null_side", name: "Unranked", position: "RB", nflTeam: "SF", adp: null },
    ]);
    const reversed = await rankedPlayers(db, "league_null_each_side_reversed");
    expect(reversed.map((p) => p.id)).toEqual(["ranked_side", "null_side"]);
  });

  it("caches the ranking per league id: a row written straight to the DB (bypassing the cache) is not reflected until invalidated", async () => {
    await db.insert(players).values([
      { id: "cache_low", name: "Cache Low", position: "RB", nflTeam: "SF" },
      { id: "cache_high", name: "Cache High", position: "RB", nflTeam: "KC" },
    ]);
    await db.insert(playerStatLines).values([
      { ...zeroLine, playerId: "cache_low", week: 1, rushingYards: 10 },
      { ...zeroLine, playerId: "cache_high", week: 1, rushingYards: 200, rushingTouchdowns: 2 },
    ]);

    const first = await rankedPlayers(db, "league_cache");
    expect(first.map((p) => p.id)).toEqual(["cache_high", "cache_low"]);

    // Flip the underlying data WITHOUT going through the code path that would invalidate the
    // cache (there isn't one — scoring settings are write-once). A memoized call must still
    // return the first ranking.
    await db.delete(playerStatLines);
    await db.insert(playerStatLines).values([{ ...zeroLine, playerId: "cache_low", week: 1, rushingYards: 500 }]);

    const stillCached = await rankedPlayers(db, "league_cache");
    expect(stillCached.map((p) => p.id)).toEqual(["cache_high", "cache_low"]);

    invalidateRankedPlayersCache("league_cache");
    const fresh = await rankedPlayers(db, "league_cache");
    expect(fresh.map((p) => p.id)).toEqual(["cache_low", "cache_high"]);
  });

  it("caches per league id, not globally: two leagues over the same players rank independently", async () => {
    await seedDraftFixture(db, {
      draftId: "draft_cache_standard", leagueId: "league_standard", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "grinder2", name: "Grinder Two", position: "RB", nflTeam: "KC" },
      { id: "possession2", name: "Possession Two", position: "WR", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([
      { ...zeroLine, playerId: "grinder2", week: 1, rushingYards: 50 },
      { ...zeroLine, playerId: "possession2", week: 1, receivingYards: 10, receptions: 20 },
    ]);
    // league_standard scores standard (no PPR); league_ppr has no settings row, so it falls
    // back to PPR_SCORING. Same players, same stat lines, opposite ranking.
    await db.insert(scoringSettings).values({ leagueId: "league_standard", ...STANDARD_SCORING });

    const standard = await rankedPlayers(db, "league_standard");
    const ppr = await rankedPlayers(db, "league_ppr");
    expect(standard.map((p) => p.id)).toEqual(["grinder2", "possession2"]);
    expect(ppr.map((p) => p.id)).toEqual(["possession2", "grinder2"]);
  });

  it("skips a stat line whose player is missing from the roster read, rather than throwing", async () => {
    // `playerStatLines.playerId` is a NOT NULL foreign key to `players.id` ON DELETE CASCADE —
    // through real Postgres a stat line can never outlive its player. The two reads
    // (`roster`, `lines`) are still two independent SELECTs rather than one JOIN, so the guard
    // stays defensive; a stub `Db` is the only way to put it in the state it defends against.
    const stubDb = {
      select: () => ({
        from: (table: unknown) => {
          if (table === players) return Promise.resolve([]);
          if (table === scoringSettings) return { where: () => Promise.resolve([]) };
          if (table === playerStatLines) return { where: () => Promise.resolve([{ ...zeroLine, playerId: "ghost", week: 1, rushingYards: 999 }]) };
          return Promise.resolve([]);
        },
      }),
    } as unknown as Db;

    await expect(rankedPlayers(stubDb, "league_ghost_stat_line")).resolves.toEqual([]);
  });
});
