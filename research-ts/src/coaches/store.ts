import { asc } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@research-ts/db/client";
import { coaches } from "@research-ts/db/schema";
import { excludedSetFor } from "@research-ts/db/upsert";
import { BOARD_MEMO_GROUP, createTtlMemo } from "@research-ts/lib/cache/ttl-memo";
import type { PlayCallerRow } from "@research-ts/projections/nflverse/play-callers";
import { BOARD_REASONS_MEMO_TTL_MS } from "@research-ts/projections/preseason/reasons-by-player";

/**
 * THE COACHES REPOSITORY (coaches-table round, 2026-09-08): the one place the server reads the
 * curated play-caller table from, and the one place the ingest writes it.
 *
 * WHY A TABLE AND NOT THE FILE. `data/play-callers/play-callers.csv` is the reviewed source of
 * truth and stays in the repo, but a serverless bundle carries traced modules, not data files,
 * and a request-path `readFileSync` of it threw ENOENT in production (team page and capsule
 * sweep, 2026-09-08). `npm run coaches:ingest` validates the file and upserts it here; every
 * request-time reader takes `coachRows` and never touches the filesystem.
 *
 * THE SHAPE IS THE CSV'S OWN. Readers already consume `PlayCallerRow` (`playCallerLookup`,
 * `headCoachLookup`, `coachingFor`), whose `headCoach` is `""` where the file is blank, so the
 * table's NULL pair is folded back to that contract here rather than teaching every reader a
 * second spelling of "unsourced".
 *
 * MEMOIZED PER INSTANCE at the board's cadence and in the board's group: the table changes only
 * when somebody re-ingests, so a warm instance reads it once an hour, and `writePreseasonBoard`'s
 * group clear (or `truncateAll` in a test) makes a fresh read visible immediately on this instance.
 */

const COACHES_MEMO_KEY = "coaches";
/** The natural key, as JS property names: what a re-ingest matches on. `id` is listed so the
 *  update never reassigns a stored row's serial. */
const TENURE_KEY = ["id", "season", "team", "role", "startWeek"] as const;

const memo = createTtlMemo<readonly PlayCallerRow[]>(BOARD_REASONS_MEMO_TTL_MS, undefined, { group: BOARD_MEMO_GROUP });

const ROLES: ReadonlySet<PlayCallerRow["role"]> = new Set(["HC", "OC"]);
const SOURCES: ReadonlySet<PlayCallerRow["source"]> = new Set(["wikipedia", "pfr", "both"]);

/** The table's check constraints guarantee these; a value outside them is a corrupted row, and
 *  a corrupted row should fail loudly rather than be served under a narrower type. */
function narrow<T extends string>(value: string, allowed: ReadonlySet<T>, column: string): T {
  if (!(allowed as ReadonlySet<string>).has(value)) throw new Error(`coaches.${column} holds ${JSON.stringify(value)}, which no reader understands.`);
  return value as T;
}

function toPlayCallerRow(row: typeof coaches.$inferSelect): PlayCallerRow {
  return {
    season: row.season,
    team: row.team,
    name: row.name,
    role: narrow(row.role, ROLES, "role"),
    startWeek: row.startWeek,
    endWeek: row.endWeek,
    source: narrow(row.source, SOURCES, "source"),
    note: row.note,
    headCoach: row.headCoach ?? "",
    headCoachFirstSeason: row.headCoachFirstSeason,
  };
}

function toInsertRow(row: PlayCallerRow): typeof coaches.$inferInsert {
  return {
    season: row.season,
    team: row.team,
    role: row.role,
    name: row.name,
    startWeek: row.startWeek,
    endWeek: row.endWeek,
    source: row.source,
    note: row.note,
    headCoach: row.headCoach === "" ? null : row.headCoach,
    headCoachFirstSeason: row.headCoach === "" ? null : row.headCoachFirstSeason,
  };
}

/** The whole table, unmemoized, in a stable order. Empty when nothing has been ingested, which
 *  every reader renders as absence. */
export async function readCoachRows(db: ReadonlyDb): Promise<readonly PlayCallerRow[]> {
  const rows = await db.select().from(coaches).orderBy(asc(coaches.season), asc(coaches.team), asc(coaches.startWeek), asc(coaches.role));
  return rows.map(toPlayCallerRow);
}

/** The whole table from memory after the first read on this instance. */
export function coachRows(db: ReadonlyDb): Promise<readonly PlayCallerRow[]> {
  return memo.get(COACHES_MEMO_KEY, () => readCoachRows(db));
}

/** Writes every row on its natural key, updating a tenure in place. Answers how many rows the
 *  statement touched, which for a valid batch is the batch's own size on every run. */
export async function upsertCoachRows(db: Db, rows: readonly PlayCallerRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const written = await db
    .insert(coaches)
    .values(rows.map(toInsertRow))
    .onConflictDoUpdate({ target: [coaches.season, coaches.team, coaches.role, coaches.startWeek], set: excludedSetFor(coaches, TENURE_KEY) })
    .returning({ id: coaches.id });
  return written.length;
}
