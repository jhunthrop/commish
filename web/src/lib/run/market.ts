/** Kickers and defenses on the run's boards (Lane 66m, the 2026-09-05 ruling): rows after the ranked
 * ones, in the drafters' order, with no projected points and no tier, and index entries with no page.
 * The reader keeps them apart from the ranked rows, so every page that reads a projection reads only
 * players who have one, and the pages that list kickers and defenses ask for them by name. */
import type { MarketPosition, Position } from '#lib/types/player.ts';
import type { Board, BoardRow, IndexEntry, MarketEntry, MarketRow } from './schema.ts';

/** The positions every board carries in draft order (types/player.ts names their type). */
export const MARKET_POSITIONS = ['K', 'DST'] as const satisfies readonly MarketPosition[];

export function isMarketPosition(position: Position): position is MarketPosition {
	return (MARKET_POSITIONS as readonly Position[]).includes(position);
}

/** A board file as the schema reads it: one list, the ranked rows and then the market rows. */
export interface BoardFile {
	format: string;
	rows: (BoardRow | MarketRow)[];
}

function isMarket<T extends { orderBasis?: string }>(
	row: T
): row is Extract<T, { orderBasis: 'market' }> {
	return row.orderBasis === 'market';
}

/** The board with its kickers and defenses apart, each list in the file's order. */
export function splitBoard(file: BoardFile): Board {
	const rows: BoardRow[] = [];
	const market: MarketRow[] = [];
	for (const row of file.rows) {
		if (isMarket(row)) market.push(row);
		else rows.push(row);
	}
	return { format: file.format, rows, market };
}

/** The index: the players with a page, and the kickers and defenses with none. */
export interface RunIndex {
	pages: IndexEntry[];
	market: MarketEntry[];
}

export function splitIndex(entries: readonly (IndexEntry | MarketEntry)[]): RunIndex {
	const pages: IndexEntry[] = [];
	const market: MarketEntry[] = [];
	for (const entry of entries) {
		if (isMarket(entry)) market.push(entry);
		else pages.push(entry);
	}
	return { pages, market };
}

/** The first market row a board carries that the index does not name, or null. */
export function unindexedMarketRow(board: Board, market: readonly MarketEntry[]): MarketRow | null {
	const named = new Set(market.map((entry) => entry.id));
	return board.market.find((row) => !named.has(row.id)) ?? null;
}

/** The kickers and defenses at one position, in draft order. */
export function marketAt<R extends MarketRow>(rows: readonly R[], position: MarketPosition): R[] {
	return rows
		.filter((row) => row.position === position)
		.sort((a, b) => a.positionRank - b.positionRank);
}
