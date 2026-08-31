import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { preseasonBoardReasons, preseasonProjections } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import type { BoardEntry, BoardReason } from "./board";

/**
 * WHERE THE BOARD LANDS — the first writer in this repository that stores a number the model
 * produced rather than one somebody else published.
 *
 * `preseasonBoard` has been a pure function whose only callers print to a research document, and
 * that was right while the open question was whether it was any good. The answer is now yes
 * (`docs/research/2026-08-28-starter-band.md`), and a rank correlation over a held-out season is a
 * fact about the BOARD: a manager looking at one receiver needs a fact about that receiver, and
 * nothing could give him one because the board did not survive the process that computed it.
 *
 * SEPARATE FROM `store.ts` NEXT DOOR, which holds the two things other people published about a
 * preseason. This holds the one thing we say about it. They share a shape on purpose — the source
 * strip on a player's screen sets all three beside each other and a different shape would have made
 * that comparison a translation — but they have opposite provenance, and a module that wrote both
 * would be one edit away from a benchmark being fed back in as a feature, which the engine spec
 * forbids outright.
 *
 * THE STAMP IS THE BOARD'S OWN MOMENT, never the time of the run. `loadPreseason` derives that
 * moment as one millisecond before the earliest thing the season would reveal and asserts the store
 * against it before returning; carrying it onto every row is what makes a stored projection a claim
 * anybody can check. Two leakage defects have been found in this engine, both silent, both caught
 * by audit; a row that could not say what it was allowed to see would make the third one unfindable.
 */

/**
 * Which board said it. Model version AND league format in one value, exactly as the benchmark
 * sources name market and format in one (`ffc_adp_ppr_12`), because a projected point total is
 * meaningless without the rules that composed it and a rank is meaningless without the roster
 * shape that valued it. A refit is a new value here, never an overwrite of rows a manager has
 * already been shown.
 */
export const BOARD_SOURCE = "commish_board_v1_ppr_12";

/** One player's place on one board, as it was taken at one moment. */
export interface PreseasonProjectionRow {
  readonly season: number;
  readonly source: string;
  /** An `nfl_players.id` — a gsis id. The product reaches it through `player_crosswalk`. */
  readonly playerId: string;
  readonly rank: number;
  readonly positionRank: number;
  readonly projectedPoints: number;
  readonly valueOverReplacement: number;
  readonly valueRank: number;
  readonly expectedGames: number;
  readonly floorPoints: number;
  readonly medianPoints: number;
  readonly ceilingPoints: number;
  readonly tier: number;
  readonly asOf: Date;
}

export interface BoardStamp {
  readonly season: number;
  readonly source: string;
  /** `PreseasonInputs.moment` and nothing else. See the module docblock. */
  readonly asOf: Date;
}

/**
 * A board turned into rows, with every number the entry carried and nothing derived here.
 *
 * `reasons` IS NOW STORED (Task 7, `reasonRows`/`preseasonBoardReasons` below) — the omission this
 * docblock used to state was deliberate and temporary, and Task 7 is that "temporary" arriving:
 * layer 7 says the diagnostic and the explanation are the same artifact, and a rank with no reason
 * beside it is half the product. `seasonLine` stays out; it is a fourteen-field line rather than a
 * short discriminated union, and no surface reads it yet — the same "store what a screen needs,
 * say what is missing" discipline, just not yet due for that field.
 */
export function projectionRows(board: readonly BoardEntry[], stamp: BoardStamp): readonly PreseasonProjectionRow[] {
  return board.map((entry) => ({
    season: stamp.season,
    source: stamp.source,
    playerId: entry.playerId,
    rank: entry.rank,
    positionRank: entry.positionRank,
    projectedPoints: entry.projectedPoints,
    valueOverReplacement: entry.valueOverReplacement,
    valueRank: entry.valueRank,
    expectedGames: entry.expectedGames,
    floorPoints: entry.outlook.floor,
    medianPoints: entry.outlook.median,
    ceilingPoints: entry.outlook.ceiling,
    tier: entry.tier,
    asOf: stamp.asOf,
  }));
}

/** One `BoardReason` turned into a row: `code` is the union's own tag, `payload` is every other
 *  field of that variant, verbatim — see `preseasonBoardReasons`'s own docblock for why there is no
 *  `asOf` here, unlike `PreseasonProjectionRow`. */
