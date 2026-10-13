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
  /**
   * THE HEAD COACH FOR THIS TEAM-SEASON (fact-sheet depth round, 2026-09-07), which the table did
   * not carry: `role` only ever said whether the man NAMED here was the head coach or the
   * coordinator, so a season whose coordinator called the plays left the head coach unnamed.
   *
   * `""` WHERE THE COLUMN IS UNFILLED, and that is an absence rather than a defect. Filling
   * twenty-seven seasons of head coaches from memory would be typing unverifiable claims under a
   * `source` column that exists precisely to make each row's claim checkable, so the column is
   * filled only for the seasons somebody actually sourced it for, `validatePlayCallers` is told
   * which those are, and every other row stays honestly blank.
   */
  readonly headCoach: string;
  /** His FIRST season with this team, from the same source. `null` where unfilled. This is what
   *  makes "new this year" a sourced fact rather than a diff of two curated rows, which would read
   *  "new" whenever the prior season's row simply had not been filled in. */
  readonly headCoachFirstSeason: number | null;
}

const COLUMNS = ["season", "team", "name", "role", "start_week", "end_week", "source", "note"] as const;

/** The two columns the head-coach pass added. Optional as a PAIR: a row carries both or neither,
 *  because a name with no first season cannot answer "is he new" and a first season with no name
 *  is not a claim about anybody. */
const HEAD_COACH_COLUMNS = ["head_coach", "head_coach_first_season"] as const;
const WITH_HEAD_COACH = COLUMNS.length + HEAD_COACH_COLUMNS.length;
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
  // A CRLF-saved CSV (the common case for a file edited on Windows or exported from Excel) would
  // otherwise leave a trailing "\r" on every field but the last, corrupting `note` — the only column
  // free-text enough for the mangling to hide silently instead of tripping the column-count check.
  const lines = csv.split(/\r?\n/);
  const rows: PlayCallerRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const lineNumber = i + 1;
    const fields = raw.split(",");
    if (fields.length !== COLUMNS.length && fields.length !== WITH_HEAD_COACH) {
      fail(lineNumber, `expected ${COLUMNS.length} or ${WITH_HEAD_COACH} columns (${[...COLUMNS, ...HEAD_COACH_COLUMNS].join(",")}), got ${fields.length}.`);
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
    const headCoach = (fields[8] ?? "").trim();
    const firstSeasonRaw = (fields[9] ?? "").trim();
    if ((headCoach === "") !== (firstSeasonRaw === "")) {
      fail(lineNumber, "head_coach and head_coach_first_season must be filled together or left blank together.");
    }
    const headCoachFirstSeason = firstSeasonRaw === "" ? null : Number(firstSeasonRaw);
    if (headCoachFirstSeason !== null && (!Number.isFinite(headCoachFirstSeason) || !Number.isInteger(headCoachFirstSeason))) {
      fail(lineNumber, `head_coach_first_season must be an integer season (got ${JSON.stringify(firstSeasonRaw)}).`);
    }

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
      headCoach,
      headCoachFirstSeason,
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
/**
 * `headCoachSeasons`, OPTIONAL: the seasons whose `head_coach` column somebody has actually
 * sourced, and which must therefore be complete. Every team in one of those seasons must name a
 * head coach and his first season, and they must agree across that team-season's own rows. Every
 * season NOT in the list is left alone entirely, because a blank there is a documented absence
 * rather than a gap to be filled from memory (see `PlayCallerRow.headCoach`'s own docblock).
 */
export function validatePlayCallers(
  rows: readonly PlayCallerRow[],
  seasons: readonly number[],
  teamsBySeason: (season: number) => readonly string[],
  finalWeekOf: (season: number) => number,
  headCoachSeasons: readonly number[] = [],
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

  problems.push(...headCoachProblems(rows, headCoachSeasons, teamsBySeason));
  return problems;
}

/** The head-coach column's own completeness check, over exactly the seasons it is claimed for. */
function headCoachProblems(
  rows: readonly PlayCallerRow[],
  headCoachSeasons: readonly number[],
  teamsBySeason: (season: number) => readonly string[],
): readonly string[] {
  const problems: string[] = [];
  for (const season of headCoachSeasons) {
    for (const team of teamsBySeason(season)) {
      const named = rowsFor(rows, season, team).filter((row) => row.headCoach !== "");
      if (named.length === 0) {
        problems.push(`${team} ${season}: empty head_coach.`);
        continue;
      }
      const distinct = new Set(named.map((row) => `${row.headCoach}|${row.headCoachFirstSeason ?? ""}`));
      if (distinct.size > 1) {
        problems.push(`${team} ${season}: rows disagree about the head coach (${[...distinct].join(" and ")}).`);
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

/** One team-season's head coach and his first season with that team, or `null` where the column is
 *  unfilled. Season-keyed rather than week-keyed: the column names the man who held the job that
 *  year, and the table carries no in-season head-coach change. */
export interface HeadCoachTenure {
  readonly name: string;
  readonly firstSeason: number | null;
}

/** Builds a team-season head-coach lookup over the same flat `team|season` key `playCallerLookup`
 *  uses, for the same "this table is small enough that a flat map beats a nested one" reason. */
export function headCoachLookup(rows: readonly PlayCallerRow[]): (team: string, season: number) => HeadCoachTenure | null {
  const byTeamSeason = new Map<string, HeadCoachTenure>();
  for (const row of rows) {
    if (row.headCoach === "") continue;
    byTeamSeason.set(`${row.team}|${row.season}`, { name: row.headCoach, firstSeason: row.headCoachFirstSeason });
  }
  return (team, season) => byTeamSeason.get(`${team}|${season}`) ?? null;
}
