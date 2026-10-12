import { and, asc, desc, eq } from "drizzle-orm";
import type { Db, DbTx, ReadonlyDb } from "@/db/client";
import { registerFreezeRows, registerGradeRows } from "@/db/schema";
import type { JsonObject } from "@/domain/json";
import { PPR_SCORING } from "@/domain/scoring";
import type { ScoringRules } from "@/scoring/compute";

/**
 * THE PROSPECTIVE REGISTER'S TYPESCRIPT SEAM — rows in, rows out, and nothing else.
 *
 * See `register_freeze_rows` and `register_grade_rows` in `@/db/schema` for the discipline this
 * module enforces at the writer. The short version, because it is the whole design: THERE IS NO
 * UPDATE AND NO DELETE IN THIS FILE, and there is no `onConflictDoNothing` either. Every other
 * point-in-time writer in this engine takes a conflict as "already landed, nothing to do"; here a
 * conflict means two different answers are being claimed for one player at one instant, which is a
 * caller bug, and the honest thing is to let Postgres refuse it.
 *
 * THE REGISTER IS A ONE-WAY VALVE (see `wall.source.test.ts`). This module imports the schema and
 * the scoring rules and nothing else from the engine; `freeze.ts` and `grade.ts` above it do the
 * reading. Nothing in `market/`, `laws/`, `model/`, `preseason/`, `nflverse/` or `odds/` may import
 * anything from this directory, ever, and a structural test asserts it.
 */

/**
 * THE REGISTER'S OWN SCORING RULES — twelve-team PPR, matching the format every source in
 * `register/sources.ts` names in its own value (`..._ppr_12`), served and shadow alike.
 *
 * Named here rather than passed in by each caller, because the four columns are only comparable to
 * each other if all four are priced by the SAME rules: the board's points were composed under PPR,
 * a prop line's receptions are worth a point each only under PPR, and a week's actual outcome has
 * to be scored the same way both of them were projected. A caller free to hand in a different sheet
 * could produce a scoreboard where the board and its benchmarks were measured in different units
 * and nothing would say so.
 */
export const REGISTER_SCORING: ScoringRules = PPR_SCORING;

/** The four opinions the register keeps, in the order every report prints them. */
export const REGISTER_COLUMNS = ["board", "adp", "ecr", "props"] as const;
export type RegisterColumn = (typeof REGISTER_COLUMNS)[number];

/** One player's four stances on one week, as they stood at one freeze instant. */
export interface RegisterFreezeRow {
  readonly season: number;
  readonly week: number;
  readonly frozenAt: Date;
  readonly playerId: string;
  readonly boardSource: string;
  readonly boardAsOf: Date;
  readonly boardPoints: number;
  readonly boardRank: number;
  readonly boardValueRank: number;
  /** Tri-state benchmark: a number where the source had an opinion, `null` where it had none.
   *  Never zero — see the table's own docblock. */
  readonly adpRank: number | null;
  readonly ecrRank: number | null;
  readonly propsPoints: number | null;
  /** The median line per market behind `propsPoints`. `null` exactly when `propsPoints` is. */
  readonly propsMarkets: JsonObject | null;
}

/** One player's outcome for one week, and where each column had placed him — for ONE of the boards
 *  the freeze recorded. */
export interface RegisterGradeRow {
  readonly season: number;
  readonly week: number;
  readonly frozenAt: Date;
  readonly gradedAt: Date;
  /** The `RegisterFreezeRow.boardSource` these ranks were computed from. */
  readonly boardSource: string;
  readonly playerId: string;
  readonly actualPoints: number;
  readonly actualRank: number;
  readonly boardRank: number;
  readonly adpRank: number | null;
  readonly ecrRank: number | null;
  readonly propsRank: number | null;
}

/** Which freeze a reader means. All three fields, always — a week alone is ambiguous the moment a
 *  week has been frozen twice, which is the normal case rather than the exception. */
export interface FreezeKey {
  readonly season: number;
  readonly week: number;
  readonly frozenAt: Date;
}

