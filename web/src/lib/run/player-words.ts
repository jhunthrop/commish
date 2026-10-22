/** The player page's sentences for each format line, built with the page: no script carries them. */
import type { DesignationStatus } from '#lib/format/designation.ts';
import { gapPicks } from '#lib/format/gap-picks.ts';
import { FIGURE } from '#lib/format/figure-words.ts';
import { fixed } from '#lib/format/number.ts';
import { playerRestFrom, playerRestWords, RUN_LAST_WEEK, restOfSeasonHead } from './rest-from.ts';
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
	const pick = `We have him at pick ${String(numbers.ourRank)}`;
	if (numbers.adp === null) return `None of our ADP sources has him yet. ${pick}.`;
	const adp = `ADP ${fixed(numbers.adp)} from ${sources.join(' and ')}.`;
	// The run's Gap as given (Lane 66q); a run older than the column says the two figures alone.
	const { gap } = numbers;
	if (gap === undefined || gap === null) return `${pick}. ${adp}`;
	const where =
		gap === 0 ? 'drafters take him right where we would' : `drafters take him ${gapPicks(gap)}`;
	return `${pick}, so ${where}. ${adp}`;
}

/** A player on a season-long list sits below the available players (Lane 63): his figure assumes he
 * plays, so no sentence gives him the rank it would earn. */
const BELOW_THE_AVAILABLE = 'He sits below the available players.';

/** A held player's tier box in place of his tier mates (Lane 128, B106): the list he is on and that
 * he is not ranked, since the in-season order never ranks a player on injured reserve as playing.
 * Why (his figure assumes he plays) is said once, in his status note at the top of the page. */
const HELD_TIER_WORDS: Readonly<Record<HeldStatus, string>> = {
	injured_reserve: 'On IR, not ranked',
	pup: 'On PUP, not ranked',
	nfi: 'On NFI, not ranked',
	suspended: 'Suspended, not ranked',
	out: 'Out for the season, not ranked'
};

/** The statuses a season-long list can be (format/designation.ts): a week's questionable or doubtful
 * never is. */
type HeldStatus = Exclude<DesignationStatus, 'questionable' | 'doubtful'>;

/** "On IR, not ranked": the tier box of a player on a season-long list; a week's status has none. */
export function heldTierWords(status: DesignationStatus): string {
	if (status === 'questionable' || status === 'doubtful')
		throw new Error(`A ${status} player is on no season-long list.`);
	return HELD_TIER_WORDS[status];
}

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
	// The run's figure stops at its last week (Lane 96 review M2): said, as a league's title week may run on.
	const through = String(Math.max(RUN_LAST_WEEK, format.rosFromWeek ?? RUN_LAST_WEEK));
	const caption =
		rest !== null
			? `${format.label} points for the rest of ${year} through week ${through}${rank}`
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

/** Why the formats' rest-of-season figures need not line up (Lane 139, C02): the model's shrinkage of
 * his season toward his preseason pace is fitted for each position and format on its own
 * (docs/research/2026-10-14-rest-of-season-preregistration.md), so a back's half PPR figure can sit off
 * the PPR and Standard midpoint. */
export const FORMATS_FITTED_APART =
	'Each format is fitted in its own scoring, so Half PPR need not sit halfway between PPR and Standard.';

/** The every-format table's points heading and each line's label: "Rest of season from week 7" when
 * every line prints in-season points, "Projected" otherwise, and when the table mixes the two each
 * in-season line names its basis beside its format; with two or more in-season lines, the note that
 * they are fitted apart. */
export function formatTable(
	lines: readonly {
		format: Format;
		numbers: Pick<PlayerFormat, 'restFromWeek'>;
		rest: RestFigures | null;
	}[]
): {
	head: string;
	labels: string[];
	note: string | null;
} {
	// His own first week still to play at the run (Lane 86), the same in every format.
	const from = (line: (typeof lines)[number]): string =>
		restOfSeasonHead(playerRestWords(playerRestFrom(line.format, line.numbers)));
	const rest = lines.filter((line) => line.rest !== null);
	const note = rest.length > 1 ? FORMATS_FITTED_APART : null;
	if (rest.length === 0)
		return { head: FIGURE.projected, labels: lines.map((l) => l.format.label), note };
	const [first] = rest;
	if (first && rest.length === lines.length) {
		return {
			head: from(first),
			labels: lines.map((l) => l.format.label),
			note
		};
	}
	return {
		head: FIGURE.projected,
		labels: lines.map((l) =>
			l.rest === null ? l.format.label : `${l.format.label}, ${from(l).toLowerCase()}`
		),
		note
	};
}
