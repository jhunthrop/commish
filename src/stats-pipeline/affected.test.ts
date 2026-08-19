import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { leagues, lineupSlots, rosterSlots, teams, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Db, ReadonlyDb } from "@/db/client";
import { BENCH_SLOT } from "@/domain/roster";
import { affectedTeams } from "./affected";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

interface TeamSpec {
  readonly teamId: string;
  readonly userId: string;
}

/** One league with the given teams, each owned by its own user. No roster or lineup rows yet. */
async function seedLeague(leagueId: string, teamSpecs: readonly TeamSpec[]): Promise<void> {
  await db.insert(users).values(teamSpecs.map((t) => ({ id: t.userId, email: `${t.userId}@test.local`, displayName: t.userId })));
  await db.insert(leagues).values({
    id: leagueId,
    name: leagueId,
    format: "snake",
    teamCount: teamSpecs.length,
    commissionerUserId: teamSpecs[0].userId,
  });
  await db.insert(teams).values(teamSpecs.map((t) => ({ id: t.teamId, leagueId, userId: t.userId, name: t.teamId })));
}

/**
 * A `Db` that counts actual round trips to Postgres, not calls to the `.select(...)` query
 * builder. The two calls matter because `affected.ts`'s roster fallback builds a SECOND
 * `db.select(...)` internally — for the `notExists` correlated subquery — that is embedded into
 * the outer query's SQL text and never separately awaited. Counting `.select(...)` invocations
 * would see three calls for two real queries and fail the call-count guarantee for the wrong
 * reason. Counting at `$client.unsafe`, the one place postgres-js actually sends a query over
 * the wire, counts what the spec's exit criterion means by "queries".
 */
