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
	/** Where drafters take him against our rank. */
	drafters: string;
	/** His value's round, or below replacement, among the board. */
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
			: `ADP ${fixed(numbers.adp)} from ${sources.join(' and ')}.`;
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

export function lineWords(
	line: { format: Format; numbers: PlayerFormat; rest: RestFigures | null },
	sources: readonly string[],
	boardSize: number,
	season: { year: number; underway: boolean }
): LineWords {
	const { numbers, format, rest } = line;
	const year = String(season.year);
	const games = fixed(numbers.expectedGames);
	const caption =
		rest !== null
			? `${format.label} points for the rest of ${year}, our rank ${String(numbers.ourRank)}`
			: season.underway
				? `${format.label} points in ${year}, projected preseason over ${games} games`
				: `projected ${format.label} points in ${year}, over ${games} expected games`;
	const value =
		numbers.vor < 0
			? `Below replacement, among the ${String(boardSize)} on our board`
			: `Round ${String(numbers.vorRound)} value among the ${String(boardSize)} on our board`;
	return { caption, drafters: draftersWords(numbers, sources, rest !== null), value };
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
