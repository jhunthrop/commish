/** The top bar's player search over the run's index: matching and ordering, no DOM. */
import type { IndexEntry } from '#lib/run/schema.ts';

/** Where the browser fetches the index, prerendered from the run at build. */
export const SEARCH_INDEX_URL = '/data/index.json';
export const SEARCH_LIMIT = 8;

/** Lower case with accents folded, so "jose" finds "José". */
export function folded(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export interface SearchablePlayer extends IndexEntry {
	/** The folded name, worked out once when the index loads. */
	key: string;
}

export function searchable(entries: readonly IndexEntry[]): SearchablePlayer[] {
	return entries.map((entry) => ({ ...entry, key: folded(entry.name) }));
}

/** How well a name matches: 0 when the name starts with the query, 1 when a later word does,
 * 2 when the query sits inside a word, null when it does not match. */
function matchRank(key: string, query: string): number | null {
	if (key.startsWith(query)) return 0;
	if (key.split(/[\s.'-]+/).some((word) => word.startsWith(query))) return 1;
	return key.includes(query) ? 2 : null;
}

/** The best matches for a query, in the index's own order (our rank) within each match rank. */
export function searchPlayers(
	players: readonly SearchablePlayer[],
	query: string,
	limit: number = SEARCH_LIMIT
): SearchablePlayer[] {
	const wanted = folded(query.trim());
	if (wanted === '') return [];
	return players
		.map((player, order) => ({ player, order, rank: matchRank(player.key, wanted) }))
		.filter(
			(hit): hit is { player: SearchablePlayer; order: number; rank: number } => hit.rank !== null
		)
		.sort((a, b) => a.rank - b.rank || a.order - b.order)
		.slice(0, limit)
		.map((hit) => hit.player);
}
