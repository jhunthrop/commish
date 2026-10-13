import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import type { Db, DbTx } from "@research-ts/db/client";
import { players, playerStatLines, statWeeks } from "@research-ts/db/schema";
import type { StatLine } from "@research-ts/domain/player";
import type { WeekStatus } from "./contract";
import { dedupedByPlayerId, persistTick, type PersistTickInput } from "./persist";

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

  it("advances version from 1 to exactly 2 on a second tick with genuinely changed values", async () => {
    // The first-ever tick for a week inserts `stat_weeks` fresh (the `values: { version:
    // versionBump }` branch of the upsert) — every other test above that asserts a version
    // number only ever exercises that branch once. This is the one that exercises the SIBLING
    // branch, the `onConflictDoUpdate` `set: { version: sql`${statWeeks.version} + ...` }` path,
    // against an already-versioned row: a bug in that arithmetic (e.g. a stray reference to
    // `excluded.version`) would pass every other test here, since they only ever add 0 to an
    // existing row.
    await seedPlayers(["p1"]);
    const first = await persistTick(db, tick({ week: 3, changed: [line("p1", { rushingYards: 40 })], status: "in_progress", games: { total: 2, final: 0 } }));
    expect(first).toEqual({ version: 1, changedCount: 1 });

    // A genuinely different number for the same player — not a re-submission of tick one's line.
    const second = await persistTick(db, tick({ week: 3, changed: [line("p1", { rushingYards: 87 })], status: "in_progress", games: { total: 2, final: 1 } }));
    expect(second).toEqual({ version: 2, changedCount: 1 });

    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));
    expect(week!.version).toBe(2);
    const [line1] = await db.select().from(playerStatLines).where(eq(playerStatLines.playerId, "p1"));
    expect(line1!.rushingYards).toBe(87);
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

  it("never lets a stale tick regress a settled week back to in_progress", async () => {
    // Two instances partition a week's games differently under `maxGamesPerTick`, so the one that
    // fetched fewer of them computes `everyFinalGameIngested = false` from markers the other has
    // not committed yet. Without monotonicity that instance writes `in_progress` over `final`,
    // which re-arms the examination window and re-spends the request budget on a settled week.
    await seedPlayers(["p1"]);
    await persistTick(db, tick({ week: 3, changed: [line("p1")], status: "final", games: { total: 2, final: 2 } }));

    await persistTick(db, tick({ week: 3, changed: [], status: "in_progress", games: { total: 2, final: 1 } }));

    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));
    expect(week!.status).toBe("final");
    // The honest facts a stale tick DOES carry still land: only the settled status is pinned.
    expect(week!.gamesFinal).toBe(1);
  });

  it("a week that has not settled still moves through every status", async () => {
    // The other half of monotonicity: it pins `final` and nothing else, so a week walking
    // scheduled -> in_progress is untouched by the rule above.
    await persistTick(db, tick({ week: 4, changed: [], status: "scheduled", games: { total: 2, final: 0 } }));
    await persistTick(db, tick({ week: 4, changed: [], status: "in_progress", games: { total: 2, final: 1 } }));

    const [week] = await db.select().from(statWeeks).where(eq(statWeeks.week, 4));
    expect(week!.status).toBe("in_progress");
  });

  it("orders a bulk write by playerId and keeps one line per player, last wins", () => {
    // Two writers inserting the same two rows in opposite orders is a deadlock, and a repeated
    // conflict key is a rejected statement. Both are unobservable in the SQL, which looks
    // identical either way, so they are asserted here.
    const shuffled = [line("p9"), line("p1"), line("p5")];
    expect(dedupedByPlayerId(shuffled).map((row) => row.playerId)).toEqual(["p1", "p5", "p9"]);
    expect(shuffled.map((row) => row.playerId)).toEqual(["p9", "p1", "p5"]); // non-mutating

    const duplicated = [line("p1", { passingYards: 10 }), line("p2"), line("p1", { passingYards: 99 })];
    const deduped = dedupedByPlayerId(duplicated);
    expect(deduped.map((row) => row.playerId)).toEqual(["p1", "p2"]);
    expect(deduped[0]!.passingYards).toBe(99);
  });
});
