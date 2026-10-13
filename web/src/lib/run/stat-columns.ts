/**
 * The game log's columns by position, in a drafter's words: a short head for the table, the full
 * words the season line captions each number with, and those words for a total of exactly 1. Points
 * sit right after the opponent and are added by the view, which knows the format.
 */
import { count } from '#lib/format/number.ts';
import type { Position } from '#lib/types/player.ts';
import type { StatField, StatLine } from './season.ts';

/** What a cell prints when the records do not carry the number: nothing, since the basis line says
 * which numbers the records lack. */
export const NO_FIGURE = '';

export interface StatColumn {
	short: string;
	full: string;
	/** The full words for a total of exactly 1: "receiving touchdown". */
	one: string;
	/** Whether the column needs a note in the basis line. */
	snaps?: true;
	value: (line: StatLine) => string;
}

const PERCENT = 100;

function figure(value: number | null): string {
	return value === null ? NO_FIGURE : count(value);
}

function stat(field: StatField, short: string, full: string, one: string): StatColumn {
	return { short, full, one, value: (line) => figure(line[field]) };
}

/** A column's full words for a value as printed: the singular for exactly 1. */
export function captionFor(column: StatColumn, value: string): string {
	return value === '1' ? column.one : column.full;
}

const COMPLETIONS: StatColumn = {
	short: 'Comp/att',
	full: 'completions of attempts',
	one: 'completions of attempts',
	value: ({ completions, pass_attempts: attempts }) =>
		completions === null || attempts === null
			? NO_FIGURE
			: `${count(completions)}/${count(attempts)}`
};

const SNAPS: StatColumn = {
	short: 'Snap %',
	full: 'share of snaps',
	one: 'share of snaps',
	snaps: true,
	value: (line) =>
		line.snapShare === null ? NO_FIGURE : `${String(Math.round(line.snapShare * PERCENT))}%`
};

const RUSHING = [
	stat('carries', 'Car', 'carries', 'carry'),
	stat('rushing_yards', 'Rush yds', 'rushing yards', 'rushing yard'),
	stat('rushing_touchdowns', 'Rush TD', 'rushing touchdowns', 'rushing touchdown')
];

const FUMBLES = stat('fumbles_lost', 'Fum', 'fumbles lost', 'fumble lost');

const CATCHING = [
	stat('targets', 'Tgt', 'targets', 'target'),
	stat('receptions', 'Rec', 'catches', 'catch')
];

const RECEIVER: readonly StatColumn[] = [
	...CATCHING,
	stat('receiving_yards', 'Yds', 'receiving yards', 'receiving yard'),
	stat('receiving_touchdowns', 'TD', 'receiving touchdowns', 'receiving touchdown'),
	...RUSHING,
	SNAPS
];

export const STAT_COLUMNS: Readonly<Record<Position, readonly StatColumn[]>> = {
	QB: [
		COMPLETIONS,
		stat('passing_yards', 'Yds', 'passing yards', 'passing yard'),
		stat('passing_touchdowns', 'TD', 'passing touchdowns', 'passing touchdown'),
		stat('interceptions', 'INT', 'interceptions', 'interception'),
		...RUSHING,
		FUMBLES
	],
	RB: [
		stat('carries', 'Car', 'carries', 'carry'),
		stat('rushing_yards', 'Yds', 'rushing yards', 'rushing yard'),
		stat('rushing_touchdowns', 'TD', 'rushing touchdowns', 'rushing touchdown'),
		...CATCHING,
		stat('receiving_yards', 'Rec yds', 'receiving yards', 'receiving yard'),
		stat('receiving_touchdowns', 'Rec TD', 'receiving touchdowns', 'receiving touchdown'),
		FUMBLES,
		SNAPS
	],
	WR: RECEIVER,
	TE: RECEIVER,
	K: [
		stat('field_goals_made', 'FG', 'field goals made', 'field goal made'),
		stat('extra_points_made', 'XP', 'extra points made', 'extra point made')
	],
	DST: [
		stat('sacks', 'Sacks', 'sacks', 'sack'),
		stat('defensive_interceptions', 'INT', 'interceptions', 'interception'),
		stat('defensive_touchdowns', 'TD', 'defensive touchdowns', 'defensive touchdown')
	]
};
