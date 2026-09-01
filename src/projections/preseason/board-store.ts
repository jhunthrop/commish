import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@/db/client";
import { preseasonBoardReasons, preseasonProjections } from "@/db/schema";
import { changedRowWhere, excludedSetFor } from "@/db/upsert";
import type { JsonObject } from "@/domain/audit";
import type { BoardEntry, BoardReason } from "./board";
import type { BoardMoment } from "./source";

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
 * THE HISTORICAL RAW-MODEL SOURCE (C3 fix round, 2026-08-31 — superseded as the SHIPPED board by
 * `BOARD_SOURCE`, below, which now names the blended one). Kept as its own named constant, never
 * deleted: every row ever written under it is the raw, pre-blend board's own honest history, and a
 * reader comparing "what the raw model alone said" against "what shipped" (Task 11's own scorecard,
 * a backtest) needs a stable name for the first half of that comparison. `scripts/preseason-persist.ts`
 * writes fresh rows here too, via `shippedPreseasonCandidates`'s own `{ raw: true }` seam, so this
 * source's own reasons stay CURRENT (never a stale mix of pre-blend projections next to blended-board
 * reasons — the exact drift a fix round found and this constant's split existence now prevents).
 */
export const BOARD_SOURCE_V1_RAW = "commish_board_v1_ppr_12";

/**
 * Which board said it. Model version AND league format in one value, exactly as the benchmark
 * sources name market and format in one (`ffc_adp_ppr_12`), because a projected point total is
 * meaningless without the rules that composed it and a rank is meaningless without the roster
 * shape that valued it. A refit is a new value here, never an overwrite of rows a manager has
 * already been shown.
 *
 * BUMPED TO v2 (C3 fix round 1, 2026-08-31): Task 10 wired `shippedPreseasonCandidates`'s market
 * blend in as the board `scripts/preseason-persist.ts` writes, but `preseason_projections`' own
 * unique key (`season, source, as_of`) meant a rerun under the UNCHANGED v1 source name never wrote
 * a single new projection row — every row already existed from before the blend, so the blend's own
 * point totals never reached the store a live product surface reads, even though its REASONS did
 * (a different table, no `as_of`, always overwritten).
 *
 * BUMPED AGAIN TO v3 (fix round 2, 2026-08-31 — NOT preserved as its own named historical constant
 * the way v1/raw is): the SAME unique-key problem recurred one level up. Fix round 1's own blend had
 * a real correctness bug (an unlisted quarterback's rescale inflated him toward starter-level
 * output); fix round 2 fixed the bug in code, re-ran the grid search, and re-ran persist under the
 * STILL-v2 source name expecting fresh numbers — and got zero new projection rows again, for the
 * identical reason: v2's own `(season, source, as_of)` rows already existed from fix round 1's own
 * run, so the corrected pricing never reached the store either, even though the reasons table (no
 * `as_of`) silently updated to describe numbers the projections table was not actually showing.
 * `commish_board_v3_ppr_12` is, again, a fresh value with no existing rows. Unlike
 * `BOARD_SOURCE_V1_RAW`, v2 is NOT kept as a second permanent named constant: v1/raw serves an
 * ongoing, identified purpose (the raw-vs-blend comparison Task 11's scorecard needs both halves
 * of), while v2 was a blend that never finished shipping correctly — its own stored rows were wrong
 * the entire time they existed, so there is nothing about "v2 specifically" worth a reader
 * addressing by name going forward. Every reader of `BOARD_SOURCE` (the drafts-players route, the
 * player screen) picks up the corrected blend automatically, with no call-site change.
 *
 * BUMPED AGAIN TO v4 (fix round 3, IMPORTANT 1, 2026-09-01 — the identical unique-key problem, a
 * third time). Fix round 2's own tail guard was correct, but the affine rescale layer it capped
 * (`unlistedRescale`) was dead: every fitted intercept at RB/WR/TE already sat above that position's
 * own tail, so the tail's `Math.min` discarded the rescale's output for every candidate, collapsing
 * every unlisted player at a position to the SAME tail value and erasing the raw model's own
 * ordering among them. A live check against v3's own stored rows confirmed the damage directly:
 * multiple DISTINCT unlisted WRs were stored at the identical 85.79-point WR tail in 2024, and
 * re-running the corrected pricing (`market/blend.ts`'s `tailCappedUnlistedPoints`, the rescale layer
 * removed) against those SAME player ids returned distinct, ordered numbers instead (6.94, 65.40,
 * 19.40, 83.39, 8.84, 71.54 among them) — a real, large points change for unlisted RB/WR/TE
 * candidates, not a no-op refactor. QB is the one position where v3's stored numbers are unaffected:
 * `unlistedRescale.QB` was already the identity transform (fix round 2's own fit-validity ruling), so
 * `tailCappedUnlistedPoints` reproduces QB's old output exactly — the discrepancy is real only at
 * RB/WR/TE, but the fix is not position-scoped in the store, so the WHOLE board moves to a fresh
 * source rather than only the affected positions. `commish_board_v4_ppr_12` is, again, a fresh value
 * with no existing rows, for the identical structural reason v2 and v3 needed one: `preseason_projections`'
 * own `(season, source, as_of)` unique key means a rerun under an unchanged source name silently
 * keeps serving the old, wrong numbers forever. v3 is NOT kept as a second permanent named constant,
 * for the same reason v2 was not: its own stored rows were wrong (at RB/WR/TE) the entire time they
 * existed.
 */