/** Matches every other writer in this store, and for the same Postgres bind-parameter ceiling. */
const INSERT_CHUNK_ROWS = 2_000;

const FREEZE_COLUMNS = {
  season: registerFreezeRows.season,
  week: registerFreezeRows.week,
  frozenAt: registerFreezeRows.frozenAt,
  playerId: registerFreezeRows.playerId,
  boardSource: registerFreezeRows.boardSource,
  boardAsOf: registerFreezeRows.boardAsOf,
  boardPoints: registerFreezeRows.boardPoints,
  boardRank: registerFreezeRows.boardRank,
  boardValueRank: registerFreezeRows.boardValueRank,
  adpRank: registerFreezeRows.adpRank,
  ecrRank: registerFreezeRows.ecrRank,
  propsPoints: registerFreezeRows.propsPoints,
  propsMarkets: registerFreezeRows.propsMarkets,
} as const;

const GRADE_COLUMNS = {
  season: registerGradeRows.season,
  week: registerGradeRows.week,
  frozenAt: registerGradeRows.frozenAt,
  gradedAt: registerGradeRows.gradedAt,
  boardSource: registerGradeRows.boardSource,
  playerId: registerGradeRows.playerId,
  actualPoints: registerGradeRows.actualPoints,
  actualRank: registerGradeRows.actualRank,
  boardRank: registerGradeRows.boardRank,
  adpRank: registerGradeRows.adpRank,
  ecrRank: registerGradeRows.ecrRank,
  propsRank: registerGradeRows.propsRank,
} as const;

/**
 * Writes one freeze's rows. A PLAIN INSERT — no conflict clause of any kind.
 *
 * `onConflictDoNothing` would be wrong here, not merely unnecessary. A conflict on
 * `(season, week, frozen_at, player_id)` means this call is claiming a SECOND, possibly different,
 * board stance for a player at an instant the register already has an answer for, and "keep the
 * first one silently" is exactly how an archive stops being one. The freeze path builds its instant
 * from the injected clock, so a genuine re-freeze always carries a new instant and never reaches
 * this at all.
 *
 * Takes a `DbTx` as well as a `Db` so `takeFreeze` can write every chunk inside one transaction: a
 * freeze that landed for the first two thousand players and then failed would be a partial claim,
 * indistinguishable at the reader from a board that only ranked two thousand people.
 */
export async function recordFreezeRows(db: Db | DbTx, rows: readonly RegisterFreezeRow[]): Promise<number> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    await db.insert(registerFreezeRows).values(rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row })));
  }
  return rows.length;
}

/** Writes one grading's rows. A plain insert, for the identical reason `recordFreezeRows` is. */
export async function recordGradeRows(db: Db | DbTx, rows: readonly RegisterGradeRow[]): Promise<number> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    await db.insert(registerGradeRows).values(rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row })));
  }
  return rows.length;
}

/**
 * One exact freeze, in (board source, player id) order so anything computed from it is reproducible
 * run to run.
 *
 * `boardSource` narrows to ONE board's claim; omitting it returns every board the instant recorded,
 * which is what a caller counting "how big was this freeze" wants and what a caller GRADING a board
 * must not have. Deliberately not defaulted to the served source: a reader that means one board has
 * to say which, because "the served board" is a moving target across seasons and a stored freeze
 * belongs to whichever board was served when it was taken.
 */
export async function freezeRowsAt(
  db: ReadonlyDb,
  { season, week, frozenAt }: FreezeKey,
  boardSource?: string,
): Promise<readonly RegisterFreezeRow[]> {
  return db
    .select(FREEZE_COLUMNS)
    .from(registerFreezeRows)
    .where(
      and(
        eq(registerFreezeRows.season, season),
        eq(registerFreezeRows.week, week),
        eq(registerFreezeRows.frozenAt, frozenAt),
        ...(boardSource === undefined ? [] : [eq(registerFreezeRows.boardSource, boardSource)]),
      ),
    )
    .orderBy(asc(registerFreezeRows.boardSource), asc(registerFreezeRows.playerId));
}

