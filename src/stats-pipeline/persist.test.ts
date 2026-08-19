import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Db, DbTx } from "@/db/client";
import { players, playerStatLines, statWeeks } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import type { WeekStatus } from "./contract";
import { persistTick, type PersistTickInput } from "./persist";

const db = createTestDb();
const NOW = "2026-09-14T20:00:00.000Z";

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

const line = (playerId: string, over: Partial<StatLine> = {}): StatLine => ({
  playerId, week: 3, passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0,
  rushingTouchdowns: 0, receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
  fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
  ...over,
});

/** Fills in `now` so every call site below only names what the case actually varies. */
function tick(input: {
  readonly week: number;
  readonly changed: readonly StatLine[];
  readonly dropped?: readonly string[];
  readonly status: WeekStatus;
  readonly games: { readonly total: number; readonly final: number };
}): PersistTickInput {
  return { ...input, now: NOW };
}

async function seedPlayers(ids: readonly string[]): Promise<void> {
  await db.insert(players).values(ids.map((id) => ({ id, name: id, position: "QB" as const, nflTeam: "KC" }))).onConflictDoNothing();
}

const WEEK_3_LINES = [
  line("p1", { rushingYards: 40 }), line("p2", { receptions: 3 }), line("p3", { passingYards: 200 }),
  line("p4", { receivingYards: 55 }), line("p5", { sacks: 1.5 }), line("p6", { rushingTouchdowns: 1 }),
  line("p7", { receptions: 5 }), line("p8", { defensiveInterceptions: 1 }),
];

describe("persistTick", () => {
  it("inserts the changed stat lines and creates the stat_weeks row at version 1 on a first tick", async () => {
    await seedPlayers(["p1", "p2"]);
    const changed = [line("p1", { rushingYards: 40 }), line("p2", { receptions: 3 })];
    const result = await persistTick(db, tick({ week: 3, changed, status: "in_progress", games: { total: 4, final: 0 } }));
    expect(result).toEqual({ version: 1, changedCount: 2 });

    const rows = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 3));
    expect(rows).toHaveLength(2);
    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));
    expect(week).toMatchObject({ week: 3, status: "in_progress", version: 1, gamesTotal: 4, gamesFinal: 0 });
  });

  it("does not advance the version on a tick that changed nothing, though status and game counts still move", async () => {
    await seedPlayers(["p1"]);
    await persistTick(db, tick({ week: 3, changed: [line("p1")], status: "in_progress", games: { total: 4, final: 1 } }));
    const result = await persistTick(db, tick({ week: 3, changed: [], status: "in_progress", games: { total: 4, final: 2 } }));
    expect(result).toEqual({ version: 1, changedCount: 0 });

    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));
    // The version the cache keys freshness on held steady; the honest game count still moved.
    expect(week).toMatchObject({ version: 1, gamesFinal: 2 });
  });

  it("re-ingesting a week it has already ingested changes no number and no version", async () => {
    await seedPlayers(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
    await persistTick(db, tick({ week: 3, changed: WEEK_3_LINES, status: "final", games: { total: 2, final: 2 } }));
    const afterFirst = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 3));
    const [weekAfterFirst] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));

    await persistTick(db, tick({ week: 3, changed: WEEK_3_LINES, status: "final", games: { total: 2, final: 2 } }));
    const afterSecond = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 3));
    const [weekAfterSecond] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));

    // Absolute values, upserted on (player_id, week). Double-counting is not something this
    // guards against, it is something the storage model makes unrepresentable, and this is the
    // test that says so out loud rather than a comment claiming it.
    expect(afterSecond).toEqual(afterFirst);
    expect(weekAfterSecond!.version).toBe(weekAfterFirst!.version);
  });

  it("never deletes what a fuller tick already wrote, when a later tick only carries a subset", async () => {
    await seedPlayers(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
    await persistTick(db, tick({ week: 3, changed: WEEK_3_LINES, status: "in_progress", games: { total: 4, final: 1 } }));

    // Simulates an upstream hiccup: only 3 of the 8 players come back this tick, same numbers.
    const partial = [WEEK_3_LINES[0]!, WEEK_3_LINES[1]!, WEEK_3_LINES[2]!];
    await persistTick(db, tick({ week: 3, changed: partial, status: "in_progress", games: { total: 4, final: 1 } }));

    const rows = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 3));
    expect(rows).toHaveLength(8);
    for (const original of WEEK_3_LINES) {
      const stored = rows.find((row) => row.playerId === original.playerId);
      expect(stored).toBeDefined();
    }
  });

  it("drops a player's line only when the `dropped` list explicitly names it", async () => {
    await seedPlayers(["p1", "p2"]);
    await persistTick(db, tick({ week: 3, changed: [line("p1"), line("p2")], status: "final", games: { total: 1, final: 1 } }));
    await persistTick(db, tick({ week: 3, changed: [], dropped: ["p2"], status: "final", games: { total: 1, final: 1 } }));

    const rows = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 3));
    expect(rows.map((row) => row.playerId)).toEqual(["p1"]);
  });

  it("writes the stat lines and the stat_weeks advance in one transaction — a failure on the second write rolls back the first", async () => {
    await seedPlayers(["p1"]);

    // Fails the SECOND `insert` call inside the transaction (the `stat_weeks` upsert), proving
    // the first (`player_stat_lines`) call — which by itself would have succeeded — is rolled
    // back rather than left committed on its own.
    let insertCalls = 0;
    const failingDb = new Proxy(db, {
      get(target, prop, receiver: unknown) {
        if (prop === "transaction") {
          return async (callback: (tx: DbTx) => Promise<unknown>) =>
            target.transaction(async (tx) => {
              const wrappedTx = new Proxy(tx, {
                get(txTarget, txProp, txReceiver: unknown) {
                  if (txProp === "insert") {
                    return (...args: unknown[]) => {
                      insertCalls += 1;
                      if (insertCalls === 2) throw new Error("simulated stat_weeks write failure");
                      const real = Reflect.get(txTarget, txProp, txReceiver) as (...a: unknown[]) => unknown;
                      return real.apply(txTarget, args);
                    };
                  }
                  return Reflect.get(txTarget, txProp, txReceiver);
                },
              });
              return callback(wrappedTx as DbTx);
            });
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(
      persistTick(failingDb as Db, tick({ week: 3, changed: [line("p1")], status: "final", games: { total: 1, final: 1 } })),
    ).rejects.toThrow("simulated stat_weeks write failure");

    const rows = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 3));
    expect(rows).toHaveLength(0);
    const weeks = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));
    expect(weeks).toHaveLength(0);
  });
});
