import type { Db } from "@/db/client";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { createTtlMemo } from "@/lib/cache/ttl-memo";
import type { LeagueShape } from "@/projections/decide/replacement";
import { BOARD_REASONS_MEMO_TTL_MS } from "@/projections/preseason/reasons-by-player";
import { boardRows, type BoardRow } from "./service";

/**
 * THE GENERIC BOARD, READ ONCE PER INSTANCE (site search round, 2026-09-08): the 12-team standard
 * PPR shape every league-free surface already reads the board under — the capsule sweep, the
 * sheet seed, the HQ banner and now the site search index and the team page.
 *
 * MEMOIZED AT THE BOARD'S OWN CADENCE. `boardRows` is a real read (the projections generation, the
 * reasons, the byes, the crosswalk join, last season's K and DEF lines), and a search index or a
 * team page built on every request would pay it on every request. The board regenerates nightly
 * (`BOARD_REASONS_MEMO_TTL_MS`'s own reasoning), so an hour-old copy lags a write by a fraction of
 * the write's cadence, the same bargain every other reference memo on this product makes. The rows
 * are shared by reference and never mutated by a reader.
 */
export const GENERIC_BOARD_SHAPE: LeagueShape = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };

const GENERIC_BOARD_KEY = "generic";

const memo = createTtlMemo<readonly BoardRow[]>(BOARD_REASONS_MEMO_TTL_MS);

/** Every served board row under the generic shape, from memory after the first read. */
export function genericBoardRows(db: Db): Promise<readonly BoardRow[]> {
  return memo.get(GENERIC_BOARD_KEY, () => boardRows(db, { shape: GENERIC_BOARD_SHAPE }));
}