export interface PreseasonBoardReasonRow {
  readonly season: number;
  readonly source: string;
  readonly playerId: string;
  readonly code: string;
  readonly payload: JsonObject;
}

/**
 * Every reason on a board, turned into rows — one row per `(player, reason)` pair, `code` and
 * `payload` split exactly as `preseasonBoardReasons` stores them.
 *
 * A KNOWN, ACCEPTED GAP: the table's PK is `(source, season, playerId, code)`, with no field naming
 * WHICH reason of a repeated code a row is. Every code today's board ever emits more than once for
 * the same player is `"law"` (`laws/board-reasons.ts`'s `lawReasonsFor` can return one reason per
 * CONFIRMED law, and a player can satisfy more than one law's condition at once) — `recordPreseason
 * BoardReasons`' `onConflictDoNothing` keeps whichever of those rows the batch inserts first and
 * silently drops the rest, rather than erroring. A player who trips two confirmed laws at once is
 * true today (`target_share_persistence` and `wr_target_competition` can both hold for the same
 * receiver) and stored reasons for him are known to be incomplete until a future migration keys
 * `"law"` rows on `lawId` too.
 */
export function reasonRows(board: readonly BoardEntry[], stamp: BoardStamp): readonly PreseasonBoardReasonRow[] {
  const rows: PreseasonBoardReasonRow[] = [];
  for (const entry of board) {
    for (const reason of entry.reasons) {
      const { code, ...payload } = reason;
      rows.push({ season: stamp.season, source: stamp.source, playerId: entry.playerId, code, payload: payload as JsonObject });
    }
  }
  return rows;
}

const INSERT_CHUNK_ROWS = 2_000;

/**
 * Writes a board, idempotently, returning how many rows were ACTUALLY new.
 *
 * `onConflictDoNothing` and never `DoUpdate`, matching every writer in the point-in-time store: a
 * board taken at a stated moment is immutable. A refit says something different, and it says it
 * under a new `source` or at a new moment, which is a new row. Overwriting would rewrite a number
 * somebody was shown last Tuesday and leave nothing to notice it by.
 */
export async function recordPreseasonProjections(db: Db, rows: readonly PreseasonProjectionRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row }));
    const inserted = await db
      .insert(preseasonProjections)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: preseasonProjections.id });
    written += inserted.length;
  }
  return written;
}

/**
 * Writes a board's reasons, idempotently, returning how many rows were ACTUALLY new.
 *
 * `onConflictDoNothing` here is doing double duty. Across two runs it is the same idempotency
 * `recordPreseasonProjections` wants: a rerun of an unchanged board writes nothing new. WITHIN one
 * run it is what keeps `reasonRows`' known PK gap (see its own docblock) from ever throwing — two
 * rows in the same batch sharing a `(source, season, playerId, code)` skip rather than collide,
 * because `DO NOTHING` never attempts to touch a row it has already resolved once, unlike
 * `DO UPDATE`, which errors on being asked to affect the same row twice in one statement.
 */
export async function recordPreseasonBoardReasons(db: Db, rows: readonly PreseasonBoardReasonRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row }));
    const inserted = await db
      .insert(preseasonBoardReasons)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ code: preseasonBoardReasons.code });
    written += inserted.length;
  }
  return written;
}

const SELECTED = {
  season: preseasonProjections.season,
  source: preseasonProjections.source,
  playerId: preseasonProjections.playerId,
  rank: preseasonProjections.rank,
  positionRank: preseasonProjections.positionRank,
  projectedPoints: preseasonProjections.projectedPoints,
  valueOverReplacement: preseasonProjections.valueOverReplacement,
  valueRank: preseasonProjections.valueRank,
  expectedGames: preseasonProjections.expectedGames,
  floorPoints: preseasonProjections.floorPoints,
  medianPoints: preseasonProjections.medianPoints,
  ceilingPoints: preseasonProjections.ceilingPoints,
  tier: preseasonProjections.tier,
  asOf: preseasonProjections.asOf,
} as const;

/**
 * One board for one season as it was knowable at `asOf`, one row per player.
 *
 * The same `DISTINCT ON` + `as_of <=` shape every read in this engine uses, and carried here even
 * though a product surface passes a moment far in the future: the gate costs nothing when nothing
 * is being hidden, and a reader that did not have one is a reader a backtest cannot reuse.
 */
