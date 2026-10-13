import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { adpSnapshots, nflPlayers } from "@research-ts/db/schema";
import { BENCHMARK_SOURCES } from "@research-ts/projections/preseason/benchmarks";
import { adpHistoryFor } from "./depth-reads";
import { marketMovementFor } from "./market-movement";

/**
 * NOTHING ON A REQUEST PATH READS THE FILESYSTEM (coaches-table round, 2026-09-08). The depth
 * reads run inside the team page and the capsule sweep the job tick runs, both serverless, and
 * a serverless bundle carries traced modules rather than data files: the play-caller CSV read
 * that used to live here threw ENOENT in production. The table replaced it; this pins the
 * module to the store so the read cannot quietly come back.
 */
describe("depth-reads", () => {
  it("imports nothing from node:fs", () => {
    // Vitest runs from the repo root, the same root every `data/...` path in this repo assumes.
    const source = readFileSync("research-ts/src/capsules/facts/depth-reads.ts", "utf8");
    expect(source).not.toMatch(/from "node:fs"|from "fs"|require\("fs"\)/);
    expect(source).not.toMatch(/readFileSync|statSync/);
  });
});

/**
 * THE MOVEMENT LINE IS A PPR FACT (the scoring-formats round, 2026-09-08). The nightly capture
 * writes three formats a fire, each under its own source; the fact sheet is PPR and its movement
 * must compare PPR captures with PPR captures, never a standard-scoring row against a PPR one.
 */
describe("adpHistoryFor", () => {
  let db: Db;
  const PLAYER = "00-0099001";
  const DAY_ONE = new Date("2026-09-01T03:00:00.000Z");
  const DAY_TWO = new Date("2026-09-02T03:00:00.000Z");

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(nflPlayers).values({ id: PLAYER, name: "Three Formats", position: "WR" });
    await db.insert(adpSnapshots).values([
      { playerId: PLAYER, source: BENCHMARK_SOURCES.adp, format: "ppr_12", adp: 10.0, capturedAt: DAY_ONE },
      { playerId: PLAYER, source: BENCHMARK_SOURCES.adpHalf, format: "half_12", adp: 14.0, capturedAt: DAY_ONE },
      { playerId: PLAYER, source: BENCHMARK_SOURCES.adpStd, format: "std_12", adp: 22.0, capturedAt: DAY_ONE },
      { playerId: PLAYER, source: BENCHMARK_SOURCES.adp, format: "ppr_12", adp: 8.0, capturedAt: DAY_TWO },
      { playerId: PLAYER, source: BENCHMARK_SOURCES.adpHalf, format: "half_12", adp: 12.0, capturedAt: DAY_TWO },
      { playerId: PLAYER, source: BENCHMARK_SOURCES.adpStd, format: "std_12", adp: 20.0, capturedAt: DAY_TWO },
    ]);
  });

  it("returns only the PPR captures when three formats were captured the same nights", async () => {
    const history = await adpHistoryFor(db, [PLAYER], new Date("2026-08-01T00:00:00.000Z"));
    expect(history.get(PLAYER)?.map((capture) => capture.adp).sort((a, b) => a - b)).toEqual([8.0, 10.0]);
  });

  it("feeds the movement line PPR rows alone, so a two-pick PPR rise reads as two picks, not a cross-format swing", async () => {
    const history = await adpHistoryFor(db, [PLAYER], new Date("2026-08-01T00:00:00.000Z"));
    const movement = marketMovementFor(history.get(PLAYER) ?? []);
    expect(movement).toEqual({ latestAdp: 8.0, latestAt: "2026-09-02", earlierAdp: 10.0, earlierAt: "2026-09-01", picks: 2 });
  });

  it("honours `since` and answers an empty map for no players", async () => {
    expect(await adpHistoryFor(db, [], new Date("2026-08-01T00:00:00.000Z"))).toEqual(new Map());
    const recent = await adpHistoryFor(db, [PLAYER], DAY_TWO);
    expect(recent.get(PLAYER)?.map((capture) => capture.adp)).toEqual([8.0]);
  });
});
