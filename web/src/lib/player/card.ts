/** The player card (Lane 66h): the tiles under his name and the words every number's basis takes.
 * The types and words both halves share: the build words what the run holds (rest of season, Avg and
 * Last before the week is read), and the week's read (live.ts) words what the API holds. */
import { FREE_AGENT_WORDS } from '#lib/format/free-agent.ts';
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import { FIGURE } from '#lib/format/figure-words.ts';
import { onListWords } from '#lib/format/designation.ts';

export { onListWords };
import type { BoardFormat } from '#lib/sheet/model.ts';

/** A tile's tone: the accent for this week's projection, the ease of his opponent, quiet for the
 * change. */
export type TileTone = 'lead' | 'easy' | 'hard' | 'even' | 'quiet' | null;

export type TileKey = 'proj' | 'rest' | 'opp' | 'avg' | 'last' | 'delta';

/** The in-season row under the tiles (Lane 100; Lane 139, C09): the preseason pace the order starts
 * from, and our rate a game against his Avg (basis-words.ts). */
export type BasisKey = 'pace' | 'vsAvg';

export interface BasisTile {
	key: BasisKey;
	label: string;
	value: string;
	caption: string;
	/** vs Avg's reason from the order's stored basis, said once its two figures are (Lane 100 fix round
	 * 1, M4): never beside "--". Null without the stored pace, and on the other tiles. */
	reason: string | null;
	/** The run holds games he may miss above zero (Lane 165, D17): only then does the caption end on
	 * the rate a game after them. False on the pace tile and for a player expected to play every game
	 * his club has left. */
	mayMiss: boolean;
}

export interface CardTile {
	key: TileKey;
	label: string;
	/** "21.8", "26th", or "--" without a figure. */
	value: string;
	caption: string;
	tone: TileTone;
}

/** The card's head: the week the card shows and his opponent in it ("at NYJ"), or "Bye" in his bye
 * week, so the head and the week tile always name one week. */
export interface CardHead {
	week: number;
	opponent: string;
}

/** The smallest move of the week's published projection a page counts (Lane 139, C21; Lane 162, D04): the
 * Proj change tile shows none under it. The writer's cells and the run's rewrite rule hold the same
 * (`capsules/week/cells.py SHOWN_CHANGE_FROM`). The page never withholds a read for a move (Lane 274): a
 * read is about the matchup, and the tile says the move beside it. */
export const SHOWN_CHANGE_FROM = 0.5;

/** Tenths in a point, the precision the API and the run print. */
const TENTHS_IN_POINT = 10;

/** The projection's move as the page says it, one fact for the Proj change tile and the run's rewrite rule
 * (Lane 162, D04 fix round 1): `change` is the signed move in points (null with no
 * figures to subtract), `crosses` whether it reaches SHOWN_CHANGE_FROM, `basis` what it is measured from. */
export interface ProjectionMove {
	change: number | null;
	crosses: boolean;
	basis: 'read' | 'earlier';
}

/** The published projection's move: since the read was written when a read quotes one (`quoted`, null when
 * it had none, undefined with no read), else since the earlier snapshot (`earlier`, the API's
 * projection_delta). Taken in whole printed tenths so no float edge decides; a figure that appeared or went
 * is a move with no number. */
export function projectionMove(
	now: number | null,
	quoted: number | null | undefined,
	earlier: number | null
): ProjectionMove {
	if (quoted === undefined) {
		const tenths = earlier === null ? null : Math.round(earlier * TENTHS_IN_POINT);
		return { change: earlier, crosses: tenths !== null && crossesShown(tenths), basis: 'earlier' };
	}
	if (now === null || quoted === null)
		return { change: null, crosses: now !== quoted, basis: 'read' };
	const tenths = Math.round(now * TENTHS_IN_POINT) - Math.round(quoted * TENTHS_IN_POINT);
	return { change: tenths / TENTHS_IN_POINT, crosses: crossesShown(tenths), basis: 'read' };
}

function crossesShown(tenths: number): boolean {
	return Math.abs(tenths) >= SHOWN_CHANGE_FROM * TENTHS_IN_POINT;
}

/** A number not held. */
export const NONE = EMPTY_FIGURE;

/** The scorings a week's projection is read in: the API's names (ProjectionScoring.format). */
export type TileScoring = 'ppr' | 'half_ppr' | 'standard';

/** Rest of season's parts the caption names (review N1, N2): its first week, his rank in words as
 * Lane 63's held rule gives it, and the scoring and its label the tile's total is in. */
export interface RestParts {
	/** The week his rest of season starts from as the run says it (run/rest-from.ts): "from week 7",
	 * "with no game left". */
	from: string;
	/** The weeks it counts as the tile says them (run/rest-from.ts restSpanWords): "weeks 7 to 17". */
	span: string;
	/** "WR1 in our order", or for a player on a season-long list "RB IR, unranked while on a
	 * season-long list". */
	rank: string;
	scoring: TileScoring;
	label: string;
	/** The format the read's rest_of_season figures name for the tile's (the API's BoardFormat), null
	 * for a run format the API does not value. */
	board: BoardFormat | null;
}

/** A listed player's rest-of-season caption in place of his rank: the pill beside it says the list
 * (Lane 128 fix round 1, LOW-4). */
const UNRANKED_WHILE_LISTED = 'unranked while on a season-long list';

/** His rank at his position in words: the number in our order, or for a player on a season-long
 * list, who is never given the rank his figure would earn, that he is unranked. */
export function restRankWords(position: string, shown: number | string): string {
	return typeof shown === 'number'
		? `${position}${String(shown)} in our order`
		: UNRANKED_WHILE_LISTED;
}

