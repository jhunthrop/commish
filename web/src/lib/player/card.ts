/** The player card (Lane 66h): the tiles under his name and the words every number's basis takes.
 * The types and words both halves share: the build words what the run holds (rest of season, Avg and
 * Last before the week is read), and the week's read (live.ts) words what the API holds. */
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import { FIGURE } from '#lib/format/figure-words.ts';
import { plural } from '#lib/format/number.ts';
import type { BoardFormat } from '#lib/sheet/model.ts';

/** A tile's tone: the accent for this week's projection, the ease of his opponent, quiet for the
 * change. */
export type TileTone = 'lead' | 'easy' | 'hard' | 'even' | 'quiet' | null;

export type TileKey = 'proj' | 'rest' | 'opp' | 'avg' | 'last' | 'delta';

/** The in-season row under the tiles (Lane 100): the preseason figures the order starts from, and
 * his rest of season a game against his Avg. */
export type BasisKey = 'preseason' | 'pace' | 'vsAvg';

export interface BasisTile {
	key: BasisKey;
	label: string;
	value: string;
	caption: string;
	/** vs Avg's reason from the order's stored basis, said once its two figures are (Lane 100 fix round
	 * 1, M4): never beside "--". Null without the stored pace, and on the other tiles. */
	reason: string | null;
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

/** A number not held. */
export const NONE = EMPTY_FIGURE;

/** An API figure printed as given, one rule with the box cells (league/box/box.ts). */
export { printTenth } from '#lib/league/box/box.ts';

/** The scorings a week's projection is read in: the API's names (ProjectionScoring.format). */
export type TileScoring = 'ppr' | 'half_ppr' | 'standard';

/** Rest of season's parts the caption names (review N1, N2): its first week, his rank in words as
 * Lane 63's held rule gives it, and the scoring and its label the tile's total is in. */
export interface RestParts {
	/** The week his rest of season starts from as the run says it (run/rest-from.ts): "from week 7",
	 * "with no game left". */
	from: string;
	/** "WR1 in our order", or for a player on a season-long list "RB IR, unranked while on a
	 * season-long list". */
	rank: string;
	scoring: TileScoring;
	label: string;
	/** The format the read's rest_of_season figures name for the tile's (the API's BoardFormat), null
	 * for a run format the API does not value. */
	board: BoardFormat | null;
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
	opp: 'Opp rank',
	avg: FIGURE.avg,
	last: 'Last',
	delta: 'Δ Proj',
	compare: 'Compare',
	week: 'Week',
	/** The season read's stamp, after its day: the page shows that read only before the season's
	 * first kickoff, when it was written from his facts through the last full season (Lane 100, B29). */
	writtenFrom: 'from his facts through last season',
	/** The tier box in season, titled by what it holds (Lane 100, B30). */
	whyRest: 'Why his rest-of-season figure',
	/** The read's head on his page and in the player shelf (Lane 113). */
	ourRead: 'Our read',
	/** In season, the read's place while no week read stands for him (Lane 100, B44). */
	readNotYet: 'Our read for his next game is not written yet.',
	/** The in-season row under the tiles (Lane 100, B17 and B51). */
	preseason: 'Preseason',
	preseasonPace: 'Preseason pace',
	vsAvg: 'vs Avg',
	paceCaption: 'a game, the pace our figure starts from',
	vsAvgCaption: 'rest of season a game against his Avg',
	/** The Proj of the week after his bye once its capture time has passed with none read. */
	nextProjNotIn: 'Not in yet',
	/** A "--" says why on its tile (review M4). */
	byeWeek: 'Bye this week',
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
	/** The waiver verb where we know no page of the platform's: our own screen, named as ours. */
	findOnWaivers: 'Find him on Waivers'
} as const;

/** The tiles in the card's order. */
export const TILE_ORDER: readonly TileKey[] = ['proj', 'rest', 'opp', 'avg', 'last', 'delta'];

/** Why his figure a game sits where it does against his Avg, from the order's stored basis: the
 * preseason pace a game it starts from (the Preseason pace tile beside it), weighed against the games
 * he has played (Lane 100, B51), short enough for its phone tile (Lane 117, B80). */
export function vsAvgReason(games: number): string {
	return `${plural(games, 'game')} weighed with his pace`;
}

/** The most characters vs Avg's caption takes with its figures and reason, so it fits four lines of
 * its phone tile, a third of a 390 screen (Lane 117, B80; the shot script counts the lines). */
export const VS_AVG_CAPTION_MAX = 60;

/** vs Avg's caption once its two figures are read, both named as the card prints them (Lane 100 fix
 * round 1, HIGH-1): "22.0 a game vs his 30.7 Avg", then the stored reason. Its first week is the
 * Rest of season tile's, said there. */
export function vsAvgCaption(perGame: string, avg: string, reason: string | null): string {
	const figures = `${perGame} a game vs his ${avg} Avg`;
	return reason === null ? figures : `${figures}: ${reason}`;
}

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
export function unreadBasis(failed: boolean, weekTile: string): string {
	return failed
		? `${weekTile}, ${CARD.opp} and ${CARD.delta} show "${NONE}" because this week's figures could not be read just now.`
		: `${weekTile}, ${CARD.opp} and ${CARD.delta} are this week's, read as the page opens.`;
}
