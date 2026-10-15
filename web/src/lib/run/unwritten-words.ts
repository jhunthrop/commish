/** The player page's list for a page whose written read is not ready: what the read will be built
 * from, each fact led by its name and carrying the basis of its figure. Built with the page. */
import { fixed } from '#lib/format/number.ts';
import type { Position } from '#lib/types/player.ts';
import type { PlayerFormat } from './schema.ts';

/** The one sentence the page says, once, above the list. */
export const UNWRITTEN_READ =
	'Our written read of him is not ready. Here is what it will be built from.';

export interface UnwrittenLine {
	lead: string;
	text: string;
	figure: string;
}

export interface UnwrittenInput {
	position: Position;
	numbers: PlayerFormat;
	/** How many players the format's board ranks. */
	boardSize: number;
	/** The format's label and points unit: "PPR", "PPR pts". */
	label: string;
	unit: string;
	year: number;
	/** The figures are the rest of the season's, not the whole season's. */
	restOfSeason: boolean;
}

/** The facts the written read draws on that the page does not already print as its own numbers. */
export function unwrittenLines(input: UnwrittenInput): UnwrittenLine[] {
	const { numbers, position, boardSize, label, unit, year, restOfSeason } = input;
	const span = restOfSeason ? `the rest of ${String(year)}` : String(year);
	const lines: UnwrittenLine[] = [
		{
			lead: 'Our rank',
			figure: `${position}${String(numbers.positionRank)}`,
			text: `${position} ${String(numbers.positionRank)} and pick ${String(numbers.ourRank)} overall among the ${String(boardSize)} on our ${label} board.`
		},
		{
			lead: 'His tier',
			figure: `Tier ${String(numbers.tier)}`,
			text: `Tier ${String(numbers.tier)} among ${position}s on our ${label} board.`
		}
	];
	if (numbers.floor !== null && numbers.median !== null && numbers.ceiling !== null) {
		lines.push({
			lead: 'His range',
			figure: `${fixed(numbers.floor)} to ${fixed(numbers.ceiling)}`,
			text: `Low case ${fixed(numbers.floor)}, middle ${fixed(numbers.median)} and high case ${fixed(numbers.ceiling)} ${unit} for ${span}.`
		});
	}
	lines.push({
		lead: 'Games we expect',
		figure: fixed(numbers.expectedGames),
		text: `Games we expect him to play in ${span}, the base of his projected ${label} points.`
	});
	return lines;
}
