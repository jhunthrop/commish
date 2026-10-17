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

/** An API figure the API has already rounded to a tenth (Lane 66k's ruling: rounded once, in Go),
 * printed as given: formatting only, so the web never rounds it again. */
export function printTenth(value: number): string {
	const text = String(value);
	return text.includes('.') ? text : `${text}.0`;
}

/** The scorings a week's projection is read in: the API's names (ProjectionScoring.format). */
export type TileScoring = 'ppr' | 'half_ppr' | 'standard';

/** Rest of season's parts the caption names (review N1, N2): its first week, his rank in words as
 * Lane 63's held rule gives it, and the scoring and its label the tile's total is in. */
export interface RestParts {
	fromWeek: number;
	/** "WR1 in our order", or for a player on a season-long list "RB IR, unranked while on a
	 * season-long list". */
	rank: string;
	scoring: TileScoring;
	label: string;
}

/** His rank at his position in words: the number in our order, or Lane 63's word for a player on a
 * season-long list, who is never given the rank his figure would earn. */
export function restRankWords(position: string, shown: number | string): string {
	return typeof shown === 'number'
		? `${position}${String(shown)} in our order`
		: `${position} ${shown}, unranked while on a season-long list`;
}

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
	/** The slot the weekly model's why fills once a round of it passes its test: its title alone
	 * until then (review M9). */
	whyTitle: "Why this week's Proj",
	/** A "--" says why on its tile (review M4). */
	byeWeek: 'Bye this week',
	projNotIn: "This week's projection is not in yet",
	projNotHim: "Not in this week's published projection",
	noEarlierRead: 'No earlier read this week',
	noProjToCompare: 'No projection to compare',
	notInEarlier: 'Not in the earlier read',
	notRanked: 'not ranked yet',
	/** The game log's collapsed earlier seasons (review M8). */
	earlierSeasons: 'Earlier seasons',
	/** The waiver verb where we know no page of the platform's: our own screen, named as ours. */
	findOnWaivers: 'Find him on Waivers'
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
