import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readCoachRows } from "@research/coaches/store";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { FACT_SEASONS } from "@research/projections/nflverse/team-eras";
import { ingestPlayCallersCsv, PLAY_CALLERS_CSV_PATH } from "./lib/play-callers-csv";

/**
 * The file-to-table path, the way an operator runs it: the validator's checks run first and a
 * problem stops the write, a clean file lands every row, and a second run changes nothing but
 * the ingest stamp. The committed file itself is the last case, so the production step
 * (`npm run coaches:ingest`) is proven on the exact rows it will write.
 */
const db = createTestDb();

const HEADER = "season,team,name,role,start_week,end_week,source,note,head_coach,head_coach_first_season";
const TWO_CLUBS = { seasons: [2025, 2026], teamsBySeason: () => ["DET", "LA"], headCoachSeasons: [2026] } as const;

function fixture(lines: readonly string[]): string {
  const directory = mkdtempSync(join(tmpdir(), "coaches-ingest-"));
  const path = join(directory, "play-callers.csv");
  writeFileSync(path, [HEADER, ...lines].join("\n"));
  return path;
}

describe("ingestPlayCallersCsv", () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("validates, then lands every row, and a re-run is a no-op on the rows", async () => {
    const path = fixture([
      "2025,DET,Ben Johnson,OC,1,18,wikipedia,,,",
      "2025,LA,Sean McVay,HC,1,18,both,,,",
      "2026,DET,John Morton,OC,1,18,wikipedia,,Dan Campbell,2021",
      "2026,LA,Sean McVay,HC,1,18,wikipedia,,Sean McVay,2017",
    ]);
    const first = await ingestPlayCallersCsv(db, path, TWO_CLUBS);
    expect(first).toEqual({ rowsRead: 4, rowsWritten: 4 });
    expect(await ingestPlayCallersCsv(db, path, TWO_CLUBS)).toEqual(first);
    const rows = await readCoachRows(db);
    expect(rows).toHaveLength(4);
    expect(rows[2]).toMatchObject({ season: 2026, team: "DET", name: "John Morton", headCoach: "Dan Campbell", headCoachFirstSeason: 2021 });
    expect(rows[0]).toMatchObject({ season: 2025, team: "DET", headCoach: "", headCoachFirstSeason: null });
  });

  it("refuses a file the validator would refuse, naming the problem, and writes nothing", async () => {
    const path = fixture(["2025,DET,Ben Johnson,OC,1,9,wikipedia,,,", "2025,LA,Sean McVay,HC,1,18,both,,,"]);
    await expect(ingestPlayCallersCsv(db, path, { ...TWO_CLUBS, seasons: [2025], headCoachSeasons: [] })).rejects.toThrow(/DET 2025: gap in week coverage/);
    expect(await readCoachRows(db)).toEqual([]);
  });

  it("names the file rather than a bare ENOENT when it does not exist", async () => {
    await expect(ingestPlayCallersCsv(db, join(tmpdir(), "no-such-play-callers.csv"), TWO_CLUBS)).rejects.toThrow(/does not exist/);
  });

  it("lands the committed file under the real checks: every team-season 1999-2026", async () => {
    const report = await ingestPlayCallersCsv(db, PLAY_CALLERS_CSV_PATH);
    expect(report.rowsRead).toBeGreaterThan(900);
    expect(report.rowsWritten).toBe(report.rowsRead);
    const rows = await readCoachRows(db);
    expect(new Set(rows.map((row) => row.season))).toEqual(new Set(FACT_SEASONS));
    expect(rows.filter((row) => row.headCoach !== "").every((row) => row.season === 2026)).toBe(true);
  });
});
