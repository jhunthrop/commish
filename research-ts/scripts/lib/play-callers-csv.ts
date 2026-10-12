// The curated play-caller file as build tooling reads it: one loader, one set of checks, shared by
// the validator (`scripts/validate-play-callers.ts`) and the ingest (`scripts/coaches-ingest.ts`)
// so the file the ingest writes to the `coaches` table is exactly the file the validator passed.
//
// NOTHING UNDER `src/` IMPORTS THIS. The server reads the `coaches` table through
// `src/coaches/store.ts`; the filesystem read lives here, in tooling, where a serverless bundle
// never has to carry it (the 2026-09-08 ENOENT outage was a request-path read of this same file).
import { readFileSync } from "node:fs";
import { upsertCoachRows } from "@research-ts/coaches/store";
import type { Db } from "@research-ts/db/client";
import { parsePlayCallers, validatePlayCallers, type PlayCallerRow } from "@research-ts/projections/nflverse/play-callers";
import { FACT_SEASONS, finalWeekOf, nflTeamsBySeason } from "@research-ts/projections/nflverse/team-eras";

/** The committed file, relative to the repo root every npm script runs from. */
export const PLAY_CALLERS_CSV_PATH = "research-ts/data/play-callers/play-callers.csv";

/**
 * THE SEASONS WHOSE `head_coach` COLUMN IS CLAIMED COMPLETE (fact-sheet depth round, 2026-09-07).
 *
 * Only the product season is filled today, from a live Wikipedia fetch cited in each of those
 * rows' own `note`. The other twenty-seven seasons are honestly blank rather than typed from
 * memory, so they are deliberately NOT listed here: this constant is a claim about what has been
 * sourced, and widening it without doing the sourcing would turn the validator from a check into a
 * rubber stamp. Add a season here in the same commit that fills its rows.
 */
export const HEAD_COACH_SEASONS: readonly number[] = [2026];

/** What the checks cover. The committed file is checked against every fact season and every
 *  club of each; a fixture in a test narrows this to the clubs it bothers to name. */
export interface PlayCallerChecks {
  readonly seasons: readonly number[];
  readonly teamsBySeason: (season: number) => readonly string[];
  readonly headCoachSeasons: readonly number[];
}

export const COMMITTED_CHECKS: PlayCallerChecks = { seasons: FACT_SEASONS, teamsBySeason: nflTeamsBySeason, headCoachSeasons: HEAD_COACH_SEASONS };

/**
 * FAILS LOUDLY when the CSV does not exist, rather than treating an absent file as zero rows: a
 * missing file and an empty-but-present file are different claims. `readFileSync` already throws
 * for a missing path; this re-throws with the fact that matters to whoever is reading the console
 * output, which file and what to do about it, rather than a bare ENOENT with a stack trace.
 */
export function readPlayCallersCsv(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read play-callers: ${path} does not exist yet (${reason}).`);
  }
}

export interface LoadedPlayCallers {
  readonly rows: readonly PlayCallerRow[];
  /** Human-readable, empty when the file passes. */
  readonly problems: readonly string[];
}

/** Parses the file and runs every check over it. Parsing itself throws on a malformed line. */
export function loadPlayCallers(path: string, checks: PlayCallerChecks = COMMITTED_CHECKS): LoadedPlayCallers {
  const rows = parsePlayCallers(readPlayCallersCsv(path));
  const problems = validatePlayCallers(rows, checks.seasons, checks.teamsBySeason, finalWeekOf, checks.headCoachSeasons);
  return { rows, problems };
}

export interface PlayCallersIngestReport {
  readonly rowsRead: number;
  /** Rows the upsert touched: the batch's own size on every run of a valid file. */
  readonly rowsWritten: number;
}

/** The whole file-to-table path: read, check, and only then write. A file with problems writes
 *  nothing and throws with every problem listed, the way the validator prints them. */
export async function ingestPlayCallersCsv(db: Db, path: string = PLAY_CALLERS_CSV_PATH, checks: PlayCallerChecks = COMMITTED_CHECKS): Promise<PlayCallersIngestReport> {
  const { rows, problems } = loadPlayCallers(path, checks);
  if (problems.length > 0) {
    throw new Error(`${path} failed validation, nothing written:\n${problems.join("\n")}`);
  }
  const rowsWritten = await upsertCoachRows(db, rows);
  return { rowsRead: rows.length, rowsWritten };
}
