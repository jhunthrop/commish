import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { recordTeamObservations, teamObservationsAsOf } from "@research-ts/projections/team-store";
import { parseWinTotalsCsv, VEGAS_METRICS, VEGAS_SOURCE, winTotalObservations } from "@research-ts/projections/vegas/ingest";
import { ingestWinTotalsCsv, readWinTotalsCsv } from "./win-totals-csv";

/**
 * The real file-to-store path, moved here from `src/projections/vegas/ingest.test.ts` when the
 * filesystem read left `src` (file-sourced data round, 2026-09-09). The write and its verification
 * are `writeVerifiedWinTotals`'s, unchanged; what this proves is the whole path an operator runs.
 */
const db = createTestDb();

const HEADER = "season,team,win_total,over_price,under_price,actual_wins,source,source_date";

describe("ingestWinTotalsCsv", () => {
  let dir: string;

  beforeEach(async () => {
    await truncateAll(db);
    dir = mkdtempSync(join(tmpdir(), "vegas-win-totals-"));
  });

  function writeCsv(rows: readonly string[]): string {
    const path = join(dir, "win-totals.csv");
    writeFileSync(path, `${HEADER}\n${rows.join("\n")}\n`, "utf8");
    return path;
  }

  it("writes 3 observations per row, and reports rows-read per season", async () => {
    const path = writeCsv([
      "2024,BUF,10.5,-115,-105,11,not_tracked,2024-08-30T00:00:00.000Z",
      "2024,NYJ,7,-110,-110,5,not_tracked,2024-08-30T00:00:00.000Z",
      "2023,BUF,9,-120,100,11,not_tracked,2023-08-30T00:00:00.000Z",
    ]);
    const report = await ingestWinTotalsCsv(db, path);
    expect(report.rowsRead).toBe(3);
    expect(report.observationsWritten).toBe(9);
    expect(report.seasons).toEqual([2023, 2024]);
    expect(report.rowsPerSeason.get(2024)).toBe(2);
    expect(report.rowsPerSeason.get(2023)).toBe(1);

    const stored = await teamObservationsAsOf(db, { season: 2024, week: 1, asOf: new Date(), source: VEGAS_SOURCE });
    expect(stored).toHaveLength(6);
  });

  it("a re-run is idempotent, writes nothing new, and does not throw the collision guard", async () => {
    const path = writeCsv(["2024,BUF,10.5,-115,-105,11,not_tracked,2024-08-30T00:00:00.000Z"]);
    await ingestWinTotalsCsv(db, path);
    const second = await ingestWinTotalsCsv(db, path);
    expect(second.observationsWritten).toBe(0);
  });

  /**
   * THE onConflictDoNothing SHADOWING HAZARD, PROVEN RATHER THAN ASSERTED (progress.md's documented
   * store debt). A row already sitting in the store under this ingest's own conflict key
   * (`season|week|team|source|metric|as_of`) but with a DIFFERENT value is exactly what a corrected
   * CSV re-ingested without a delete step would produce; `recordTeamObservations`'
   * `onConflictDoNothing` would keep the STALE value silently and report a plausible-looking
   * `observationsWritten`. The write's own read-back must catch that rather than trust the count.
   */
  it("throws, naming the mismatch, when a pre-existing row under the same key disagrees with the CSV", async () => {
    const path = writeCsv(["2024,BUF,10.5,-115,-105,11,not_tracked,2024-08-30T00:00:00.000Z"]);
    const observations = winTotalObservations(parseWinTotalsCsv(`${HEADER}\n2024,BUF,10.5,-115,-105,11,not_tracked,2024-08-30T00:00:00.000Z\n`));
    const stale = observations.find((o) => o.metric === VEGAS_METRICS.winTotal)!;
    await recordTeamObservations(db, [{ ...stale, value: 999 }]); // a stale value already occupying the key
    await expect(ingestWinTotalsCsv(db, path)).rejects.toThrow(/did not land as computed/);
  });

  it("names the file rather than a bare ENOENT when it does not exist", () => {
    expect(() => readWinTotalsCsv(join(tmpdir(), "no-such-win-totals.csv"))).toThrow(/does not exist/);
  });
});

afterAll(async () => {
  await truncateAll(db);
});
