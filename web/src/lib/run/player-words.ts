/** The player page's sentences for each format line, built with the page: no script carries them. */
import { draftersGap } from '#lib/format/draft.ts';
import { fixed, plural } from '#lib/format/number.ts';
import { restLead, type FiguresReach } from './rest-words.ts';
import type { Format, PlayerFormat } from './schema.ts';

/** In season, his rest-of-season figures beside the preseason board's, and the basis line the board
 * prints. */
export interface RestFigures {
	lead: string;
	/** Null for a player the preseason board did not rank: the page shows no preseason figure. */
	preseason: { rank: number; points: number } | null;
}

/** A format line's sentences, as the page prints them for it. */
export interface LineWords {
	/** The big figure's caption. */
	caption: string;
	/** The drafters fact's label and figure: where drafters take him ("Pick 15"), or in season his
	 * ADP as a fact of the drafts before it ("15.0"). */
	draftersLabel: string;
	draftersFigure: string;
	/** Where drafters take him against our rank, or in season the drafts his ADP is from. */
	drafters: string;
	/** His value's round, or in season his rest-of-season rank, or below replacement, among the board. */
	value: string;
}

/** "We have him at pick 12, so drafters take him 3 picks later. ADP 15.0 from PPR drafts, Sep 5 to
 * Sep 9." */
export function draftersWords(
	numbers: PlayerFormat,
	sources: readonly string[],
	inSeason: boolean
): string {
	// In season the ADP is the drafts' preseason order and our rank the rest of the season's, so
	// the two are not compared: the page gives the ADP alone.
	if (inSeason) {
		return numbers.adp === null
			? 'None of our ADP sources has him.'
			: `His ADP in ${sources.join(' and ')}, before the season.`;
	}
	const gap = draftersGap(numbers.adp, numbers.ourRank);
	if (numbers.adp === null || gap === null) {
		return `None of our ADP sources has him yet. We have him at pick ${String(numbers.ourRank)}.`;
	}
	const where =
		gap === 0
			? 'drafters take him right where we would'
			: `drafters take him ${plural(Math.abs(gap), 'pick')} ${gap > 0 ? 'later' : 'earlier'}`;
	return `We have him at pick ${String(numbers.ourRank)}, so ${where}. ADP ${fixed(numbers.adp)} from ${sources.join(' and ')}.`;
}

/** A player on a season-long list sits below the available players (Lane 63): his figure assumes he
 * plays, so no sentence gives him the rank it would earn. */
const BELOW_THE_AVAILABLE = 'He sits below the available players.';

export function lineWords(
	line: { format: Format; numbers: PlayerFormat; rest: RestFigures | null },
	sources: readonly string[],
	boardSize: number,
	season: { year: number; underway: boolean; heldOut?: boolean }
): LineWords {
	const { numbers, format, rest } = line;
	const year = String(season.year);
	const games = fixed(numbers.expectedGames);
	const held = season.heldOut === true;
	const rank = held
		? ' if he plays, below the available players'
		: `, our rank ${String(numbers.ourRank)}`;
	const caption =
		rest !== null
			? `${format.label} points for the rest of ${year}${rank}`
			: season.underway
				? `${format.label} points in ${year}, projected preseason over ${games} games`
				: `projected ${format.label} points in ${year}, over ${games} expected games`;
	const inSeason = rest !== null;
	return {
		caption,
		...draftersFact(numbers, inSeason || held),
		drafters: held
			? heldDraftersWords(numbers, sources)
			: draftersWords(numbers, sources, inSeason),
		value: held
			? heldValueWords(String(boardSize), inSeason)
			: valueWords(numbers, String(boardSize), inSeason)
	};
}

/** In season the round and the pick are no decision the member makes: the ADP stands as a fact, and
 * his rest-of-season rank takes the round's place (the figure and its tint stay). */
function draftersFact(
	numbers: PlayerFormat,
	inSeason: boolean
): Pick<LineWords, 'draftersLabel' | 'draftersFigure'> {
	if (numbers.adp === null) {
		return {
			draftersLabel: inSeason ? 'ADP' : 'Where drafters take him',
			draftersFigure: 'No ADP'
		};
	}
	return inSeason
		? { draftersLabel: 'ADP', draftersFigure: fixed(numbers.adp) }
		: { draftersLabel: 'Where drafters take him', draftersFigure: `Pick ${fixed(numbers.adp, 0)}` };
}

/** A held player's drafters sentence: the ADP alone, never against the rank his figure earns. */
function heldDraftersWords(numbers: PlayerFormat, sources: readonly string[]): string {
	const adp =
		numbers.adp === null
			? 'None of our ADP sources has him.'
			: `ADP ${fixed(numbers.adp)} from ${sources.join(' and ')}.`;
	return `${adp} ${BELOW_THE_AVAILABLE}`;
}

function heldValueWords(boardSize: string, inSeason: boolean): string {
	const among = `If he plays, among the ${boardSize} on our board${inSeason ? ' for the rest of the season' : ''}.`;
	return `${among} ${BELOW_THE_AVAILABLE}`;
}

function valueWords(numbers: PlayerFormat, boardSize: string, inSeason: boolean): string {
	if (numbers.vor < 0) {
		return inSeason
			? `Below replacement for the rest of the season, among the ${boardSize} on our board`
			: `Below replacement, among the ${boardSize} on our board`;
	}
	return inSeason
		? `Our rank ${String(numbers.ourRank)} of the ${boardSize} on our board for the rest of the season`
		: `Round ${String(numbers.vorRound)} value among the ${boardSize} on our board`;
}

export function restFigures(
	format: Format,
	numbers: PlayerFormat,
	reach: FiguresReach,
	season: number
): RestFigures | null {
	const lead = restLead(format, reach, season);
	const { preseasonRank, preseasonPoints } = numbers;
	if (lead === null) return null;
	if (preseasonRank === undefined || preseasonPoints === undefined) {
		throw new Error(
			`The ${format.id} board ranks the rest of the season without his preseason figures.`
		);
	}
	const preseason =
		preseasonRank === null || preseasonPoints === null
			? null
			: { rank: preseasonRank, points: preseasonPoints };
	return { lead, preseason };
}

/** The every-format table's points heading and each line's label: "Rest of season from week 7" when
 * every line prints in-season points, "Projected" otherwise, and when the table mixes the two each
 * in-season line names its basis beside its format. */
export function formatTable(lines: readonly { format: Format; rest: RestFigures | null }[]): {
	head: string;
	labels: string[];
} {
	const from = (format: Format): string => `rest of season from week ${String(format.rosFromWeek)}`;
	const rest = lines.filter((line) => line.rest !== null);
	if (rest.length === 0) return { head: 'Projected', labels: lines.map((l) => l.format.label) };
	const [first] = rest;
	if (first && rest.length === lines.length) {
		const head = from(first.format);
		return {
			head: head.charAt(0).toUpperCase() + head.slice(1),
			labels: lines.map((l) => l.format.label)
		};
	}
	return {
		head: 'Projected',
		labels: lines.map((l) =>
			l.rest === null ? l.format.label : `${l.format.label}, ${from(l.format)}`
		)
	};
}
