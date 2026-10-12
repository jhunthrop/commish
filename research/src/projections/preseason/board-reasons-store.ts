import { and, eq } from "drizzle-orm";
import type { Db, DbTx, ReadonlyDb } from "@research/db/client";
import { preseasonBoardReasons } from "@research/db/schema";
import { changedRowWhere, excludedSetFor } from "@research/db/upsert";
import type { JsonObject } from "@research/domain/json";
import type { BoardEntry, BoardReason } from "./board";
import type { BoardStamp } from "./board-store";
import { rosterStatusReason } from "./roster-status";
import type { ExcludedCandidate } from "./roster-status-gate";

/**
 * THE REASON HALF OF THE BOARD STORE — `preseason_board_reasons`, split out of `board-store.ts`
 * (the roster-status gate round, 2026-09-08) when that file passed the size a module stays
 * readable at. Nothing here changed in the move: the row shape, the split of a `BoardReason` into
 * `code`/`detail`/`payload`, the upsert and the read are exactly what `board-store.ts` held, and
 * that module re-exports every public name so no caller moved. `board-store.ts` still owns the
 * WRITE of a board (`writePreseasonBoard`), which is the only place these rows are written from,
 * and the retire (`deletePreseasonBoard`), which is why the table's docblock and the one-generation
 * discipline live there.
 */

/** Rows per `INSERT`, for both tables of the store. */
export const INSERT_CHUNK_ROWS = 2_000;

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

function reasonRow(stamp: BoardStamp, playerId: string, reason: BoardReason): PreseasonBoardReasonRow {
  const { code, ...payload } = reason;
  return { season: stamp.season, source: stamp.source, playerId, code, detail: reasonDetail(reason), payload: payload as JsonObject };
}

/**
 * Every reason on a board, turned into rows — one row per `(player, reason)` pair, `code`/`detail`
 * and `payload` split exactly as `preseasonBoardReasons` stores them. `detail` (`reasonDetail`) is
 * what lets a player carry MORE THAN ONE `"law"` reason: `target_share_persistence` and
 * `wr_target_competition` can both be true for the same receiver, and without a second key inside
 * `code` the table's PK could hold only one of them.
 */
export function reasonRows(board: readonly BoardEntry[], stamp: BoardStamp): readonly PreseasonBoardReasonRow[] {
  return board.flatMap((entry) => entry.reasons.map((reason) => reasonRow(stamp, entry.playerId, reason)));
}

/** An excluded player's one stored row (the roster-status gate): his status, as a `roster_status`
 *  reason under the same stamp as the board he was kept off. */
export function exclusionReasonRows(exclusions: readonly ExcludedCandidate[], stamp: BoardStamp): readonly PreseasonBoardReasonRow[] {
  return exclusions.map((excluded) => reasonRow(stamp, excluded.playerId, rosterStatusReason(excluded.status)));
}

/** `preseasonBoardReasons`'s conflict target — the whole PK, `detail` included — as JS property
 *  names, the shape `excludedSetFor`/`changedRowWhere` (`@research/db/upsert`) both key off. */
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
export async function recordPreseasonBoardReasons(db: Db | DbTx, rows: readonly PreseasonBoardReasonRow[]): Promise<number> {
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
  "roster_status",
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
