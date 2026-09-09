import type { Player } from "@/domain/player";
import type { RosterStatusNote } from "@/projections/preseason/roster-status";

/**
 * WHAT A SEARCH ANSWERS WITH, on the wire and in the overlay. Browser-safe: types only.
 *
 * A player result carries the domain `Player` the row primitives already render, plus the three
 * board facts a row states beside the name. Every one of them is nullable and an absence renders
 * as an absence (law 7): a market-order kicker has a position rank and no board rank, a team
 * with no ingested schedule has no bye.
 */
export interface PlayerSearchResult {
  readonly kind: "player";
  readonly player: Player;
  /** His rank among his own position on the served board (`positionRankInValue`, or the market
   *  order's place for a K or DEF row). */
  readonly positionRank: number | null;
  /** The served board's overall rank (`overallRank`). `null` on a market-order row. */
  readonly boardRank: number | null;
  readonly byeWeek: number | null;
  /** The board's own dated roster status (`BoardRow.rosterStatus`), so a result names it the same
   *  way the board does; `null` when the board stored none. */
  readonly rosterStatus: RosterStatusNote | null;
}

export interface TeamSearchResult {
  readonly kind: "team";
  /** The product's own code, the one the team page route takes. */
  readonly code: string;
  /** "Detroit Lions". */
  readonly name: string;
  readonly byeWeek: number | null;
}

export type SearchResult = PlayerSearchResult | TeamSearchResult;

/** `GET /api/search?q=` answers this inside the product's `ok()` envelope. */
export interface SearchBody {
  readonly query: string;
  readonly results: readonly SearchResult[];
}

/** One stable id per result, for React keys and `aria-activedescendant`. */
export function searchResultKey(result: SearchResult): string {
  return result.kind === "player" ? `player:${result.player.id}` : `team:${result.code}`;
}
