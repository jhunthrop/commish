// The curated win-totals file as build tooling reads it: one loader shared by the validator
// (`scripts/validate-win-totals.ts`) and the ingest (`scripts/vegas-win-totals-ingest.ts`), so the
// file the ingest writes to the team store is exactly the file the validator checked.
//
// NOTHING UNDER `src/` IMPORTS THIS (file-sourced data round, 2026-09-09). The parser and the
// verified writer live in `src/projections/vegas/ingest.ts`, which the request path imports for its
// source and metric names; the filesystem read lives here, in tooling, where a serverless bundle
// never has to carry it. The same split `scripts/lib/play-callers-csv.ts` makes for the coaches file.
import { readFileSync } from "node:fs";
import type { Db } from "@/db/client";
import { parseWinTotalsCsv, writeVerifiedWinTotals, type VegasIngestReport } from "@/projections/vegas/ingest";

/** The committed file, relative to the repo root every npm script runs from. */
export const WIN_TOTALS_CSV_PATH = "data/win-totals/win-totals.csv";

/**
 * FAILS LOUDLY when the CSV does not exist, rather than treating an absent file as zero rows: a
 * missing file and an empty-but-present file are different claims.
 */
export function readWinTotalsCsv(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read win totals: ${path} does not exist yet (${reason}).`);
  }
}

/** The whole file-to-store path: read, parse, write, and verify the write value by value. */
export function ingestWinTotalsCsv(db: Db, path: string = WIN_TOTALS_CSV_PATH): Promise<VegasIngestReport> {
  return writeVerifiedWinTotals(db, parseWinTotalsCsv(readWinTotalsCsv(path)));
}
