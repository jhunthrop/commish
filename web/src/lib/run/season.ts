/**
 * A player's season so far, as `players/<id>.json` carries it under `season`: the season line and a
 * game log with every week of the regular season, scored in one of the run's formats. Stat lines
 * come from the league's own records; nothing here is a projection.
 *
 * The stat fields are named as the research store names its metrics (snake_case), plus
 * `completions`, `snapShare` (his share of his team's offensive snaps, 0 to 1) and `points` (the
 * line scored in the block's format). A field is null when the records do not carry it.
 *
 * The parse checks the block against itself: every week of the regular season once and in order
 * with exactly one bye, statuses that agree with `through`, a stat line on played weeks only,
 * totals that are the played weeks' sums, and points a game as `pointsPerGameOf` rounds them. The
 * build's reader checks `weeks` against the run's schedule.
 */
import { z } from 'zod';
import { POINTS_PER_GAME_DECIMALS } from './decimals.ts';
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
 *   played    he has a stat line for the week, or offensive snaps with no stats row: the weekly
 *             release carries only players who recorded a stat, so that is a game with no touches,
 *             every counted stat 0, 0 points, and his snap share from the snaps
 *   inactive  no stat line and no snaps, and his club's game is final with its lines in the records
 *   bye       his club does not play
 *   upcoming  his club's game is not final, or its lines are not in the records yet */
