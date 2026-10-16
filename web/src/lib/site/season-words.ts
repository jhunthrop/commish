/** The words of the pages that follow the season the rail shows (spec 2026-10-16 §2, Lane 59): the
 * front door's bar, heading and one solid verb, and the board's. In season the free followed league
 * is the trust loop, so it is the verb, and the board is the rest of the season under the rail's
 * own word; before the draft and after the season the draft words stay. A heading names the rest of
 * the season only where the run's board ranks it. Pure, so every sentence is tested. */
import { MOCK_VERB } from '#lib/league/phase-words.ts';
import { RAIL_ITEMS, type RailKey } from '#lib/ui/nav.ts';

/** Whether a rail is the season's: the rails that hold the in-season screens. */
export function railInSeason(rail: RailKey): boolean {
	return rail === 'in_season' || rail === 'playoffs' || rail === 'playoffs_waivers';
}

/** A page's verbs, each by what it does: the page maps each to its link. */
export type PageVerb = 'follow' | 'open_league' | 'mock' | 'sheet';

export const PAGE_VERBS: Readonly<Record<PageVerb, string>> = {
	follow: 'Follow your league',
	open_league: 'Open your league',
	mock: MOCK_VERB,
	sheet: 'Build your cheat sheet'
};

/** The board's rail word in season, the rail item's own label. */
const REST_WORD = railWord('rest');
/** The board's name before the draft and after the season. */
const BOARD_WORD = railWord('board');

function railWord(key: string): string {
	const item = RAIL_ITEMS.find((candidate) => candidate.key === key);
	if (!item) throw new Error(`No rail item ${key}.`);
	return item.label;
}

/** What the run's board covers, as the words need it. */
export interface BoardCover {
	season: number;
	/** The first week a rest-of-season board ranks, absent on a board of the full season. */
	rosFromWeek?: number;
}

export interface FrontWords {
	/** The top bar's word. */
	title: string;
	heading: string;
	/** The one solid verb. */
	verb: PageVerb;
	/** The quiet ways beside it, in order. */
	quiet: readonly PageVerb[];
}

/** The verb for a visitor's league: open the one followed, else follow one. */
function leagueVerb(following: boolean): PageVerb {
	return following ? 'open_league' : 'follow';
}

export function frontWords(rail: RailKey, board: BoardCover, following: boolean): FrontWords {
	const season = String(board.season);
	if (!railInSeason(rail)) {
		return {
			title: 'Draft prep',
			heading: `Our ${season} board, for your draft and your league`,
			verb: 'mock',
			quiet: [leagueVerb(following), 'sheet']
		};
	}
	const heading =
		board.rosFromWeek === undefined
			? `Our ${season} board, for your league`
			: `Our board for the rest of the ${season} season from week ${String(board.rosFromWeek)}, for your league`;
	return { title: 'In season', heading, verb: leagueVerb(following), quiet: ['mock'] };
}

export interface BoardWords {
	/** The top bar's word, the rail's for the board. */
	bar: string;
	/** The document's title, with the format the bar leaves to the league switch. */
	title: string;
	/** The board's own heading. */
	heading: string;
	/** The one solid verb in the bar. */
	verb: PageVerb;
}

export function boardWords(
	rail: RailKey,
	board: BoardCover & { label: string; position: string | null },
	following: boolean
): BoardWords {
	const inSeason = railInSeason(rail);
	const noun = inSeason ? REST_WORD : BOARD_WORD;
	const lower = inSeason ? noun.toLowerCase() : noun;
	const named = (prefix: string): string => `${prefix} ${lower}`;
	const position = board.position;
	const season = String(board.season);
	return {
		bar: position === null ? noun : named(position),
		title: named(position === null ? board.label : `${position} ${board.label}`),
		heading:
			inSeason && board.rosFromWeek !== undefined ? `Rest of ${season}` : `${season} ${BOARD_WORD}`,
		verb: inSeason ? leagueVerb(following) : 'mock'
	};
}
