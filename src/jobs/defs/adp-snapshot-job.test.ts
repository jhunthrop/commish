import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { adpSnapshots, nflPlayers, preseasonRosters } from "@/db/schema";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import type { FfcResponse } from "@/projections/preseason/publishers";
import * as ingestModule from "@/projections/market/adp-snapshot";
import { parseAdpSnapshotPayload, runAdpSnapshotStep } from "./adp-snapshot-job";

function fixtureFetch(body: FfcResponse): typeof globalThis.fetch {
  return (async () => ({ ok: true, json: async () => body }) as unknown as Response) as typeof globalThis.fetch;
}

const ROSTER_ASOF = new Date("2026-08-01T00:00:00.000Z");
const CLOCK = { now: () => "2026-09-01T00:00:00.000Z" };

describe("adp-snapshot job step", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures the feed and reports a real summary line, never a hand-typed sentence", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);
    vi.spyOn(ingestModule, "ingestAdpSnapshot").mockResolvedValue({ candidatesRead: 1, resolutionRate: 1, written: 1, byFormat: [{ format: "ppr", candidatesRead: 1, resolutionRate: 1, written: 1, error: null }] });

    const outcome = await runAdpSnapshotStep(db, CLOCK, {});
    expect(outcome.summary).toContain("1 published");
    expect(outcome.summary).toContain("1 rows written");
    expect(outcome.summary).toContain("landed ppr");
    expect(outcome.detail).toEqual(["ppr: 1 published, 1 written (100.0%)"]);
  });

  it("names a secondary format that failed in the summary and the detail, while the fire still succeeds (the scoring-formats round)", async () => {
    vi.spyOn(ingestModule, "ingestAdpSnapshot").mockResolvedValue({
      candidatesRead: 4,
      resolutionRate: 1,
      written: 4,
      byFormat: [
        { format: "ppr", candidatesRead: 2, resolutionRate: 1, written: 2, error: null },
        { format: "half", candidatesRead: 0, resolutionRate: null, written: 0, error: "HTTP 503" },
        { format: "std", candidatesRead: 2, resolutionRate: 1, written: 2, error: null },
      ],
    });
    const outcome = await runAdpSnapshotStep(db, CLOCK, {});
    expect(outcome.summary).toContain("landed ppr, std, failed half");
    expect(outcome.detail).toContain("half: FAILED (HTTP 503)");
  });

  it("reports a zero-written night in the detail line, honestly, rather than hiding it", async () => {
    vi.spyOn(ingestModule, "ingestAdpSnapshot").mockResolvedValue({ candidatesRead: 5, resolutionRate: 0, written: 0, byFormat: [{ format: "ppr", candidatesRead: 5, resolutionRate: 0, written: 0, error: null }] });
    const outcome = await runAdpSnapshotStep(db, CLOCK, {});
    expect(outcome.detail).toEqual(["ppr: 5 published, 0 written (0.0%)", "no rows written this capture (resolution 0.0%)"]);
  });

  it("reports n/a resolution for an empty board rather than dividing by zero", async () => {
    vi.spyOn(ingestModule, "ingestAdpSnapshot").mockResolvedValue({ candidatesRead: 0, resolutionRate: null, written: 0, byFormat: [] });
    const outcome = await runAdpSnapshotStep(db, CLOCK, {});
    expect(outcome.summary).toContain("n/a");
  });

  it("fix round 1, MEDIUM 2: derives capturedAt from the schedule's own firedAt, never the wall clock, when present", async () => {
    const spy = vi.spyOn(ingestModule, "ingestAdpSnapshot").mockResolvedValue({ candidatesRead: 1, resolutionRate: 1, written: 1, byFormat: [{ format: "ppr", candidatesRead: 1, resolutionRate: 1, written: 1, error: null }] });
    await runAdpSnapshotStep(db, CLOCK, { firedAt: "2026-09-02T03:00:00.000Z" });
    const passedNow = spy.mock.calls[0]![1]!.now!();
    expect(passedNow.toISOString()).toBe("2026-09-02T03:00:00.000Z");
  });

  it("falls back to the injected clock when no firedAt is present (a hand-enqueued run)", async () => {
    const spy = vi.spyOn(ingestModule, "ingestAdpSnapshot").mockResolvedValue({ candidatesRead: 1, resolutionRate: 1, written: 1, byFormat: [{ format: "ppr", candidatesRead: 1, resolutionRate: 1, written: 1, error: null }] });
    await runAdpSnapshotStep(db, CLOCK, {});
    const passedNow = spy.mock.calls[0]![1]!.now!();
    expect(passedNow.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("a same-night rerun of the identical schedule fire writes no duplicate row, end to end", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);
    const fixture: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: 8.4 }] };
    vi.stubGlobal("fetch", fixtureFetch(fixture));

    const firedAt = { firedAt: "2026-09-02T03:00:00.000Z" };
    const first = await runAdpSnapshotStep(db, CLOCK, firedAt);
    // A crashed-and-redelivered attempt of the SAME schedule fire: identical payload, later
    // wall-clock instant (`CLOCK` here is unchanged, but a real retry would tick forward too —
    // `firedAt` is what must stay fixed, and it does).
    const second = await runAdpSnapshotStep(db, CLOCK, firedAt);

    // The same fixture body answers all three formats' fetches, so one fire writes one row per
    // format (the scoring-formats round) and the redelivered fire writes none of them again.
    expect(first.summary).toContain("3 rows written");
    expect(second.summary).toContain("0 rows written");
    expect(await db.select().from(adpSnapshots)).toHaveLength(3);
  });
});

describe("parseAdpSnapshotPayload", () => {
  it("accepts an empty payload", () => {
    expect(parseAdpSnapshotPayload({})).toEqual({});
  });

  it("accepts a well-formed firedAt", () => {
    expect(parseAdpSnapshotPayload({ firedAt: "2026-09-02T03:00:00.000Z" })).toEqual({ firedAt: "2026-09-02T03:00:00.000Z" });
  });

  it("rejects a malformed firedAt", () => {
    expect(() => parseAdpSnapshotPayload({ firedAt: "not-a-date" })).toThrow();
    expect(() => parseAdpSnapshotPayload({ firedAt: 5 })).toThrow();
  });
});
