// THE STAND-IN'S SEASON BLOCK: each board player's season so far from the dev research store, in
// the run format's `season` shape (src/lib/run/season.ts).
//
// Sources, all real, read from the store's own rows:
//   research.player_week_observations   the stat lines (nflverse_player_week) and snap counts
//     (nflverse_snap_counts), the latest capture of each metric per week
//   research.player_week_teams          the club he played for each week he has a line
//   research.player_crosswalk           the board's provider ids to the store's gsis ids
//   the run's own schedule and clubs    each week's opponent and the byes
//
// Rules the stand-in chose, which the nightly replaces through the same fields:
//   The records reach the last week any stat line is stored for. A week up to it with no line is
//     inactive, a week after it is upcoming.
//   In a played week, a metric the store carries but has no row for is zero (the feed writes no row
//     for a stat a player did not record). A metric the store does not carry at all is null.
//   A total is null when any played week's value is null.
import type postgres from 'postgres';
import {
	STAT_FIELDS,
	type GameLogRow,
	type PlayerSeason,
	type StatLine
} from '../src/lib/run/season.ts';
import type { BoardRow, Club, Schedule } from '../src/lib/run/schema.ts';
import { computeFantasyPoints, rulesFor, type PointsLine } from './fantasy-points.ts';

const STAT_SOURCE = 'nflverse_player_week';
const SNAP_SOURCE = 'nflverse_snap_counts';
const SNAPS = 'offensive_snaps';
const TEAM_SNAPS = 'team_offensive_snaps';

/** The fourteen fields every points line carries, the rest of STAT_FIELDS being counts only. */
const POINTS_FIELDS = [
	'passing_yards',
	'passing_touchdowns',
	'interceptions',
	'rushing_yards',
	'rushing_touchdowns',
	'receiving_yards',
	'receiving_touchdowns',
	'receptions',
	'fumbles_lost',
	'field_goals_made',
	'extra_points_made',
	'sacks',
	'defensive_interceptions',
	'defensive_touchdowns'
] as const satisfies readonly (keyof PointsLine)[];

export interface SeasonInputs {
	season: number;
	/** The format every point is scored in. */
	format: string;
	lastWeek: number;
	/** nflverse spells some clubs differently from the board. */
	canonicalClub: (code: string) => string;
	schedule: Schedule;
	clubs: readonly Club[];
}

type Metrics = Map<string, number>;

interface StoreRead {
	/** By provider id, then week: every metric captured for the week. */
	weeks: Map<string, Map<number, Metrics>>;
	/** By provider id, then week: the club he played for. */
	teams: Map<string, Map<number, string>>;
	/** The metrics the store carries this season. */
	carried: Set<string>;
	/** The last week any stat line is stored for. */
	throughWeek: number;
}

async function readStore(
	sql: postgres.Sql,
	ids: readonly string[],
	season: number
): Promise<StoreRead> {
	const lines = await sql<{ id: string; week: number; metric: string; value: number }[]>`
		select distinct on (o.player_id, o.week, o.source, o.metric)
			c.provider_player_id as id, o.week, o.metric, o.value
		from research.player_week_observations o
		join research.player_crosswalk c on c.player_id = o.player_id
		where o.season = ${season} and o.source in (${STAT_SOURCE}, ${SNAP_SOURCE})
			and c.provider_player_id = any(${ids as string[]})
		order by o.player_id, o.week, o.source, o.metric, o.as_of desc`;
	const teams = await sql<{ id: string; week: number; team: string }[]>`
		select distinct on (t.player_id, t.week) c.provider_player_id as id, t.week, t.team
		from research.player_week_teams t
		join research.player_crosswalk c on c.player_id = t.player_id
		where t.season = ${season} and c.provider_player_id = any(${ids as string[]})
		order by t.player_id, t.week, t.as_of desc`;
	const carried = await sql<{ metric: string }[]>`
		select distinct metric from research.player_week_observations
		where season = ${season} and source in (${STAT_SOURCE}, ${SNAP_SOURCE})`;
	const [through] = await sql<{ week: number | null }[]>`
		select max(week) as week from research.player_week_observations
		where season = ${season} and source = ${STAT_SOURCE}`;
	const weeks = new Map<string, Map<number, Metrics>>();
	for (const row of lines) {
		const byWeek = weeks.get(row.id) ?? new Map<number, Metrics>();
		const metrics = byWeek.get(row.week) ?? new Map<string, number>();
		metrics.set(row.metric, row.value);
		byWeek.set(row.week, metrics);
		weeks.set(row.id, byWeek);
	}
	const teamWeeks = new Map<string, Map<number, string>>();
	for (const row of teams) {
		const byWeek = teamWeeks.get(row.id) ?? new Map<number, string>();
		byWeek.set(row.week, row.team);
		teamWeeks.set(row.id, byWeek);
	}
	return {
		weeks,
		teams: teamWeeks,
		carried: new Set(carried.map((row) => row.metric)),
		throughWeek: through?.week ?? 0
	};
}

const EMPTY_LINE: StatLine = {
	...(Object.fromEntries(STAT_FIELDS.map((field) => [field, null])) as Record<
		(typeof STAT_FIELDS)[number],
		null
	>),
	snapShare: null,
	points: null
};