function countingDb(base: Db): { readonly db: ReadonlyDb; readonly selectCount: () => number } {
  let executions = 0;
  const countedClient = new Proxy(base.$client, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === "unsafe" && typeof value === "function") {
        return (...args: unknown[]) => {
          executions += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
  const countedDb = drizzle(countedClient, { schema });
  return { db: countedDb, selectCount: () => executions };
}

describe("affectedTeams", () => {
  it("reaches a team through a started player", async () => {
    await seedLeague("lgA", [{ teamId: "A1", userId: "uA1" }, { teamId: "A2", userId: "uA2" }]);
    await seedLeague("lgB", [{ teamId: "B1", userId: "uB1" }, { teamId: "B2", userId: "uB2" }]);
    await db.insert(lineupSlots).values({ teamId: "A1", weekNumber: 3, slot: "QB", slotIndex: 0, playerId: "p1" });

    const result = await affectedTeams(db, { week: 3, playerIds: ["p1"] });
    expect(result).toEqual([{ leagueId: "lgA", teamId: "A1" }]);
  });

  it("does not reach a team through a benched player", async () => {
    await seedLeague("lgA", [{ teamId: "A1", userId: "uA1" }, { teamId: "A2", userId: "uA2" }]);
    await db.insert(lineupSlots).values({ teamId: "A2", weekNumber: 3, slot: BENCH_SLOT, slotIndex: 0, playerId: "p1" });

    const result = await affectedTeams(db, { week: 3, playerIds: ["p1"] });
    expect(result).toEqual([]);
  });

  it("reaches a team with no saved lineup through its roster", async () => {
    await seedLeague("lgB", [{ teamId: "B1", userId: "uB1" }, { teamId: "B2", userId: "uB2" }]);
    // B1 has never opened the lineup editor: a roster row for p1 and NO lineup_slots row at all
    // for week 3 (or any week).
    await db.insert(rosterSlots).values({ teamId: "B1", slot: "QB", slotIndex: 0, playerId: "p1" });

    const result = await affectedTeams(db, { week: 3, playerIds: ["p1"] });
    expect(result).toEqual([{ leagueId: "lgB", teamId: "B1" }]);
  });

  it("does not re-admit a benched team through the roster fallback", async () => {
    await seedLeague("lgA", [{ teamId: "A1", userId: "uA1" }, { teamId: "A2", userId: "uA2" }]);
    // A2 deliberately benched p1 (a saved lineup_slots row for week 3 exists) AND still owns p1
    // on its roster. The fallback is restricted to teams with NOTHING saved for the week, so
    // this must not come back in through it.
    await db.insert(lineupSlots).values({ teamId: "A2", weekNumber: 3, slot: BENCH_SLOT, slotIndex: 0, playerId: "p1" });
    await db.insert(rosterSlots).values({ teamId: "A2", slot: BENCH_SLOT, slotIndex: 0, playerId: "p1" });

    const result = await affectedTeams(db, { week: 3, playerIds: ["p1"] });
    expect(result).toEqual([]);
  });

  it("deduplicates a team reached through two changed players", async () => {
    await seedLeague("lgA", [{ teamId: "A1", userId: "uA1" }]);
    await db.insert(lineupSlots).values([
      { teamId: "A1", weekNumber: 3, slot: "QB", slotIndex: 0, playerId: "p1" },
      { teamId: "A1", weekNumber: 3, slot: "RB", slotIndex: 0, playerId: "p2" },
    ]);

    const result = await affectedTeams(db, { week: 3, playerIds: ["p1", "p2"] });
    expect(result).toEqual([{ leagueId: "lgA", teamId: "A1" }]);
  });

  it("short-circuits an empty player set to zero queries", async () => {
    const counting = countingDb(db);
    const result = await affectedTeams(counting.db, { week: 3, playerIds: [] });
    expect(result).toEqual([]);
    expect(counting.selectCount()).toBe(0);
  });

  it("costs the same two queries whether there are two leagues or fifty", async () => {
    // The spec's own exit criterion, and the reason it is phrased as a call count: an O(leagues x
    // teams x starters) implementation returns exactly the same three teams and passes every
    // correctness case above it. Only the counter can tell them apart.
    const LEAGUE_COUNT = 50;
    const TEAMS_PER_LEAGUE = 12;
    const PLAYER_POOL_SIZE = 5_000;
    const SHARED_TEAM_IDS = ["lg1_tm1", "lg2_tm1", "lg3_tm1"];

    await db.execute(sql`
      INSERT INTO users (id, email, display_name)
      SELECT 'u' || g, 'u' || g || '@example.test', 'Manager ' || g
      FROM generate_series(1, ${LEAGUE_COUNT * TEAMS_PER_LEAGUE}) g
    `);
    await db.execute(sql`
      INSERT INTO leagues (id, name, format, team_count, commissioner_user_id)
      SELECT 'lg' || g, 'League ' || g, 'snake'::draft_format, ${TEAMS_PER_LEAGUE}, 'u' || ((g - 1) * ${TEAMS_PER_LEAGUE} + 1)
      FROM generate_series(1, ${LEAGUE_COUNT}) g
    `);
    await db.execute(sql`
      INSERT INTO teams (id, league_id, user_id, name)
      SELECT 'lg' || g || '_tm' || t, 'lg' || g, 'u' || ((g - 1) * ${TEAMS_PER_LEAGUE} + t), 'Team ' || t
      FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${TEAMS_PER_LEAGUE}) t
    `);
    // Every team rosters and starts a filler player from a large shared pool — realistic scale,
    // and none of these filler ids can ever collide with the literal 'p-shared' below.
    await db.execute(sql`
      INSERT INTO roster_slots (team_id, slot, slot_index, player_id)
      SELECT 'lg' || g || '_tm' || t, 'STARTER', 0, 'p-' || (1 + ((g * 13 + t * 7) % ${PLAYER_POOL_SIZE}))
      FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${TEAMS_PER_LEAGUE}) t
    `);
    await db.execute(sql`
      INSERT INTO lineup_slots (team_id, week_number, slot, slot_index, player_id)
      SELECT 'lg' || g || '_tm' || t, 3, 'STARTER', 0, 'p-' || (1 + ((g * 13 + t * 7) % ${PLAYER_POOL_SIZE}))
      FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${TEAMS_PER_LEAGUE}) t
    `);
    // Exactly three teams, across three different leagues, start the one player that changed.
    await db
      .update(lineupSlots)
      .set({ playerId: "p-shared" })
      .where(
        and(
          inArray(lineupSlots.teamId, SHARED_TEAM_IDS),
          eq(lineupSlots.weekNumber, 3),
          eq(lineupSlots.slot, "STARTER"),
          eq(lineupSlots.slotIndex, 0),
        ),
      );
    await db
      .update(rosterSlots)
      .set({ playerId: "p-shared" })
      .where(and(inArray(rosterSlots.teamId, SHARED_TEAM_IDS), eq(rosterSlots.slot, "STARTER"), eq(rosterSlots.slotIndex, 0)));

    const counting = countingDb(db);
    const affected = await affectedTeams(counting.db, { week: 3, playerIds: ["p-shared"] });
    expect(affected).toHaveLength(3);
    expect(counting.selectCount()).toBeLessThanOrEqual(2);
    // Task 5's per-league fan-out order rides on this: the result must arrive already sorted by
    // (leagueId, teamId), not merely happen to be. A dropped sort would still pass toHaveLength.
    const keys = affected.map((row) => `${row.leagueId}:${row.teamId}`);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });
});