export const BOARD_SOURCE = "commish_board_v4_ppr_12";

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
  /** Which arm of `BoardMoment` (`source.ts`) `asOf` came from — Task 2. `'replay'` for every board
   *  this engine has ever stored; `'live'` is the one value `scorecard.ts`'s `assertGradableMoment`
   *  refuses to grade. */
  readonly momentKind: BoardMomentKind;
}

export interface BoardStamp {
  readonly season: number;
  readonly source: string;
  /** `PreseasonInputs.moment` and nothing else. See the module docblock. */
  readonly asOf: Date;
}

/** `source.ts`'s `BoardMoment["kind"]`, named locally so this module never has to import the whole
 *  `BoardMoment` union just to talk about which arm a stamp came from. */
export type BoardMomentKind = BoardMoment["kind"];

/**
 * `BoardStamp` plus the moment kind — what `projectionRows` needs to fill the `moment_kind` column.
 * Kept separate from `BoardStamp` itself rather than folded into it: `preseasonProjectionsAsOf` and
 * `preseasonProjectionsFor` below both take a bare `BoardStamp` to READ a board (season, source and
 * as-of are the whole identity of a read), and their call sites across the product never had a moment
 * kind to supply. Only a WRITE needs to say which arm produced the row.
 */
export interface PreseasonProjectionStamp extends BoardStamp {
  readonly momentKind: BoardMomentKind;
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
export function projectionRows(board: readonly BoardEntry[], stamp: PreseasonProjectionStamp): readonly PreseasonProjectionRow[] {
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
    momentKind: stamp.momentKind,
  }));
}

/** One `BoardReason` turned into a row: `code` is the union's own tag, `detail` is the
 *  discriminator WITHIN that tag (see `preseasonBoardReasons`'s own docblock — a law id for `"law"`
 *  rows, `''` for every other current variant), `payload` is every other field of that variant,
 *  verbatim — see the same docblock for why there is no `asOf` here, unlike `PreseasonProjectionRow`. */
export interface PreseasonBoardReasonRow {
  readonly season: number;
  readonly source: string;
  readonly playerId: string;
  readonly code: string;
  readonly detail: string;
  readonly payload: JsonObject;
}

/** The discriminator WITHIN a reason's `code` — the field `detail` stores (fix round, superseding
 *  Task 7's original PK). A `"law"` reason's own `lawId` is the only variant that can repeat for one
 *  player on one board today, so it is the only one that needs a second key; every other variant is
 *  `''`, since none of them can fire twice for the same candidate. */
function reasonDetail(reason: BoardReason): string {
  return reason.code === "law" ? reason.lawId : "";
}

/**
 * Every reason on a board, turned into rows — one row per `(player, reason)` pair, `code`/`detail`
 * and `payload` split exactly as `preseasonBoardReasons` stores them. `detail` (`reasonDetail`) is
 * what lets a player carry MORE THAN ONE `"law"` reason: `target_share_persistence` and
 * `wr_target_competition` can both be true for the same receiver, and without a second key inside
 * `code` the table's PK could hold only one of them.
 */
export function reasonRows(board: readonly BoardEntry[], stamp: BoardStamp): readonly PreseasonBoardReasonRow[] {
  const rows: PreseasonBoardReasonRow[] = [];
  for (const entry of board) {
    for (const reason of entry.reasons) {
      const { code, ...payload } = reason;
      rows.push({
        season: stamp.season,
        source: stamp.source,
        playerId: entry.playerId,
        code,
        detail: reasonDetail(reason),
        payload: payload as JsonObject,
      });
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

/** `preseasonBoardReasons`'s conflict target — the whole PK, `detail` included — as JS property
 *  names, the shape `excludedSetFor`/`changedRowWhere` (`@/db/upsert`) both key off. */
const REASON_KEYS: readonly string[] = ["source", "season", "playerId", "code", "detail"];

/**
 * Writes a board's reasons, returning how many rows this call ACTUALLY WROTE — a fresh insert, or a
 * replaced payload on a row that already existed.
 *
 * `onConflictDoUpdate`, not `onConflictDoNothing` (fix round, superseding Task 7's original write):
 * this table's own docblock promises a rerun REPLACES its opinion, and a payload can genuinely
 * change between two runs of the "same" board — a refreshed `measured.json` moves a law's own
 * `effect`, a player's own facts move his `magnitude` — so a writer that only skipped conflicting
 * rows would leave a stale payload sitting under a row still claiming to be current.
 *
 * `changedRowWhere` (the SAME idiom `stats-pipeline/persist.ts` uses for exactly this reason, see
 * its own docblock) is what keeps a rerun with an UNCHANGED payload a true no-op: Postgres itself
 * decides, via `WHERE payload IS DISTINCT FROM excluded.payload`, so a row whose incoming payload
 * matches what's stored is neither updated nor returned by `RETURNING` — the write genuinely did
 * not happen, rather than merely being labelled a no-op after the fact.
 */
export async function recordPreseasonBoardReasons(db: Db, rows: readonly PreseasonBoardReasonRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_ROWS).map((row) => ({ ...row }));
    const inserted = await db
      .insert(preseasonBoardReasons)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          preseasonBoardReasons.source,
          preseasonBoardReasons.season,
          preseasonBoardReasons.playerId,
          preseasonBoardReasons.code,
          preseasonBoardReasons.detail,
        ],
        set: excludedSetFor(preseasonBoardReasons, REASON_KEYS),
        where: changedRowWhere(preseasonBoardReasons, REASON_KEYS),
      })
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
  momentKind: preseasonProjections.momentKind,
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
  "market_unlisted",
  "market_anchor",
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