function round(value: number, places: number): number {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}

/** A played week's line: what the store holds, zero for a carried metric with no row, null for one
 * the store does not carry. */
function lineOf(
	metrics: Metrics,
	carried: ReadonlySet<string>,
	score: (line: PointsLine) => number
): StatLine {
	const value = (field: string): number | null =>
		metrics.get(field) ?? (carried.has(field) ? 0 : null);
	const counts = Object.fromEntries(STAT_FIELDS.map((field) => [field, value(field)])) as Record<
		(typeof STAT_FIELDS)[number],
		number | null
	>;
	const pointsLine = Object.fromEntries(
		POINTS_FIELDS.map((field) => [field, counts[field] ?? 0])
	) as unknown as PointsLine;
	const snaps = metrics.get(SNAPS);
	const teamSnaps = metrics.get(TEAM_SNAPS);
	return {
		...counts,
		snapShare:
			snaps === undefined || teamSnaps === undefined || teamSnaps === 0 ? null : snaps / teamSnaps,
		points: score(pointsLine)
	};
}

function totalsOf(played: readonly Metrics[], lines: readonly StatLine[]): StatLine {
	if (lines.length === 0) return EMPTY_LINE;
	const sum = (field: (typeof STAT_FIELDS)[number] | 'points'): number | null =>
		lines.some((line) => line[field] === null)
			? null
			: round(
					lines.reduce((total, line) => total + (line[field] ?? 0), 0),
					2
				);
	const snapWeeks = played.filter((metrics) => metrics.has(SNAPS) && metrics.has(TEAM_SNAPS));
	const teamSnaps = snapWeeks.reduce((total, metrics) => total + (metrics.get(TEAM_SNAPS) ?? 0), 0);
	const snaps = snapWeeks.reduce((total, metrics) => total + (metrics.get(SNAPS) ?? 0), 0);
	return {
		...(Object.fromEntries(STAT_FIELDS.map((field) => [field, sum(field)])) as Record<
			(typeof STAT_FIELDS)[number],
			number | null
		>),
		snapShare: teamSnaps === 0 ? null : snaps / teamSnaps,
		points: sum('points')
	};
}

interface PlayerRead {
	row: BoardRow;
	byWeek: ReadonlyMap<number, Metrics>;
	teamByWeek: ReadonlyMap<number, string>;
}

/** One week for him: a bye when his club has no game (as clubs.json says), played with a line,
 * inactive with none once the records reach the week, upcoming after. */
function weekRow(
	week: number,
	player: PlayerRead,
	inputs: SeasonInputs,
	context: {
		store: StoreRead;
		byes: ReadonlyMap<string, number | null>;
		score: (line: PointsLine) => number;
	}
): GameLogRow {
	const { row, byWeek, teamByWeek } = player;
	const team = inputs.canonicalClub(teamByWeek.get(week) ?? row.team);
	const game = inputs.schedule.slates
		.find((slate) => slate.abbr === team)
		?.games.find((candidate) => candidate.week === week);
	const metrics = byWeek.get(week);
	if (!game) {
		if (context.byes.get(team) !== week)
			throw new Error(`${team} has no week ${String(week)} game and it is not their bye.`);
		if (metrics) throw new Error(`${row.name} has a week ${String(week)} line on ${team}'s bye.`);
		return { ...EMPTY_LINE, week, opponent: null, home: null, status: 'bye' };
	}
	const where = { week, opponent: game.opponent, home: game.home };
	if (metrics)
		return { ...lineOf(metrics, context.store.carried, context.score), ...where, status: 'played' };
	return {
		...EMPTY_LINE,
		...where,
		status: week <= context.store.throughWeek ? 'inactive' : 'upcoming'
	};
}

/** Each board player's season block, keyed by his id. */
export async function seasonBlocks(
	sql: postgres.Sql,
	rows: readonly BoardRow[],
	inputs: SeasonInputs
): Promise<Map<string, PlayerSeason>> {
	const store = await readStore(
		sql,
		rows.map((row) => row.id),
		inputs.season
	);
	const rules = rulesFor(inputs.format);
	const byes = new Map(inputs.clubs.map((club) => [club.abbr, club.bye]));
	const weeks = Array.from({ length: inputs.lastWeek }, (_, i) => i + 1);
	return new Map(
		rows.map((row) => {
			const player: PlayerRead = {
				row,
				byWeek: store.weeks.get(row.id) ?? new Map<number, Metrics>(),
				teamByWeek: store.teams.get(row.id) ?? new Map<number, string>()
			};
			const score = (line: PointsLine): number => computeFantasyPoints(line, row.position, rules);
			const log = weeks.map((week) => weekRow(week, player, inputs, { store, byes, score }));
			const playedRows = log.filter((entry) => entry.status === 'played');
			const totals = totalsOf(
				playedRows.flatMap((entry) => player.byWeek.get(entry.week) ?? []),
				playedRows
			);
			const games = playedRows.length;
			const season: PlayerSeason = {
				season: inputs.season,
				format: inputs.format,
				games,
				pointsPerGame:
					games === 0 || totals.points === null ? null : round(totals.points / games, 2),
				totals,
				log
			};
			return [row.id, season];
		})
	);
}
