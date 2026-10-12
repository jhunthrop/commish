import type { Db } from "@research/db/client";
import { boardRows, type BoardRow } from "@research/board/service";
import { ROSTER_SHAPES } from "@research/domain/roster-shape";
import { boardKeyOf, type BoardVariant } from "../config";

/** Every variant's served board, keyed by `boardKeyOf`. Read one at a time: each read is a
 *  generation, a reasons, a byes and a last-season read, and thirty at once would only contend. */
export async function readBoards(db: Db, variants: readonly BoardVariant[], asOf: Date): Promise<ReadonlyMap<string, readonly BoardRow[]>> {
  const boards = new Map<string, readonly BoardRow[]>();
  for (const variant of variants) {
    const shape = { teamCount: variant.teamCount, rosterSlots: ROSTER_SHAPES[variant.shape] };
    boards.set(boardKeyOf(variant), await boardRows(db, { shape, format: variant.format, asOf }));
  }
  return boards;
}
