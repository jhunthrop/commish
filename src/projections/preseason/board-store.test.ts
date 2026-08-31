import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { recordNflPlayers } from "../universe";
import type { NflPlayerRow } from "../nflverse/players";
import type { BoardEntry, BoardReason } from "./board";
import {
  BOARD_SOURCE,
  boardReasons,
  preseasonProjectionsAsOf,
  preseasonProjectionsFor,
  projectionRows,
  reasonRows,
  recordPreseasonBoardReasons,
  recordPreseasonProjections,
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
  return recordPreseasonProjections(db, projectionRows(board, { season: 2024, source: BOARD_SOURCE, asOf }));
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
    });
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

    it("round-trips every reason on a board, typed", async () => {
      await storeReasons([entry({ reasons: [AVAILABILITY, LAW] })], AUGUST);
      const byPlayer = await boardReasons(db, BOARD_SOURCE, 2024);
      const stored = [...(byPlayer.get(CHASE) ?? [])].sort((a, b) => a.code.localeCompare(b.code));
      expect(stored).toEqual([AVAILABILITY, LAW]);
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
        { season: 2024, source: BOARD_SOURCE, playerId: CHASE, code: "retired_variant", payload: { anything: true } },
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
});
