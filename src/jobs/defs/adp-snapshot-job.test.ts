import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers, preseasonRosters } from "@/db/schema";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import * as ingestModule from "@/projections/market/adp-snapshot";
import { runAdpSnapshotStep } from "./adp-snapshot-job";

const ROSTER_ASOF = new Date("2026-08-01T00:00:00.000Z");

describe("adp-snapshot job step", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("captures the feed and reports a real summary line, never a hand-typed sentence", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);
    vi.spyOn(ingestModule, "ingestAdpSnapshot").mockResolvedValue({ candidatesRead: 1, resolutionRate: 1, written: 1 });

    const outcome = await runAdpSnapshotStep(db, { now: () => "2026-09-01T00:00:00.000Z" });
    expect(outcome.summary).toContain("1 published");
    expect(outcome.summary).toContain("1 rows written");
    expect(outcome.detail).toEqual([]);
  });

  it("reports a zero-written night in the detail line, honestly, rather than hiding it", async () => {
    vi.spyOn(ingestModule, "ingestAdpSnapshot").mockResolvedValue({ candidatesRead: 5, resolutionRate: 0, written: 0 });
    const outcome = await runAdpSnapshotStep(db, { now: () => "2026-09-01T00:00:00.000Z" });
    expect(outcome.detail).toEqual(["no rows written this capture (resolution 0.0%)"]);
  });

  it("reports n/a resolution for an empty board rather than dividing by zero", async () => {
    vi.spyOn(ingestModule, "ingestAdpSnapshot").mockResolvedValue({ candidatesRead: 0, resolutionRate: null, written: 0 });
    const outcome = await runAdpSnapshotStep(db, { now: () => "2026-09-01T00:00:00.000Z" });
    expect(outcome.summary).toContain("n/a");
  });
});