/** The card's words that are not a player's, in one place for the copy guard. */
/** The Opp rank and change tiles' heads, which the listed basis names too. */
const OPP_HEAD = 'Opp rank';
const DELTA_HEAD = 'Proj change';

export const CARD = {
	/** The verbs the league's screens give him (week-words.ts verbOf): starting him, the way to the
	 * lineup once his game is locked or he starts already (Lane 85 fix round 3, M-D). */
	startHim: 'Start him',
	openLineup: 'Open your lineup',
	/** The game log's per-week projection column, a one-week box score's head. The card's own week
	 * tile is headed by its week beside the season's Projected (format/figure-words.ts weekHead). */
	proj: 'Proj',
	/** The week tile's caption before the week's read arrives. */
	readOnOpen: 'Read as the page opens',
	rest: 'Rest of season',
	projected: FIGURE.projected,
	opp: OPP_HEAD,
	avg: FIGURE.avg,
	last: 'Last',
	delta: DELTA_HEAD,
	compare: 'Compare',
	week: 'Week',
	/** The season read's stamp, after its day: the page shows that read only before the season's
	 * first kickoff, when it was written from his facts through the last full season (Lane 100, B29). */
	writtenFrom: 'from his facts through last season',
	/** The tier box, titled by what it holds (Lane 139, C23). */
	tier: 'His tier',
	/** The read's head on his page and in the player shelf (Lane 113). */
	ourRead: 'Our read',
	/** In season, the read's place while no week read stands for him (Lane 100, B44). */
	readNotYet: 'Our read for his next game is not written yet.',
	/** The same place while the coming week's reads are not yet written (Lane 256): every board player's
	 * read is written in one pass when the week rolls over, on the night the run names. */
	readsDue: (week: number, night: string): string =>
		`Our reads for week ${String(week)} are written ${night} night.`,
	/** The same place once his game has kicked off or is final (Lane 158): never "next" for it. */
	readNotWritten: 'Our read for this game was not written.',
	/** The Proj of the week after his bye once its capture time has passed with none read. */
	nextProjNotIn: 'Not in yet',
	/** A "--" says why on its tile (review M4). */
	byeWeek: 'Bye this week',
	/** A free agent's week (Lane 123, B101): his club cell is FA, and he has no game to project. */
	freeAgentWeek: `${FREE_AGENT_WORDS.charAt(0).toUpperCase()}${FREE_AGENT_WORDS.slice(1)}, no game this week`,
	projNotIn: "This week's projection is not in yet",
	projNotHim: "Not in this week's published projection",
	noEarlierRead: 'No earlier read this week',
	noProjToCompare: 'No projection to compare',
	notInEarlier: 'Not in the earlier read',
	/** The change's caption once his game has kicked off (Lane 80): the projection no longer moves. */
	kickedOff: 'His game has kicked off',
	gameFinal: 'His game is final',
	notRanked: 'not ranked yet',
	/** The game log's collapsed earlier seasons (review M8). */
	earlierSeasons: 'Earlier seasons',
	/** A listed player's basis in place of the week's figures his card does not draw (Lane 128): his
	 * Wk, Opp rank and Proj change tiles say "On IR"; composed from the tiles' heads. */
	listedWeek: `${FIGURE.week}, ${OPP_HEAD} and ${DELTA_HEAD} are his once he is back.`,
	/** The waiver verb where we know no page of the platform's: our own screen, named as ours. */
	findOnWaivers: 'Find him on Waivers'
} as const;

/** The week's own tiles, which a listed player's list stands in for. */
const WEEK_KEYS: ReadonlySet<TileKey> = new Set(['proj', 'opp', 'delta']);

/** The week's tiles of a player on a season-long list ("IR", the list's word): Proj, Opp rank and
 * the change are "--" with the list as their reason; null keeps the tiles. */
export function listedTiles(tiles: readonly CardTile[], word: string | null): CardTile[] {
	if (word === null) return [...tiles];
	return tiles.map((tile) =>
		WEEK_KEYS.has(tile.key)
			? {
					...tile,
					value: NONE,
					caption: onListWords(word),
					tone: tile.key === 'delta' ? 'quiet' : null
				}
			: tile
	);
}

/** The tiles in the card's order. */
export const TILE_ORDER: readonly TileKey[] = ['proj', 'rest', 'opp', 'avg', 'last', 'delta'];

/** Whether Compare is the card's one verb while no league verb stands (Lane 100 fix round 1, M3;
 * Lane 117, B80): in season, with his rest-of-season figure in hand, the sheet's add never leads,
 * before the week's read answers as after it. Preseason the sheet's add stays. */
export function compareLeadsWithoutVerb(rest: RestParts | null): boolean {
	return rest !== null;
}

/** The Proj of the week after his bye while it is not in: the day it is first published. */
export function publishedOn(day: string): string {
	return `Published ${day}`;
}

/** A tile replaced by its key, the rest kept. */
export function withTile(tiles: readonly CardTile[], next: CardTile): CardTile[] {
	return tiles.map((tile) => (tile.key === next.key ? next : tile));
}

/** The basis line while the week is unread, or when it cannot be read, naming the week tile by its
 * head ("Wk 6"). */
export function unreadBasis(
	failed: boolean,
	weekTile: string,
	listed: string | null = null
): string {
	// A listed player's week tiles say his list, read or not (Lane 128).
	if (listed !== null) return CARD.listedWeek;
	return failed
		? `${weekTile}, ${CARD.opp} and ${CARD.delta} show "${NONE}" because this week's figures could not be read just now.`
		: `${weekTile}, ${CARD.opp} and ${CARD.delta} are this week's, read as the page opens.`;
}