export async function preseasonProjectionsAsOf(
  db: ReadonlyDb,
  { season, source, asOf }: BoardStamp,
): Promise<readonly PreseasonProjectionRow[]> {
  return db
    .selectDistinctOn([preseasonProjections.playerId], SELECTED)
    .from(preseasonProjections)
    .where(
      and(
        eq(preseasonProjections.season, season),
        eq(preseasonProjections.source, source),
        lte(preseasonProjections.asOf, asOf),
      ),
    )
    .orderBy(asc(preseasonProjections.playerId), desc(preseasonProjections.asOf));
}

/**
 * The board's opinion of a named handful of players, for a surface that draws one man or a lineup.
 *
 * A player the board never ranked is ABSENT FROM THE RESULT rather than present with a zero. There
 * is no projection for a man the model could not build one for, and the caller's job is to print a
 * dash — `NOT_STARTED_DASH` — rather than to invent the number that would fit.
 */
export async function preseasonProjectionsFor(
  db: ReadonlyDb,
  { season, source, asOf }: BoardStamp,
  playerIds: readonly string[],
): Promise<readonly PreseasonProjectionRow[]> {
  if (playerIds.length === 0) return [];
  return db
    .selectDistinctOn([preseasonProjections.playerId], SELECTED)
    .from(preseasonProjections)
    .where(
      and(
        eq(preseasonProjections.season, season),
        eq(preseasonProjections.source, source),
        lte(preseasonProjections.asOf, asOf),
        inArray(preseasonProjections.playerId, [...playerIds]),
      ),
    )
    .orderBy(asc(preseasonProjections.playerId), desc(preseasonProjections.asOf));
}

/** Every `BoardReason` tag this reader knows how to reconstruct — hand-paired with the union in
 *  `board.ts`, the same literal-and-type pairing this engine keeps everywhere a runtime list stands
 *  in for a type TypeScript itself erases (`populations.ts`'s `SKILL_POSITIONS`, for one). */
const KNOWN_REASON_CODES: ReadonlySet<BoardReason["code"]> = new Set([
  "availability",
  "offseason_share_gained",
  "offseason_share_lost",
  "changed_team",
  "new_play_caller",
  "rookie",
  "scarcity",
  "tier_cliff",
  "law",
]);

function isKnownReasonCode(code: string): code is BoardReason["code"] {
  return KNOWN_REASON_CODES.has(code as BoardReason["code"]);
}

/**
 * One stored row, reconstructed into the exact `BoardReason` it was written from — `reasonRows`
 * split a reason into `code` (the tag) and `payload` (everything else); this puts them back
 * together. Trusted rather than re-validated field by field, because every row here was written by
 * `reasonRows` from a real `BoardReason` — nothing hand-edits this table the way `measured.json` can
 * be hand-edited, so this is not the boundary `registry.ts`'s `parseMeasuredJson` is.
 */
function reasonFromRow(code: string, payload: JsonObject): BoardReason | undefined {
  if (!isKnownReasonCode(code)) return undefined;
  return { code, ...payload } as BoardReason;
}

/**
 * Every reason a board stored for a season, keyed by player.
 *
 * A stored row whose `code` this reader does not recognise — a variant retired since the row was
 * written, or a hand-edited table — is DROPPED rather than thrown: an explanation surface losing one
 * reason is a smaller failure than a whole board request failing. `console.warn` names how many were
 * dropped, once, after the whole read, so the drop is visible rather than silent.
 */
export async function boardReasons(
  db: ReadonlyDb,
  source: string,
  season: number,
): Promise<ReadonlyMap<string, readonly BoardReason[]>> {
  const rows = await db
    .select({
      playerId: preseasonBoardReasons.playerId,
      code: preseasonBoardReasons.code,
      payload: preseasonBoardReasons.payload,
    })
    .from(preseasonBoardReasons)
    .where(and(eq(preseasonBoardReasons.source, source), eq(preseasonBoardReasons.season, season)));

  const out = new Map<string, BoardReason[]>();
  let dropped = 0;
  for (const row of rows) {
    const reason = reasonFromRow(row.code, row.payload);
    if (reason === undefined) {
      dropped += 1;
      continue;
    }
    const list = out.get(row.playerId);
    if (list === undefined) out.set(row.playerId, [reason]);
    else list.push(reason);
  }
  if (dropped > 0) {
    console.warn(`boardReasons: dropped ${dropped} row(s) with an unrecognised reason code for source "${source}", season ${season}.`);
  }
  return out;
}