/**
 * Which boards one exact freeze recorded, in the order they were written.
 *
 * Read from the ROWS rather than assumed from `register/sources.ts`: grading has to score what a
 * freeze actually holds, and a freeze taken before a source list changed holds what the list said
 * then. A tracked board missing from this is a real fact about that week, not a lookup miss.
 */
export async function freezeBoardSourcesAt(db: ReadonlyDb, { season, week, frozenAt }: FreezeKey): Promise<readonly string[]> {
  const rows = await db
    .select({ boardSource: registerFreezeRows.boardSource })
    .from(registerFreezeRows)
    .where(
      and(
        eq(registerFreezeRows.season, season),
        eq(registerFreezeRows.week, week),
        eq(registerFreezeRows.frozenAt, frozenAt),
      ),
    )
    .groupBy(registerFreezeRows.boardSource)
    .orderBy(asc(registerFreezeRows.boardSource));
  return rows.map((row) => row.boardSource);
}

/**
 * Every freeze instant the register holds for one week, earliest first.
 *
 * The whole list, never just the latest: a week frozen three times is three separate claims, and an
 * operator asking "what did we say, and when did we change our minds" is asking for all of them.
 */
export async function freezeInstantsFor(db: ReadonlyDb, season: number, week: number): Promise<readonly Date[]> {
  const rows = await db
    .select({ frozenAt: registerFreezeRows.frozenAt })
    .from(registerFreezeRows)
    .where(and(eq(registerFreezeRows.season, season), eq(registerFreezeRows.week, week)))
    .groupBy(registerFreezeRows.frozenAt)
    .orderBy(asc(registerFreezeRows.frozenAt));
  return rows.map((row) => row.frozenAt);
}

/**
 * The LAST claim made before this week kicked off, or `null` if the week was never frozen.
 *
 * This is the one grading reaches for, and the choice is deliberate: the latest pre-kickoff freeze
 * is the claim that was actually standing when the games started, so it is the one the week is
 * entitled to answer. The earlier ones remain in the store and remain gradable by explicit instant;
 * they are simply not what "how did we do in week 3" means.
 */
export async function latestFreezeFor(db: ReadonlyDb, season: number, week: number): Promise<Date | null> {
  const [row] = await db
    .select({ frozenAt: registerFreezeRows.frozenAt })
    .from(registerFreezeRows)
    .where(and(eq(registerFreezeRows.season, season), eq(registerFreezeRows.week, week)))
    .orderBy(desc(registerFreezeRows.frozenAt))
    .limit(1);
  return row?.frozenAt ?? null;
}

/** Every week the register holds at least one freeze for, ascending. */
export async function frozenWeeksFor(db: ReadonlyDb, season: number): Promise<readonly number[]> {
  const rows = await db
    .select({ week: registerFreezeRows.week })
    .from(registerFreezeRows)
    .where(eq(registerFreezeRows.season, season))
    .groupBy(registerFreezeRows.week)
    .orderBy(asc(registerFreezeRows.week));
  return rows.map((row) => row.week);
}

/**
 * Every graded row a season holds, in (week, gradedAt, playerId) order.
 *
 * Deliberately the WHOLE history rather than the latest grading per week — deciding which grading
 * counts is `grade.ts`'s job (`runningScoreboard` keeps the latest per week), and a reader that
 * wanted to compare a pre-correction grading against a post-correction one would be badly served by
 * a store that had already thrown one of them away.
 */
export async function gradeRowsFor(db: ReadonlyDb, season: number): Promise<readonly RegisterGradeRow[]> {
  return db
    .select(GRADE_COLUMNS)
    .from(registerGradeRows)
    .where(eq(registerGradeRows.season, season))
    .orderBy(
      asc(registerGradeRows.week),
      asc(registerGradeRows.gradedAt),
      asc(registerGradeRows.boardSource),
      asc(registerGradeRows.playerId),
    );
}
