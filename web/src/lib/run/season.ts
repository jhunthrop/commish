/**
 * A player's season so far, as `players/<id>.json` carries it under `season`: the season line and a
 * game log with every week of the regular season, scored in one of the run's formats. Stat lines
 * come from the league's own records; nothing here is a projection.
 *
 * The stat fields are named as the research store names its metrics (snake_case), plus
 * `completions`, `snapShare` (his share of his team's offensive snaps, 0 to 1) and `points` (the
 * line scored in the block's format). A field is null when the store does not carry it.
 *
 * The parse checks the block against itself: the weeks run 1 to the season's last in order, a bye
 * and only a bye has no opponent, only a played week has a stat line, `games` counts the played
 * weeks, and `pointsPerGame` is the mean of their points to the precision a page prints.
 */
import { z } from 'zod';
import { club, formatId } from './primitives.ts';

/** Every counting stat a line carries, in the store's names. */
export const STAT_FIELDS = [
	'pass_attempts',
	'completions',
	'passing_yards',
	'passing_touchdowns',
	'interceptions',
	'carries',
	'rushing_yards',
	'rushing_touchdowns',
	'targets',
	'receptions',
	'receiving_yards',
	'receiving_touchdowns',
	'fumbles_lost',
	'field_goals_made',
	'extra_points_made',
	'sacks',
	'defensive_interceptions',
	'defensive_touchdowns'
] as const;
export type StatField = (typeof STAT_FIELDS)[number];

/** Where a week stands for him.
 *   played    he has a stat line for the week
 *   inactive  on a roster, no stat line, and the week's games are in the records
 *   bye       his club does not play
 *   upcoming  the week's stat lines are not in the records yet */
export const GAME_STATUSES = ['played', 'inactive', 'bye', 'upcoming'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/** Points a game print to one decimal, so the parse holds the run to that precision. */
export const POINTS_PER_GAME_DECIMALS = 1;
/** Fantasy points are kept to two decimals, the scoring's own rounding. */
const POINTS_DECIMALS = 2;

const stat = z.number().nullable();
const statFields = Object.fromEntries(STAT_FIELDS.map((field) => [field, stat])) as Record<
	StatField,
	typeof stat
>;

export const statLineSchema = z.object({
	...statFields,
	snapShare: z.number().min(0).max(1).nullable(),
	points: stat
});

export const gameLogRowSchema = statLineSchema.extend({
	week: z.number().int().min(1),
	/** The club he plays, or null on his bye. */
	opponent: club.nullable(),
	/** True at home, false away, null on his bye. */
	home: z.boolean().nullable(),
	status: z.enum(GAME_STATUSES)
});

type LogRow = z.infer<typeof gameLogRowSchema>;
type Fail = (message: string) => void;

function checkRow(row: LogRow, index: number, fail: Fail): void {
	const at = `Week ${String(row.week)}`;
	if (row.week !== index + 1) fail(`${at} sits at place ${String(index + 1)} in the log.`);
	const bye = row.status === 'bye';
	if (bye !== (row.opponent === null) || bye !== (row.home === null))
		fail(`${at}: a bye and only a bye has no opponent.`);
	const played = row.status === 'played';
	if (played && row.points === null) fail(`${at} is played but has no points.`);
	const lined = STAT_FIELDS.some((field) => row[field] !== null) || row.snapShare !== null;
	if (!played && (lined || row.points !== null))
		fail(`${at} is ${row.status} but carries a stat line.`);
}

function checkOrder(log: readonly LogRow[], fail: Fail): void {
	const firstUpcoming = log.findIndex((row) => row.status === 'upcoming');
	if (firstUpcoming === -1) return;
	const late = log
		.slice(firstUpcoming)
		.find((row) => row.status !== 'upcoming' && row.status !== 'bye');
	if (late) fail(`Week ${String(late.week)} is ${late.status} after an upcoming week.`);
}

/** Float slack for a sum that was rounded in a different order. */
const EPSILON = 1e-9;

/** a is b to the given precision: within half of its last printed place. */
function same(a: number, b: number, decimals: number): boolean {
	return Math.abs(a - b) <= 0.5 * 10 ** -decimals + EPSILON;
}

export const seasonSchema = z
	.object({
		season: z.number().int(),
		/** The format every point in the block is scored in. */
		format: formatId,
		/** Weeks played. */
		games: z.number().int().nonnegative(),
		/** The mean of the played weeks' points, or null before his first game. */
		pointsPerGame: z.number().nullable(),
		/** Every played week summed. Snap share is his snaps over his team's, across those weeks. */
		totals: statLineSchema,
		/** Every week of the regular season, in order. */
		log: z.array(gameLogRowSchema).min(1)
	})
	.superRefine((season, ctx) => {
		const fail: Fail = (message) => {
			ctx.addIssue({ code: 'custom', message });
		};
		season.log.forEach((row, index) => {
			checkRow(row, index, fail);
		});
		checkOrder(season.log, fail);
		const points = season.log.flatMap((row) =>
			row.status === 'played' && row.points !== null ? [row.points] : []
		);
		if (season.games !== points.length)
			fail(`games says ${String(season.games)}, the log plays ${String(points.length)}.`);
		const sum = points.reduce((total, value) => total + value, 0);
		const { pointsPerGame, totals } = season;
		if (points.length === 0) {
			if (pointsPerGame !== null || totals.points !== null)
				fail('A season with no games has no points.');
			return;
		}
		if (totals.points === null || !same(totals.points, sum, POINTS_DECIMALS))
			fail(`The total points are not the sum of the played weeks, ${sum.toFixed(2)}.`);
		const mean = sum / points.length;
		if (pointsPerGame === null || !same(pointsPerGame, mean, POINTS_PER_GAME_DECIMALS))
			fail(`Points a game are not the played weeks' mean, ${mean.toFixed(2)}.`);
	});

export type StatLine = z.infer<typeof statLineSchema>;
export type GameLogRow = z.infer<typeof gameLogRowSchema>;
export type PlayerSeason = z.infer<typeof seasonSchema>;
