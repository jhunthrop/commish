/** The words of the pages that follow the season the rail shows (spec 2026-10-16 §2, Lane 59): the
 * front door's bar, heading and one solid verb, and the board's. In season the free followed league
 * is the trust loop, so it is the verb, and the board is the rest of the season under the rail's
 * own word; before the draft and after the season the draft words stay. A heading names the rest of
 * the season only where the run's board ranks it. Pure, so every sentence is tested. */
import { MOCK_VERB, RAIL_ITEMS, REST_OF_SEASON, railInSeason, type RailKey } from '#lib/ui/nav.ts';

/** A page's verbs, each by what it does: the page maps each to its link. */
export type PageVerb = 'follow' | 'open_league' | 'mock' | 'sheet';

export const PAGE_VERBS: Readonly<Record<PageVerb, string>> = {
	follow: 'Follow your league',
	open_league: 'Open your league',
	mock: MOCK_VERB,
	sheet: 'Build your cheat sheet'
};

/** The board's word in season, the bar's and the rail's with no league selected. */
const REST_WORD = REST_OF_SEASON;
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
	/** The week the rest of season counts from as the run says it, built on the server
	 * (run/rest-from.ts boardRestFrom: "from week 6's games left"), so no words module rides in the
	 * shell. Absent on a board of the full season. */
	restFrom?: string;
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
		board.restFrom === undefined
			? `Our ${season} board, for your league`
			: `Our board for the rest of the ${season} season ${board.restFrom}, for your league`;
	return { title: 'In season', heading, verb: leagueVerb(following), quiet: ['mock'] };
}

export interface BoardWords {
	/** The top bar's word, the rail's for the board. */
	bar: string;
	/** The document's title, with the format the bar leaves to the league switch. */
	title: string;
	/** The board's own heading. */
	heading: string;
	/** The one solid verb in the bar; none in season with a league selected, which the page already
	 * is (Lane 104, B60). */
	verb: PageVerb | null;
}

export function boardWords(
	rail: RailKey,
	board: BoardCover & { label: string; position: string | null },
	following: boolean
): BoardWords {
	const inSeason = railInSeason(rail);
	// The rest of the season is the board's name only where the run's board ranks it; a board of the
	// full season keeps its own name in season, with the verb still following the league.
	const ranksRest = inSeason && board.rosFromWeek !== undefined;
	const noun = ranksRest ? REST_WORD : BOARD_WORD;
	const lower = ranksRest ? noun.toLowerCase() : noun;
	const named = (prefix: string): string => `${prefix} ${lower}`;
	const position = board.position;
	const season = String(board.season);
	return {
		bar: position === null ? noun : named(position),
		title: named(position === null ? board.label : `${position} ${board.label}`),
		heading: ranksRest ? `Rest of ${season}` : `${season} ${BOARD_WORD}`,
		verb: inSeason ? (following ? null : 'follow') : 'mock'
	};
}
