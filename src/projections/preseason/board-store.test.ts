import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { preseasonProjections } from "@/db/schema";
import { recordNflPlayers } from "../universe";
import type { NflPlayerRow } from "../nflverse/players";
import type { BoardEntry, BoardReason } from "./board";
import {
  BOARD_SOURCE,
  BOARD_SOURCE_V1_RAW,
  BOARD_SOURCE_V7_SHADOW,
  FROZEN_BOARD_SOURCES,
  assertSingleGeneration,
  boardReasons,
  preseasonProjectionsAsOf,
  preseasonProjectionsFor,
  projectionRows,
  reasonRows,
  recordPreseasonBoardReasons,
  recordPreseasonProjections,
  writePreseasonBoard,
} from "./board-store";

/**
 * The store's job is to hold what the board said AND when it was entitled to say it, so that is
 * what these test. A stored projection whose stamp had drifted would not fail anything — it would
 * make a backtest that reads it look better than the engine is, which is the exact shape of the two
 * leakage defects this engine has already found by audit rather than by a failing test.
 */
const db = createTestDb();

const AUGUST = new Date("2024-09-06T23:59:59.999Z");
const A_WEEK_LATER = new Date("2024-09-13T23:59:59.999Z");
const FINAL = new Date("9999-12-31T00:00:00.000Z");

const CHASE = "00-0036900";
const LAMB = "00-0036322";

function nflPlayerRow(overrides: Partial<NflPlayerRow> = {}): NflPlayerRow {
  return {
    id: CHASE,
    pfrId: "ChasJa00",
    espnId: "4362628",
    name: "Ja'Marr Chase",
    position: "WR",
    latestTeam: "CIN",
    rookieSeason: 2021,
    lastSeason: 2026,
    ...overrides,
  };
}

function entry(overrides: Partial<BoardEntry> = {}): BoardEntry {
  return {
    playerId: CHASE,
    position: "WR",
    projectedPoints: 326.4,
    valueOverReplacement: 141.2,
    positionRank: 2,
    replacementLevel: 185.2,
    rank: 2,
    valueRank: 3,
    team: "CIN",
    expectedGames: 16.2,
    seasonLine: { playerId: CHASE, week: 0 } as BoardEntry["seasonLine"],
    outlook: { floor: 261.1, median: 326.4, ceiling: 359.0 },
    tier: 0,
    playersLeftInTier: 4,
    dropToNextTier: 18.3,
    reasons: [],
    ...overrides,
  };
}

async function store(board: readonly BoardEntry[], asOf: Date): Promise<number> {
  return recordPreseasonProjections(db, projectionRows(board, { season: 2024, source: BOARD_SOURCE, asOf, momentKind: "replay" }));
}

async function storeReasons(board: readonly BoardEntry[], asOf: Date): Promise<number> {
  return recordPreseasonBoardReasons(db, reasonRows(board, { season: 2024, source: BOARD_SOURCE, asOf }));
}

