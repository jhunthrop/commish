/**
 * THE PLAY-CALLER TABLE — sourced, hand-maintained, and week-accurate.
 *
 * `coaches.ts` derives the head coach from `games.csv` because a hand-typed table is a table of
 * unverifiable claims. This module is that table anyway, but built to the standard that makes a
 * hand-typed claim trustworthy: every row cites where it came from (`source`), and the parser and
 * validator together make a wrong or incomplete row loud rather than silent. A team-season with a
 * gap in its week coverage, an overlapping pair of ranges, or a coordinator entered with no name is
 * a row `validatePlayCallers` will name, not a row that quietly ships.
 *
 * The reason this table exists at all is the cost `coaches.ts` states plainly: a head coach who
 * keeps his job and swaps his coordinator is invisible to a head-coach-only table, and that is the
 * commonest kind of play-calling change there is. `role` distinguishes the two so a consumer can
 * prefer the OC's fingerprint over the HC's when both are on file for the same week.
 */

/** One person's tenure as a team's play-caller for a contiguous span of weeks in a season. */
export interface PlayCallerRow {
  readonly season: number;
  readonly team: string;
  readonly name: string;
  readonly role: "HC" | "OC";
  readonly startWeek: number;
  readonly endWeek: number;
  readonly source: "wikipedia" | "pfr" | "both";
  readonly note: string;
}

const COLUMNS = ["season", "team", "name", "role", "start_week", "end_week", "source", "note"] as const;
const ROLES: ReadonlySet<string> = new Set(["HC", "OC"]);
const SOURCES: ReadonlySet<string> = new Set(["wikipedia", "pfr", "both"]);

function fail(line: number, what: string): never {
  throw new Error(`play-callers.csv line ${line}: ${what}`);
}

function parseWeek(raw: string, line: number, column: string): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value) || !Number.isInteger(value)) {
    fail(line, `${column} must be an integer week (got ${JSON.stringify(raw)}).`);
  }
  return value;
}

/**
 * Parses the play-caller CSV into rows.
 *
 * Deliberately NOT the shared `parseCsv` reader: that reader honours RFC 4180 quoting for fields
 * that legitimately contain commas (headshot URLs), which this table never has. A plain split on
 * commas is simpler and matches the brief's own contract — no quoted commas are permitted, and a
 * `note` that needed one would be a `note` the validator should reject on other grounds anyway.
 */
export function parsePlayCallers(csv: string): readonly PlayCallerRow[] {
  const lines = csv.split("\n");
  const rows: PlayCallerRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const lineNumber = i + 1;
    const fields = raw.split(",");
    if (fields.length !== COLUMNS.length) {
      fail(lineNumber, `expected ${COLUMNS.length} columns (${COLUMNS.join(",")}), got ${fields.length}.`);
    }
    const [seasonRaw, team, name, role, startRaw, endRaw, source, note] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    const season = Number(seasonRaw);
    if (seasonRaw.trim() === "" || !Number.isFinite(season) || !Number.isInteger(season)) {
      fail(lineNumber, `season must be an integer (got ${JSON.stringify(seasonRaw)}).`);
    }
    if (!ROLES.has(role)) {
      fail(lineNumber, `role must be HC or OC (got ${JSON.stringify(role)}).`);
    }
    if (!SOURCES.has(source)) {
      fail(lineNumber, `source must be wikipedia, pfr, or both (got ${JSON.stringify(source)}).`);
    }
    const startWeek = parseWeek(startRaw, lineNumber, "start_week");
    const endWeek = parseWeek(endRaw, lineNumber, "end_week");

    rows.push({
      season,
      team,
      name,
      role: role as PlayCallerRow["role"],
      startWeek,
      endWeek,
      source: source as PlayCallerRow["source"],
      note,
    });
  }
  return rows;
}

/** Rows for one team-season, sorted by `startWeek`. */
function rowsFor(rows: readonly PlayCallerRow[], season: number, team: string): readonly PlayCallerRow[] {
  return rows.filter((r) => r.season === season && r.team === team).sort((a, b) => a.startWeek - b.startWeek);
}

/**
 * Checks that the table names a play-caller for every week of every requested team-season, with no
 * overlap and no gap.
 *
 * Returns human-readable problem strings — empty means valid — rather than throwing, because a real
 * import will usually have several unrelated problems (a missing team here, an overlap there) and a
 * maintainer fixing the CSV by hand wants the whole list at once, not one exception per run.
 */
export function validatePlayCallers(
  rows: readonly PlayCallerRow[],
  seasons: readonly number[],
  teamsBySeason: (season: number) => readonly string[],
  finalWeekOf: (season: number) => number,
): readonly string[] {
  const problems: string[] = [];

  for (const row of rows) {
    if (row.name.trim() === "") {
      problems.push(`${row.team} ${row.season}: empty name for weeks ${row.startWeek}-${row.endWeek}.`);
    }
    if (row.startWeek > row.endWeek) {
      problems.push(`${row.team} ${row.season}: start_week ${row.startWeek} is after end_week ${row.endWeek}.`);
    }
  }

  for (const season of seasons) {
    const finalWeek = finalWeekOf(season);
    for (const team of teamsBySeason(season)) {
      const teamRows = rowsFor(rows, season, team).filter((r) => r.startWeek <= r.endWeek);
      if (teamRows.length === 0) {
        problems.push(`${team} ${season}: no play-caller rows.`);
        continue;
      }

      let coveredThrough = 0; // last week confirmed covered, exclusive of gaps
      for (const r of teamRows) {
        if (r.startWeek > coveredThrough + 1) {
          problems.push(`${team} ${season}: gap in week coverage between ${coveredThrough} and ${r.startWeek}.`);
        } else if (r.startWeek <= coveredThrough) {
          problems.push(`${team} ${season}: overlapping week ranges around week ${r.startWeek}.`);
        }
        if (r.endWeek > coveredThrough) coveredThrough = r.endWeek;
      }
      if (coveredThrough < finalWeek) {
        problems.push(`${team} ${season}: gap in week coverage between ${coveredThrough} and ${finalWeek}.`);
      }
    }
  }

  return problems;
}

/**
 * Builds a week-accurate play-caller lookup.
 *
 * Keyed `team|season` rather than nested maps: this table is 32 teams by up to 27 seasons, so a
 * linear scan within one team-season's handful of rows costs nothing, and a flat map avoids a
 * three-level nested structure for data this small.
 */
export function playCallerLookup(
  rows: readonly PlayCallerRow[],
): (team: string, season: number, week: number) => string | null {
  const byTeamSeason = new Map<string, readonly PlayCallerRow[]>();
  for (const row of rows) {
    const key = `${row.team}|${row.season}`;
    const existing = byTeamSeason.get(key);
    byTeamSeason.set(key, existing === undefined ? [row] : [...existing, row]);
  }

  return (team, season, week) => {
    const key = `${team}|${season}`;
    const teamRows = byTeamSeason.get(key);
    if (teamRows === undefined) return null;
    const match = teamRows.find((r) => r.startWeek <= week && week <= r.endWeek);
    return match?.name ?? null;
  };
}
