/** The player card (Lane 66h): the tiles under his name and the words every number's basis takes.
 * The types and words both halves share: the build words what the run holds (rest of season, Avg and
 * Last before the week is read), and the week's read (live.ts) words what the API holds. */

/** A tile's tone: the accent for this week's projection, the ease of his opponent, quiet for the
 * change. */
export type TileTone = 'lead' | 'easy' | 'hard' | 'even' | 'quiet' | null;

export type TileKey = 'proj' | 'rest' | 'opp' | 'avg' | 'last' | 'delta';

export interface CardTile {
	key: TileKey;
	label: string;
	/** "21.8", "26th", or "--" without a figure. */
	value: string;
	caption: string;
	tone: TileTone;
}

/** A number not held. */
export const NONE = '--';

/** The card's words that are not a player's, in one place for the copy guard. */
export const CARD = {
	proj: 'Proj',
	rest: 'Rest of season',
	projected: 'Projected',
	opp: 'Opp rank',
	avg: 'Avg',
	last: 'Last',
	delta: 'Δ Proj',
	compare: 'Compare',
	week: 'Week',
	/** The read's stamp, after its day: the writer reads from his facts through the last full
	 * season until the in-season read is written. */
	writtenFrom: 'from his facts through last season',
	/** The slot the weekly model's why fills once a round of it passes its test. */
	whyTitle: "Why this week's Proj",
	why: 'Our weekly model writes this once a round of it passes its test. Until then the Proj is the published projection, and the tiles and the game log are the evidence.'
} as const;

/** The tiles in the card's order. */
export const TILE_ORDER: readonly TileKey[] = ['proj', 'rest', 'opp', 'avg', 'last', 'delta'];

/** A tile replaced by its key, the rest kept. */
export function withTile(tiles: readonly CardTile[], next: CardTile): CardTile[] {
	return tiles.map((tile) => (tile.key === next.key ? next : tile));
}

/** The basis line while the week is unread, or when it cannot be read. */
export function unreadBasis(failed: boolean): string {
	return failed
		? `${CARD.proj}, ${CARD.opp} and ${CARD.delta} show "${NONE}" because this week's figures could not be read just now.`
		: `${CARD.proj}, ${CARD.opp} and ${CARD.delta} are this week's, read as the page opens.`;
}
