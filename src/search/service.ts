import type { Db } from "@research-ts/db/client";
import { genericBoardRows } from "@research-ts/board/generic-board";
import { byeWeeksByTeam } from "@research-ts/reference/nfl-schedule";
import { BOARD_MEMO_GROUP, createTtlMemo } from "@research-ts/lib/cache/ttl-memo";
import { NFL_TEAM_ABBREVIATIONS } from "@research-ts/projections/capture-feeds";
import { BOARD_REASONS_MEMO_TTL_MS } from "@research-ts/projections/preseason/reasons-by-player";
import { SEARCH_CONFIG } from "./config";
import type { SearchBody } from "./contract";
import { searchEntriesFor } from "./entries";
import { buildSearchIndex, searchIndex, type SearchIndex } from "./index";

/**
 * THE SEARCH INDEX, BUILT ONCE PER INSTANCE AND SEARCHED FROM MEMORY. Server-only: this is the one
 * file under `src/search` that touches a database, and it does so exactly once per TTL.
 *
 * Built from the memoized generic board (`genericBoardRows`), the 32 product team codes and the
 * ingested byes, under its own memo at the board's cadence — the two memos expire on the same
 * clock, so a fresh board reaches the index within the hour and never sooner than it reaches the
 * board's other readers. A search costs no database statement after the first one per instance,
 * which the service test measures rather than asserts.
 */
const INDEX_KEY = "site-search";

const indexMemo = createTtlMemo<SearchIndex>(BOARD_REASONS_MEMO_TTL_MS, undefined, { group: BOARD_MEMO_GROUP });

async function buildIndex(db: Db): Promise<SearchIndex> {
  const [rows, byes] = await Promise.all([genericBoardRows(db), byeWeeksByTeam(db)]);
  return buildSearchIndex(searchEntriesFor(rows, NFL_TEAM_ABBREVIATIONS, byes));
}

/** The index, from memory after the first call. */
export function siteSearchIndex(db: Db): Promise<SearchIndex> {
  return indexMemo.get(INDEX_KEY, () => buildIndex(db));
}

/** The strongest matches for `query`, capped at `SEARCH_CONFIG.maxResults`. */
export async function siteSearch(db: Db, query: string): Promise<SearchBody> {
  const index = await siteSearchIndex(db);
  return { query, results: searchIndex(index, query, SEARCH_CONFIG.maxResults) };
}