export const GAME_STATUSES = ['played', 'inactive', 'bye', 'upcoming'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export { POINTS_PER_GAME_DECIMALS };
/** Fantasy points are kept to two decimals, the scoring's own rounding: whole cents. */
const CENTS = 100;
const CENTS_PER_TENTH = 10;
const TENTHS = 10;
/** Float slack when comparing sums of whole numbers or of shares. */
const EPSILON = 1e-9;

function sumCents(points: readonly number[]): number {
	return points.reduce((total, value) => total + Math.round(value * CENTS), 0);
}

/** The played weeks' points summed exactly, in whole cents. */
export function pointsTotalOf(points: readonly number[]): number {
	return sumCents(points) / CENTS;
}

/** Points a game as the run stores them and the page prints them: the exact mean of the played
 * weeks' points (summed in whole cents), rounded half up to one decimal. Null before his first
 * game. Another writer reproduces it as round_half_up(sum_cents / (games * 10)) / 10. */
export function pointsPerGameOf(points: readonly number[]): number | null {
	if (points.length === 0) return null;
	return Math.round(sumCents(points) / (points.length * CENTS_PER_TENTH)) / TENTHS;
}

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

const seasonShape = z.object({
	season: z.number().int(),
	/** The format every point in the block is scored in. */
	format: formatId,
	/** The regular season's length, the schedule's last week. The log has exactly this many rows. */
	weeks: z.number().int().min(1),
	/** The last week whose games are all final with their lines in the records, 0 before week 1's.
	 * No week up to it is upcoming. The page's "through week" prints it. */
	through: z.number().int().nonnegative(),
	/** Weeks played. */
	games: z.number().int().nonnegative(),
	/** pointsPerGameOf the played weeks, or null before his first game. */
	pointsPerGame: z.number().nullable(),
	/** Every played week summed, a field null when any played week's is null or he has no game.
	 * Snap share is his snaps over his team's across the played weeks. Points are pointsTotalOf. */
	totals: statLineSchema,
	/** Every week of the regular season, once, in order. */
	log: z.array(gameLogRowSchema).min(1)
});

type Season = z.infer<typeof seasonShape>;
type LogRow = z.infer<typeof gameLogRowSchema>;
type Fail = (message: string) => void;

function checkRow(row: LogRow, index: number, through: number, fail: Fail): void {
	const at = `Week ${String(row.week)}`;
	if (row.week !== index + 1) fail(`${at} sits at place ${String(index + 1)} in the log.`);
	const bye = row.status === 'bye';
	if (bye !== (row.opponent === null) || bye !== (row.home === null))
		fail(`${at}: a bye and only a bye has no opponent.`);
	if (row.status === 'upcoming' && row.week <= through)
		fail(`${at} is upcoming, but the records reach week ${String(through)}.`);
	const played = row.status === 'played';
	if (played && row.points === null) fail(`${at} is played but has no points.`);
	const lined = STAT_FIELDS.some((field) => row[field] !== null) || row.snapShare !== null;
	if (!played && (lined || row.points !== null))
		fail(`${at} is ${row.status} but carries a stat line.`);
}

/** Every week once and in order, exactly one bye, and nothing played after an upcoming week. */
function checkWeeks(season: Season, fail: Fail): void {
	const { log, weeks, through } = season;
	if (log.length !== weeks)
		fail(`The log has ${String(log.length)} weeks, the season ${String(weeks)}.`);
	if (through > weeks) fail(`The records reach week ${String(through)} of ${String(weeks)}.`);
	log.forEach((row, index) => {
		checkRow(row, index, through, fail);
	});
	const byes = log.filter((row) => row.status === 'bye').length;
	if (byes !== 1) fail(`The log has ${String(byes)} byes, a club has one.`);
	const firstUpcoming = log.findIndex((row) => row.status === 'upcoming');
	const late =
		firstUpcoming === -1
			? undefined
			: log
					.slice(firstUpcoming)
					.find((row) => row.status === 'played' || row.status === 'inactive');
	if (late) fail(`Week ${String(late.week)} is ${late.status} after an upcoming week.`);
}

/** Each counting total is the played weeks' sum, or null when any of them is null. */
function checkCounts(played: readonly LogRow[], totals: Season['totals'], fail: Fail): void {
	for (const field of STAT_FIELDS) {
		const values = played.map((row) => row[field]);
		const total = totals[field];
		if (values.includes(null)) {
			if (total !== null) fail(`Total ${field} is set though a played week has none.`);
			continue;
		}
		const sum = values.reduce<number>((acc, value) => acc + (value ?? 0), 0);
		if (total === null || Math.abs(total - sum) > EPSILON)
			fail(`Total ${field} is not the played weeks' sum, ${String(sum)}.`);
	}
}

/** Snap share over the played weeks is a weighted mean, so it sits between their least and most. */
function checkSnapShare(played: readonly LogRow[], total: number | null, fail: Fail): void {
	const shares = played.map((row) => row.snapShare);
	if (shares.includes(null)) {
		if (total !== null) fail('Total snap share is set though a played week has none.');
		return;
	}
	const known = shares.filter((share): share is number => share !== null);
	const inside =
		total !== null &&
		total >= Math.min(...known) - EPSILON &&
		total <= Math.max(...known) + EPSILON;
	if (!inside) fail('Total snap share is not a share of the played weeks.');
}

function checkTotals(season: Season, fail: Fail): void {
	const played = season.log.filter((row) => row.status === 'played');
	const points = played.flatMap((row) => (row.points === null ? [] : [row.points]));
	const { games, pointsPerGame, totals } = season;
	if (games !== played.length)
		fail(`games says ${String(games)}, the log plays ${String(played.length)}.`);
	if (played.length === 0) {
		const fields = [...STAT_FIELDS, 'snapShare', 'points'] as const;
		if (pointsPerGame !== null || fields.some((field) => totals[field] !== null))
			fail('A season with no games has an empty totals line and no points a game.');
		return;
	}
	checkCounts(played, totals, fail);
	checkSnapShare(played, totals.snapShare, fail);
	const total = pointsTotalOf(points);
	if (totals.points === null || Math.abs(totals.points - total) > EPSILON)
		fail(`The total points are not the played weeks' sum, ${String(total)}.`);
	const perGame = pointsPerGameOf(points);
	if (pointsPerGame !== perGame)
		fail(`Points a game are not the played weeks' mean as stored, ${String(perGame)}.`);
}

export const seasonSchema = seasonShape.superRefine((season, ctx) => {
	const fail: Fail = (message) => {
		ctx.addIssue({ code: 'custom', message });
	};
	checkWeeks(season, fail);
	checkTotals(season, fail);
});

export type StatLine = z.infer<typeof statLineSchema>;
export type GameLogRow = z.infer<typeof gameLogRowSchema>;
export type PlayerSeason = z.infer<typeof seasonSchema>;
