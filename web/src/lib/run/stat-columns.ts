/**
 * The game log's columns by position, in a drafter's words: a short head for the table and the full
 * words the season line captions each number with. Points close every position's columns and are
 * added by the view, which knows the format.
 */
import { count } from '#lib/format/number.ts';
import type { Position } from '#lib/types/player.ts';
import type { StatField, StatLine } from './season.ts';

/** What a cell prints when the records do not carry the number. */
export const NO_FIGURE = '–';

export interface StatColumn {
	short: string;
	full: string;
	/** Whether the column needs a note in the basis line. */
	snaps?: true;
	value: (line: StatLine) => string;
}

const PERCENT = 100;

function figure(value: number | null): string {
	return value === null ? NO_FIGURE : count(value);
}

function stat(field: StatField, short: string, full: string): StatColumn {
	return { short, full, value: (line) => figure(line[field]) };
}

const COMPLETIONS: StatColumn = {
	short: 'Comp/att',
	full: 'completions of attempts',
	value: (line) => `${figure(line.completions)}/${figure(line.pass_attempts)}`
};

const SNAPS: StatColumn = {
	short: 'Snap %',
	full: 'share of snaps',
	snaps: true,
	value: (line) =>
		line.snapShare === null ? NO_FIGURE : `${String(Math.round(line.snapShare * PERCENT))}%`
};

const RUSHING = [
	stat('carries', 'Car', 'carries'),
	stat('rushing_yards', 'Rush yds', 'rushing yards'),
	stat('rushing_touchdowns', 'Rush TD', 'rushing touchdowns')
];

const FUMBLES = stat('fumbles_lost', 'Fum', 'fumbles lost');

const CATCHING = [stat('targets', 'Tgt', 'targets'), stat('receptions', 'Rec', 'catches')];

const RECEIVER: readonly StatColumn[] = [
	...CATCHING,
	stat('receiving_yards', 'Yds', 'receiving yards'),
	stat('receiving_touchdowns', 'TD', 'receiving touchdowns'),
	...RUSHING,
	SNAPS
];

export const STAT_COLUMNS: Readonly<Record<Position, readonly StatColumn[]>> = {
	QB: [
		COMPLETIONS,
		stat('passing_yards', 'Yds', 'passing yards'),
		stat('passing_touchdowns', 'TD', 'passing touchdowns'),
		stat('interceptions', 'INT', 'interceptions'),
		...RUSHING,
		FUMBLES
	],
	RB: [
		stat('carries', 'Car', 'carries'),
		stat('rushing_yards', 'Yds', 'rushing yards'),
		stat('rushing_touchdowns', 'TD', 'rushing touchdowns'),
		...CATCHING,
		stat('receiving_yards', 'Rec yds', 'receiving yards'),
		stat('receiving_touchdowns', 'Rec TD', 'receiving touchdowns'),
		FUMBLES,
		SNAPS
	],
	WR: RECEIVER,
	TE: RECEIVER,
	K: [
		stat('field_goals_made', 'FG', 'field goals made'),
		stat('extra_points_made', 'XP', 'extra points made')
	],
	DST: [
		stat('sacks', 'Sacks', 'sacks'),
		stat('defensive_interceptions', 'INT', 'interceptions'),
		stat('defensive_touchdowns', 'TD', 'defensive touchdowns')
	]
};