describe("the preseason board store", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await recordNflPlayers(db, [
      nflPlayerRow(),
      nflPlayerRow({ id: LAMB, pfrId: "LambCe00", espnId: "4241389", name: "CeeDee Lamb", latestTeam: "DAL" }),
    ]);
  });

  it("stores every number the board carried, under the board's own moment", async () => {
    await store([entry()], AUGUST);
    const [row] = await preseasonProjectionsAsOf(db, { season: 2024, source: BOARD_SOURCE, asOf: FINAL });
    expect(row).toEqual({
      season: 2024,
      source: BOARD_SOURCE,
      playerId: CHASE,
      rank: 2,
      positionRank: 2,
      projectedPoints: 326.4,
      valueOverReplacement: 141.2,
      valueRank: 3,
      expectedGames: 16.2,
      floorPoints: 261.1,
      medianPoints: 326.4,
      ceilingPoints: 359.0,
      tier: 0,
      asOf: AUGUST,
      momentKind: "replay",
    });
  });

  it("records the moment kind a board was taken at (Task 2), never confusing a live row for a replay one", async () => {
    await recordPreseasonProjections(
      db,
      projectionRows([entry({ playerId: LAMB })], { season: 2024, source: BOARD_SOURCE, asOf: AUGUST, momentKind: "live" }),
    );
    const [row] = await preseasonProjectionsAsOf(db, { season: 2024, source: BOARD_SOURCE, asOf: FINAL });
    expect(row?.momentKind).toBe("live");
  });

  /** The gate, which is the only thing standing between a 2024 board and a 2025 file. */
  it("hides a board from a reader standing before it was taken", async () => {
    await store([entry()], A_WEEK_LATER);
    expect(await preseasonProjectionsAsOf(db, { season: 2024, source: BOARD_SOURCE, asOf: AUGUST })).toEqual([]);
  });

  it("is a no-op on a second run of the same board", async () => {
    expect(await store([entry(), entry({ playerId: LAMB, rank: 1 })], AUGUST)).toBe(2);
    expect(await store([entry(), entry({ playerId: LAMB, rank: 1 })], AUGUST)).toBe(0);
  });

  /**
   * A REFIT IS A NEW ROW, never an overwrite. The earlier belief stays readable, so a replay that
   * stood before the refit still sees the number the product was actually showing that day.
   */
  it("keeps both statements when a later run says something different", async () => {
    await store([entry({ rank: 2 })], AUGUST);
    await store([entry({ rank: 7 })], A_WEEK_LATER);
    const before = await preseasonProjectionsAsOf(db, { season: 2024, source: BOARD_SOURCE, asOf: AUGUST });
    const after = await preseasonProjectionsAsOf(db, { season: 2024, source: BOARD_SOURCE, asOf: FINAL });
    expect(before[0]?.rank).toBe(2);
    expect(after[0]?.rank).toBe(7);
  });

  it("reads one man without reading the whole board", async () => {
    await store([entry(), entry({ playerId: LAMB, rank: 1, positionRank: 1 })], AUGUST);
    const rows = await preseasonProjectionsFor(db, { season: 2024, source: BOARD_SOURCE, asOf: FINAL }, [LAMB]);
    expect(rows.map((row) => row.playerId)).toEqual([LAMB]);
  });

  /** No projection means NO ROW, never a zero. The caller prints a dash. */
  it("says nothing at all about a player the board never ranked", async () => {
    await store([entry()], AUGUST);
    expect(await preseasonProjectionsFor(db, { season: 2024, source: BOARD_SOURCE, asOf: FINAL }, [LAMB])).toEqual([]);
    expect(await preseasonProjectionsFor(db, { season: 2024, source: BOARD_SOURCE, asOf: FINAL }, [])).toEqual([]);
  });

  it("does not hand one board's rows to a reader asking for another season or another board", async () => {
    await store([entry()], AUGUST);
    expect(await preseasonProjectionsAsOf(db, { season: 2023, source: BOARD_SOURCE, asOf: FINAL })).toEqual([]);
    expect(await preseasonProjectionsAsOf(db, { season: 2024, source: "some_other_board", asOf: FINAL })).toEqual([]);
  });

  /**
   * Task 7 — `reasons` used to be the one thing `board-store.ts`'s own docblock said was
   * deliberately not stored yet. These are the tests that lift that.
   */
  describe("board reasons", () => {
    const AVAILABILITY: BoardReason = { code: "availability", expectedGames: 15.4, floorGames: 12, ceilingGames: 17 };
    const LAW: BoardReason = { code: "law", lawId: "target_share_persistence", effect: 1.8, magnitude: 0.31 };
    const LAW2: BoardReason = { code: "law", lawId: "wr_target_competition", effect: -2.4, magnitude: 0.35 };

    it("round-trips every reason on a board, typed", async () => {
      await storeReasons([entry({ reasons: [AVAILABILITY, LAW] })], AUGUST);
      const byPlayer = await boardReasons(db, BOARD_SOURCE, 2024);
      const stored = [...(byPlayer.get(CHASE) ?? [])].sort((a, b) => a.code.localeCompare(b.code));
      expect(stored).toEqual([AVAILABILITY, LAW]);
    });

    /**
     * The fix round's own case: `target_share_persistence` and `wr_target_competition` can both be
     * true for the same receiver at once, and the PK's `detail` column (the law id) is what lets
     * both survive rather than one silently overwriting the other.
     */
    it("round-trips BOTH reasons for a player who trips two confirmed laws at once", async () => {
      await storeReasons([entry({ reasons: [LAW, LAW2] })], AUGUST);
      const byPlayer = await boardReasons(db, BOARD_SOURCE, 2024);
      const stored = [...(byPlayer.get(CHASE) ?? [])].sort((a, b) =>
        a.code === "law" && b.code === "law" ? a.lawId.localeCompare(b.lawId) : 0,
      );
      expect(stored).toEqual([LAW, LAW2]);
    });

    /**
     * Same `(player, law)` PK, written twice with IDENTICAL content — one row, never two, and the
     * second write is a TRUE no-op (Postgres itself decides via `changedRowWhere`, not a count this
     * function merely labels): the second call's `RETURNING` is empty because nothing about the
     * stored row actually changed.
     */
    it("upserts the same (player, law) reason written twice with identical content to one row", async () => {
      expect(await storeReasons([entry({ reasons: [LAW] })], AUGUST)).toBe(1);
      expect(await storeReasons([entry({ reasons: [LAW] })], AUGUST)).toBe(0);
      const byPlayer = await boardReasons(db, BOARD_SOURCE, 2024);
      expect(byPlayer.get(CHASE)).toEqual([LAW]);
    });

    /**
     * Fix round (IMPORTANT 1) — the schema's own docblock promises a rerun REPLACES this table's
     * opinion, which `onConflictDoNothing` never actually delivered: a refreshed `measured.json`
     * moving a law's `effect`, or a player's magnitude moving with new facts, would have left the
     * FIRST-written payload stored forever. `onConflictDoUpdate` fixes it — this is the case that
     * proves it: the SAME `(player, lawId)` key, a genuinely different payload, and the read must
     * come back with the NEW numbers, not the old ones.
     */
    it("replaces a stored reason's payload when a rerun writes CHANGED content for the same (player, law)", async () => {
      // `asOf` plays no part in this table's identity (no `as_of` column — see its own docblock),
      // so both writes are stamped identically; only the payload differs between them.
      const REFIT: BoardReason = { code: "law", lawId: "target_share_persistence", effect: 2.6, magnitude: 0.4 };
      expect(await storeReasons([entry({ reasons: [LAW] })], AUGUST)).toBe(1);
      expect(await storeReasons([entry({ reasons: [REFIT] })], AUGUST)).toBe(1);
      const byPlayer = await boardReasons(db, BOARD_SOURCE, 2024);
      expect(byPlayer.get(CHASE)).toEqual([REFIT]);
    });

    it("keys reasons by player, never mixing one man's reasons into another's", async () => {
      await storeReasons(
        [entry({ reasons: [AVAILABILITY] }), entry({ playerId: LAMB, reasons: [LAW] })],
        AUGUST,
      );
      const byPlayer = await boardReasons(db, BOARD_SOURCE, 2024);
      expect(byPlayer.get(CHASE)).toEqual([AVAILABILITY]);
      expect(byPlayer.get(LAMB)).toEqual([LAW]);
    });

    it("says nothing about a player nobody stored a reason for", async () => {
      await storeReasons([entry({ reasons: [AVAILABILITY] })], AUGUST);
      const byPlayer = await boardReasons(db, BOARD_SOURCE, 2024);
      expect(byPlayer.has(LAMB)).toBe(false);
    });

    it("is a no-op on a second run of the same board", async () => {
      expect(await storeReasons([entry({ reasons: [AVAILABILITY, LAW] })], AUGUST)).toBe(2);
      expect(await storeReasons([entry({ reasons: [AVAILABILITY, LAW] })], AUGUST)).toBe(0);
    });

    /**
     * A DROP, NEVER A THROW — a variant retired since the row was written, or a row this store
     * never wrote at all. `console.warn` names the count so the drop is visible.
     */
    it("drops a row with an unrecognised reason code, warning with a count, rather than throwing", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await recordPreseasonBoardReasons(db, [
        { season: 2024, source: BOARD_SOURCE, playerId: CHASE, code: "retired_variant", detail: "", payload: { anything: true } },
      ]);
      await storeReasons([entry({ reasons: [AVAILABILITY] })], AUGUST);

      const byPlayer = await boardReasons(db, BOARD_SOURCE, 2024);

      expect(byPlayer.get(CHASE)).toEqual([AVAILABILITY]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("1 row");
      warn.mockRestore();
    });

    it("does not hand one board's reasons to a reader asking for another season or another board", async () => {
      await storeReasons([entry({ reasons: [AVAILABILITY] })], AUGUST);
      expect((await boardReasons(db, BOARD_SOURCE, 2023)).size).toBe(0);
      expect((await boardReasons(db, "some_other_board", 2024)).size).toBe(0);
    });
  });

  /**
   * A LIVE BOARD RETIRES ITS OWN PRIOR GENERATION; A REPLAY BOARD NEVER DOES.
   *
   * The roster hotfix that preceded this one cleared the stale ROSTER rows and left the stale BOARD
   * rows standing: `preseasonProjectionsAsOf` reads `DISTINCT ON (player_id)` with `as_of <= bound`,
   * so a player who was on yesterday's live board and is absent from today's smaller one survives
   * with yesterday's points, rank and reasons, and the product goes on drawing him. That is how a
   * released running back stayed at value#118 after his roster row had already been corrected. A
   * REPLAY board must keep the append behaviour byte-identically: the archive's stored boards are
   * what every published measurement was scored against.
   */
  describe("writePreseasonBoard", () => {
    const LAW: BoardReason = { code: "law", lawId: "target_share_persistence", effect: 1.8, magnitude: 0.31 };
    const UNKNOWN_TO_THE_UNIVERSE = "00-9999999";
    /**
     * A source THIS BLOCK OWNS, deliberately not `BOARD_SOURCE` (fit-round final review). Every test
     * below is about the write path's own mechanics, which are the same whichever board is being
     * written, and addressing the SHIPPED source from a unit test made these tests hostage to a
     * product decision they have nothing to do with: `FROZEN_BOARD_SOURCES` now refuses writes under
     * the served names, so the block that exercises retire-and-write has to name a board nobody
     * serves. The freeze's own behaviour is tested separately, against the real constants.
     */
    const WRITE_SOURCE = "test_board_write_path_ppr_12";

    function write(board: readonly BoardEntry[], asOf: Date, momentKind: "live" | "replay") {
      return writePreseasonBoard(db, { season: 2024, source: WRITE_SOURCE, asOf, momentKind }, board);
    }

    /** Every row the table holds for this board, at any stamp — the question `preseasonProjectionsAsOf`
     *  cannot answer, since it collapses to one row per player. */
    async function everyStoredRow(): Promise<ReadonlyArray<{ playerId: string; asOf: Date }>> {
      return db
        .select({ playerId: preseasonProjections.playerId, asOf: preseasonProjections.asOf })
        .from(preseasonProjections)
        .where(and(eq(preseasonProjections.season, 2024), eq(preseasonProjections.source, WRITE_SOURCE)));
    }

    it("LIVE: a player absent from the fresh board has NO row afterwards, at any stamp (the McLaughlin shape)", async () => {
      await write([entry(), entry({ playerId: LAMB })], AUGUST, "live");
      const second = await write([entry()], A_WEEK_LATER, "live");

      expect(second.mode).toBe("retire_generation");
      const rows = await everyStoredRow();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ playerId: CHASE, asOf: A_WEEK_LATER });
      // And through the reader the product actually uses, which is where the stale row surfaced.
      const board = await preseasonProjectionsAsOf(db, { season: 2024, source: WRITE_SOURCE, asOf: FINAL });
      expect(board.map((row) => row.playerId)).toEqual([CHASE]);
    });

    it("LIVE: reasons retire with their projections, so no reason is orphaned from a board row", async () => {
      await write([entry({ reasons: [LAW] }), entry({ playerId: LAMB, reasons: [LAW] })], AUGUST, "live");
      const second = await write([entry({ reasons: [LAW] })], A_WEEK_LATER, "live");

      expect(second.retiredReasons).toBe(2);
      const byPlayer = await boardReasons(db, WRITE_SOURCE, 2024);
      expect([...byPlayer.keys()]).toEqual([CHASE]);
    });

    it("LIVE: reports what it retired and what it wrote, honestly", async () => {
      const first = await write([entry({ reasons: [LAW] }), entry({ playerId: LAMB })], AUGUST, "live");
      expect(first).toEqual({ mode: "retire_generation", written: 2, reasonsWritten: 1, retiredProjections: 0, retiredReasons: 0 });

      const second = await write([entry({ reasons: [LAW] })], A_WEEK_LATER, "live");
      expect(second).toEqual({ mode: "retire_generation", written: 1, reasonsWritten: 1, retiredProjections: 2, retiredReasons: 1 });
    });

    it("LIVE: REFUSES an empty board rather than retiring a generation and writing nothing in its place", async () => {
      await write([entry()], AUGUST, "live");
      await expect(write([], A_WEEK_LATER, "live")).rejects.toThrow(/empty/i);
      expect(await everyStoredRow()).toHaveLength(1);
    });

    it("LIVE: is ATOMIC — a write that fails partway leaves the previous generation exactly as it was", async () => {
      await write([entry(), entry({ playerId: LAMB })], AUGUST, "live");
      const before = await everyStoredRow();

      // A player the universe does not hold: the foreign key fails the INSERT, in the same
      // transaction as the DELETE that has already run. The failing statement is asserted so a
      // rejection raised before the delete could not pass this test.
      await expect(write([entry({ playerId: UNKNOWN_TO_THE_UNIVERSE })], A_WEEK_LATER, "live")).rejects.toThrow(
        /insert into "preseason_projections"/,
      );

      expect(await everyStoredRow()).toEqual(before);
    });

    it("REPLAY: is APPEND-ONLY, byte-identical to the write every archived board landed under", async () => {
      await write([entry(), entry({ playerId: LAMB })], AUGUST, "replay");
      const second = await write([entry()], A_WEEK_LATER, "replay");

      expect(second).toEqual({ mode: "append", written: 1, reasonsWritten: 0, retiredProjections: 0, retiredReasons: 0 });
      // Three rows: both of the first generation's, untouched, plus the second's.
      expect(await everyStoredRow()).toHaveLength(3);
      // The player the newer board dropped is STILL readable, which is exactly what an archive is for.
      const board = await preseasonProjectionsAsOf(db, { season: 2024, source: WRITE_SOURCE, asOf: FINAL });
      expect(board.map((row) => row.playerId).sort()).toEqual([LAMB, CHASE].sort());
    });

    it("REPLAY: never touches another board's rows either, since it deletes nothing at all", async () => {
      await write([entry({ reasons: [LAW] })], AUGUST, "replay");
      await write([entry({ playerId: LAMB })], A_WEEK_LATER, "replay");
      expect((await boardReasons(db, WRITE_SOURCE, 2024)).get(CHASE)).toEqual([LAW]);
    });
  });

  /**
   * THE FREEZE (fit-round final review, the CRITICAL finding).
   *
   * The fit round ended with `BOARD_SOURCE` pointing back at v7 after two held-out bar breaks, while
   * every fitted file on the tree is the v9 configuration. That combination makes the persist script
   * a loaded gun: a bare `npm run projections:preseason:persist` would take the LIVE 2026 path, and
   * `writePreseasonBoard`'s live arm retires the stored generation before writing, so the 546 rows
   * the product actually serves would be deleted and replaced by rows this tree's constants produce,
   * under v7's name, unrecoverably. The REPLAY arm carries a quieter version of the same defect:
   * `preseason_board_reasons` has no `as_of` and is written with `onConflictDoUpdate`, so an archive
   * re-run rewrites archive reasons to the 87-law family's opinions while the archived POINTS stay
   * v7-era, leaving a board whose explanations describe numbers it is not showing.
   *
   * These tests are the guard's contract. They address the REAL constants deliberately: a freeze that
   * did not cover the actually-served names would be theatre.
   */
  describe("FROZEN_BOARD_SOURCES", () => {
    const LIVE_2026 = new Date("2026-09-02T12:00:00.000Z");

    function writeUnder(source: string, season: number, momentKind: "live" | "replay", options?: { readonly unfrozen?: boolean }) {
      return writePreseasonBoard(db, { season, source, asOf: LIVE_2026, momentKind }, [entry()], options);
    }

    /**
     * RE-ADJUDICATED (Round D, the serve-v9 ruling). The set used to be the two names the persist
     * script writes; it is now the one name this tree cannot rebuild. These tests assert the new
     * membership from BOTH sides on purpose — what is frozen, and what is deliberately no longer
     * frozen — because a guard nobody checks the negative half of is a guard that quietly grows
     * back.
     */
    it("names exactly the prior champion the tree cannot rebuild, and nothing else", () => {
      expect([...FROZEN_BOARD_SOURCES]).toEqual([BOARD_SOURCE_V7_SHADOW]);
    });

    it("LIVE under v7 is REFUSED, so the register's shadow track cannot be retired out from under it", async () => {
      await expect(writeUnder(BOARD_SOURCE_V7_SHADOW, 2026, "live")).rejects.toThrow(/frozen/i);
    });

    it("LIVE under a frozen source is refused for EVERY season, not only 2026", async () => {
      // Wider than the finding, and deliberately so: the live arm deletes by `(season, source)` at
      // ANY stamp, so a live-moment write aimed at an ARCHIVE season under a frozen name would
      // delete that archive outright. Nothing legitimate needs a live write under v7 at all, so the
      // guard does not try to tell the two cases apart.
      await expect(writeUnder(BOARD_SOURCE_V7_SHADOW, 2024, "live")).rejects.toThrow(/frozen/i);
    });

    it("REPLAY under a frozen source is REFUSED, because the reason rewrite has no as_of to protect it", async () => {
      await expect(writeUnder(BOARD_SOURCE_V7_SHADOW, 2021, "replay")).rejects.toThrow(/frozen/i);
    });

    it("THE SERVED BOARD IS WRITABLE AGAIN: v9 is what this tree builds, so a persist reproduces it", async () => {
      // The substantive half of the re-adjudication. A live re-take of the served 2026 board is the
      // normal weekly act of a live season, and it was refused while the tree and the store held
      // different configurations. They hold the same one now.
      const live = await writeUnder(BOARD_SOURCE, 2026, "live");
      expect(live.mode).toBe("retire_generation");
    });

    it("v1 RAW IS WRITABLE AGAIN, which is what lets a v9 persist finish its second leg", async () => {
      // `persistSeason` writes v1 raw in the same call as BOARD_SOURCE. A frozen v1 would refuse
      // every legitimate persist halfway through, having already written the blended board.
      const live = await writeUnder(BOARD_SOURCE_V1_RAW, 2026, "live");
      expect(live.mode).toBe("retire_generation");
    });

    it("REFUSES BEFORE IT WRITES OR DELETES ANYTHING: the store is untouched after a refusal", async () => {
      await recordPreseasonProjections(
        db,
        projectionRows([entry()], { season: 2026, source: BOARD_SOURCE_V7_SHADOW, asOf: LIVE_2026, momentKind: "live" }),
      );
      const before = await preseasonProjectionsAsOf(db, { season: 2026, source: BOARD_SOURCE_V7_SHADOW, asOf: FINAL });
      expect(before).toHaveLength(1);

      await expect(writeUnder(BOARD_SOURCE_V7_SHADOW, 2026, "live")).rejects.toThrow(/frozen/i);

      expect(await preseasonProjectionsAsOf(db, { season: 2026, source: BOARD_SOURCE_V7_SHADOW, asOf: FINAL })).toEqual(before);
    });

    it("the refusal says WHICH ruling froze it and HOW to lift it, rather than merely failing", async () => {
      await expect(writeUnder(BOARD_SOURCE_V7_SHADOW, 2026, "live")).rejects.toThrow(/--unfreeze/);
      await expect(writeUnder(BOARD_SOURCE_V7_SHADOW, 2026, "live")).rejects.toThrow(/shadow/i);
    });

    it("UNFREEZE overrides both arms, which is the only way v7's rows can ever be touched", async () => {
      const live = await writeUnder(BOARD_SOURCE_V7_SHADOW, 2026, "live", { unfrozen: true });
      expect(live.mode).toBe("retire_generation");
      const replay = await writeUnder(BOARD_SOURCE_V7_SHADOW, 2021, "replay", { unfrozen: true });
      expect(replay.mode).toBe("append");
    });

    it("LEAVES EVERY OTHER SOURCE ALONE: an unfrozen board still appends and still no-ops on a rerun", async () => {
      const stamp = { season: 2021, source: "some_other_board_ppr_12", asOf: LIVE_2026, momentKind: "replay" as const };
      const first = await writePreseasonBoard(db, stamp, [entry({ reasons: [{ code: "scarcity", positionRank: 2, replacementLevel: 185.2 }] })]);
      expect(first).toEqual({ mode: "append", written: 1, reasonsWritten: 1, retiredProjections: 0, retiredReasons: 0 });

      // The archive rerun this freeze exists to prevent, proven harmless where it is allowed: the
      // projection insert no-ops on its own unique key and the unchanged reason payload no-ops on
      // `changedRowWhere`, exactly as before the guard existed.
      const second = await writePreseasonBoard(db, stamp, [entry({ reasons: [{ code: "scarcity", positionRank: 2, replacementLevel: 185.2 }] })]);
      expect(second).toEqual({ mode: "append", written: 0, reasonsWritten: 0, retiredProjections: 0, retiredReasons: 0 });
    });
  });

  /**
   * THE LOUD READ (Round D, Task 3). `writePreseasonBoard`'s live arm retires a prior generation
   * before writing a new one, so a well-behaved live source never carries more than one `as_of`.
   * These tests seed the broken invariant DIRECTLY — bypassing `writePreseasonBoard` entirely, the
   * same way a retire that failed partway (a crash between the DELETE and the INSERT reaching every
   * replica, a hand-run script) would leave the table — because the point of this guard is to catch
   * that shape however it happened, not only the one path this engine's own writer takes.
   */
  describe("assertSingleGeneration", () => {
    const LIVE_SOURCE = "test_single_generation_live_ppr_12";
    const REPLAY_SOURCE = "test_single_generation_replay_ppr_12";

    async function seed(source: string, season: number, asOf: Date, momentKind: "live" | "replay") {
      await recordPreseasonProjections(db, projectionRows([entry()], { season, source, asOf, momentKind }));
    }

    it("passes for a single live generation", async () => {
      await seed(LIVE_SOURCE, 2026, AUGUST, "live");
      await expect(assertSingleGeneration(db, { season: 2026, source: LIVE_SOURCE, asOf: FINAL })).resolves.toBeUndefined();
    });

    it("THROWS when two live generations coexist under one source — the retire that did not run", async () => {
      await seed(LIVE_SOURCE, 2026, AUGUST, "live");
      await seed(LIVE_SOURCE, 2026, A_WEEK_LATER, "live");
      await expect(assertSingleGeneration(db, { season: 2026, source: LIVE_SOURCE, asOf: FINAL })).rejects.toThrow(
        /2 distinct as_of generations/,
      );
    });

    it("names the source and season in the thrown message, so an operator sees which board broke", async () => {
      await seed(LIVE_SOURCE, 2026, AUGUST, "live");
      await seed(LIVE_SOURCE, 2026, A_WEEK_LATER, "live");
      await expect(assertSingleGeneration(db, { season: 2026, source: LIVE_SOURCE, asOf: FINAL })).rejects.toThrow(
        new RegExp(`${LIVE_SOURCE} for season 2026`),
      );
    });

    it("passes a REPLAY season with its one deterministic as_of per source", async () => {
      // Every row an archived board's single persist writes shares one derived `as_of`, exactly as
      // `store()`'s own helper above writes archive fixtures throughout this file.
      await seed(REPLAY_SOURCE, 2024, AUGUST, "replay");
      await expect(assertSingleGeneration(db, { season: 2024, source: REPLAY_SOURCE, asOf: FINAL })).resolves.toBeUndefined();
    });

    it("a bound BEFORE the second generation still sees only the first, and passes", async () => {
      await seed(LIVE_SOURCE, 2026, AUGUST, "live");
      await seed(LIVE_SOURCE, 2026, A_WEEK_LATER, "live");
      await expect(assertSingleGeneration(db, { season: 2026, source: LIVE_SOURCE, asOf: AUGUST })).resolves.toBeUndefined();
    });

    it("is silent when the source has no rows at all — an unpersisted board is a caller's own concern", async () => {
      await expect(assertSingleGeneration(db, { season: 2026, source: LIVE_SOURCE, asOf: FINAL })).resolves.toBeUndefined();
    });
  });
});
