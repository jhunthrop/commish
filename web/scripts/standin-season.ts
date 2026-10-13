// THE STAND-IN'S SEASON BLOCK: each board player's season so far from the dev research store, in
// the run format's `season` shape (src/lib/run/season.ts).
//
// Sources, all real, read from the store's own rows:
//   research.player_week_observations   the stat lines (nflverse_player_week) and snap counts
//     (nflverse_snap_counts), the latest capture of each metric per week
//   research.player_week_teams          the club each player played for in each week he has a line
//   research.player_crosswalk           the board's provider ids to the store's gsis ids
//   the run's own schedule and clubs    each week's opponent and the byes, and nfl_games' kickoffs
//
// The rules, which the nightly keeps through the same fields:
//   A club's game is in the records when it is final and the store holds lines for that club that
//     week. `through` is the last week whose games are all in. "Final" here is the stand-in's own
//     estimate, four hours past the kickoff, because the dev copy's nfl_games marks every game
//     scheduled. The nightly uses the feed's final flag instead.
//   The player-week feed lands in two ingests: the stat line (the scoring stats and completions)
//     and the usage line (carries, targets, pass attempts and the team totals).
//   A week is played when he has a stat line, or offensive snaps with no stats row: the weekly
//     release carries only players who recorded a stat, so that is a game with no touches, every
//     counted stat 0 and 0 points. With neither, the week is inactive once his club's game is in
//     the records and upcoming before. A bye is a week his club does not play.
//   Within a played week, a stat with no row is zero only when that week has his row from the same
//     ingest and the store holds that metric for the week. Otherwise it is null (his usage line
//     never landed, or the metric is not loaded yet). A week with no stat line is never zeros.
//   A total is null when any played week's value is null, snap share included.
import type postgres from 'postgres';
import {
	STAT_FIELDS,
	pointsPerGameOf,
	pointsTotalOf,
	type GameLogRow,
	type PlayerSeason,
	type StatField,
	type StatLine
} from '../src/lib/run/season.ts';
import type { BoardRow, Club, Schedule } from '../src/lib/run/schema.ts';
import { computeFantasyPoints, rulesFor, type PointsLine } from './fantasy-points.ts';

const STAT_SOURCE = 'nflverse_player_week';
const SNAP_SOURCE = 'nflverse_snap_counts';
const SNAPS = 'offensive_snaps';
const TEAM_SNAPS = 'team_offensive_snaps';
/** The stand-in's own estimate of when a game is final: four hours after its kickoff. The dev
 * copy's nfl_games marks every game scheduled, so there is no final flag to read. The nightly reads
 * the feed's final flag and drops this. */
const GAME_LENGTH_MS = 4 * 60 * 60 * 1000;
/** The usage ingest's metrics. Every other metric of the player-week feed is the stat ingest's. */
const USAGE_METRICS: ReadonlySet<string> = new Set([
	'carries',
	'targets',
	'pass_attempts',
	'team_carries',
	'team_targets',
	'team_pass_attempts'
]);

function isUsage(metric: string): boolean {
	return USAGE_METRICS.has(metric);
}

/** Whether his week holds any row from the ingest that writes this metric. */
function hasIngest(line: Metrics, usage: boolean): boolean {
	return [...line.keys()].some((metric) => isUsage(metric) === usage);
}

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
	/** The regular season's length. */
	weeks: number;
	/** nflverse spells some clubs differently from the board. */
	canonicalClub: (code: string) => string;
	schedule: Schedule;
	clubs: readonly Club[];
	/** A club's kickoff in a week, from the slate, or null when it does not play. */
	kickoff: (club: string, week: number) => Date | null;
	now: Date;
}

type Metrics = ReadonlyMap<string, number>;
type ByWeek<T> = ReadonlyMap<number, T>;

interface StoreRead {
	/** By provider id, then week, per source: every metric captured for the week. */
	lines: Map<string, Map<number, Map<string, number>>>;
	snaps: Map<string, Map<number, Map<string, number>>>;
	/** By provider id, then week: the club he played for. */
	teams: Map<string, Map<number, string>>;
	/** By week: the stat metrics the store holds for that week. */
	carried: Map<number, Set<string>>;
	/** "CLUB:week" for every club with lines in the store that week. */
	clubWeeks: Set<string>;
}

function nest<T>(map: Map<string, Map<number, T>>, id: string, week: number, make: () => T): T {
	const byWeek = map.get(id) ?? new Map<number, T>();
	map.set(id, byWeek);
	const found = byWeek.get(week) ?? make();
	byWeek.set(week, found);
	return found;
}

async function readStore(
	sql: postgres.Sql,
	ids: readonly string[],
	inputs: SeasonInputs
): Promise<StoreRead> {
	const { season } = inputs;
	const rows = await sql<
		{ id: string; week: number; source: string; metric: string; value: number }[]
	>`
		select distinct on (o.player_id, o.week, o.source, o.metric)
			c.provider_player_id as id, o.week, o.source, o.metric, o.value
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
	const carried = await sql<{ week: number; metric: string }[]>`
		select distinct week, metric from research.player_week_observations
		where season = ${season} and source = ${STAT_SOURCE}`;
	const clubWeeks = await sql<{ week: number; team: string }[]>`
		select distinct week, team from research.player_week_teams where season = ${season}`;
	const read: StoreRead = {
		lines: new Map(),
		snaps: new Map(),
		teams: new Map(),
		carried: new Map(),
		clubWeeks: new Set(
			clubWeeks.map((row) => `${inputs.canonicalClub(row.team)}:${String(row.week)}`)
		)
	};
	for (const row of rows) {
		const into = row.source === STAT_SOURCE ? read.lines : read.snaps;
		nest(into, row.id, row.week, () => new Map<string, number>()).set(row.metric, row.value);
	}
	for (const row of teams) {
		const byWeek = read.teams.get(row.id) ?? new Map<number, string>();
		byWeek.set(row.week, inputs.canonicalClub(row.team));
		read.teams.set(row.id, byWeek);
	}
	for (const row of carried) {
		const metrics = read.carried.get(row.week) ?? new Set<string>();
		metrics.add(row.metric);
		read.carried.set(row.week, metrics);
	}
	return read;
}

const EMPTY_LINE: StatLine = {
	...(Object.fromEntries(STAT_FIELDS.map((field) => [field, null])) as Record<StatField, null>),
	snapShare: null,
	points: null
};

/** A club's game is in the records once it is final and the store holds that club's lines. */
function inRecords(club: string, week: number, inputs: SeasonInputs, store: StoreRead): boolean {
	const kickoff = inputs.kickoff(club, week);
	if (kickoff === null) return false;
	const final = kickoff.getTime() + GAME_LENGTH_MS <= inputs.now.getTime();
	return final && store.clubWeeks.has(`${club}:${String(week)}`);
}

/** The last week whose games are all in the records, counting from week 1 without a gap. */
function throughOf(inputs: SeasonInputs, store: StoreRead): number {
	let through = 0;
	for (let week = 1; week <= inputs.weeks; week += 1) {
		const playing = inputs.schedule.slates.filter((slate) =>
			slate.games.some((game) => game.week === week)
		);
		if (!playing.every((slate) => inRecords(slate.abbr, week, inputs, store))) break;
		through = week;
	}
	return through;
}

function snapShareOf(snaps: Metrics | undefined): number | null {
	const mine = snaps?.get(SNAPS);
	const team = snaps?.get(TEAM_SNAPS);
	return mine === undefined || team === undefined || team === 0 ? null : mine / team;
}

/** A played week's line: what the store holds, zero for a metric with no row when his week has a
 * row from the same ingest and the store holds the metric that week, null otherwise. */
function lineOf(
	line: Metrics,
	snaps: Metrics | undefined,
	carried: ReadonlySet<string>,
	score: (line: PointsLine) => number
): StatLine {
	// Snaps with no stats row is a game with no touches: the weekly release carries only players who
	// recorded a stat, so both ingests read as zero lines.
	const noTouches = !hasIngest(line, false);
	const value = (field: string): number | null =>
		line.get(field) ??
		((noTouches || hasIngest(line, isUsage(field))) && carried.has(field) ? 0 : null);
	const counts = Object.fromEntries(STAT_FIELDS.map((field) => [field, value(field)])) as Record<
		StatField,
		number | null
	>;
	const pointsLine = Object.fromEntries(
		POINTS_FIELDS.map((field) => [field, counts[field] ?? 0])
	) as unknown as PointsLine;
	return { ...counts, snapShare: snapShareOf(snaps), points: score(pointsLine) };
}

/** The played weeks summed, each field null when any played week's is null. */
function totalsOf(played: readonly StatLine[], snaps: readonly (Metrics | undefined)[]): StatLine {
	if (played.length === 0) return EMPTY_LINE;
	const sum = (field: StatField): number | null =>
		played.some((line) => line[field] === null)
			? null
			: played.reduce((total, line) => total + (line[field] ?? 0), 0);
	const snapped = snaps.every((week) => snapShareOf(week) !== null);
	const of = (metric: string): number =>
		snaps.reduce((total, week) => total + (week?.get(metric) ?? 0), 0);
	return {
		...(Object.fromEntries(STAT_FIELDS.map((field) => [field, sum(field)])) as Record<
			StatField,
			number | null
		>),
		snapShare: snapped ? of(SNAPS) / of(TEAM_SNAPS) : null,
		points: pointsTotalOf(played.map((line) => line.points ?? 0))
	};
}

interface PlayerRead {
	row: BoardRow;
	lines: ByWeek<Metrics>;
	snaps: ByWeek<Metrics>;
	teams: ByWeek<string>;
}

interface Context {
	inputs: SeasonInputs;
	store: StoreRead;
	byes: ReadonlyMap<string, number | null>;
	score: (line: PointsLine) => number;
}

/** One week for him, by the rules in the header. */
function weekRow(week: number, player: PlayerRead, context: Context): GameLogRow {
	const { inputs, store } = context;
	const { row } = player;
	const team = player.teams.get(week) ?? row.team;
	const game = inputs.schedule.slates
		.find((slate) => slate.abbr === team)
		?.games.find((candidate) => candidate.week === week);
	// Played means a stat line, or offensive snaps with no stats row (a game with no touches).
	const found = player.lines.get(week) ?? new Map<string, number>();
	const snapped = (player.snaps.get(week)?.get(SNAPS) ?? 0) > 0;
	const line = hasIngest(found, false) || snapped ? found : undefined;
	if (!game) {
		if (context.byes.get(team) !== week)
			throw new Error(`${team} has no week ${String(week)} game and it is not their bye.`);
		if (line) throw new Error(`${row.name} has a week ${String(week)} line on ${team}'s bye.`);
		return { ...EMPTY_LINE, week, opponent: null, home: null, status: 'bye' };
	}
	const where = { week, opponent: game.opponent, home: game.home };
	if (line) {
		const carried = store.carried.get(week) ?? new Set<string>();
		const stats = lineOf(line, player.snaps.get(week), carried, context.score);
		return { ...stats, ...where, status: 'played' };
	}
	const status = inRecords(team, week, inputs, store) ? 'inactive' : 'upcoming';
	return { ...EMPTY_LINE, ...where, status };
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
		inputs
	);
	const rules = rulesFor(inputs.format);
	const byes = new Map(inputs.clubs.map((club) => [club.abbr, club.bye]));
	const through = throughOf(inputs, store);
	const weeks = Array.from({ length: inputs.weeks }, (_, i) => i + 1);
	const empty = new Map<number, never>();
	return new Map(
		rows.map((row) => {
			const player: PlayerRead = {
				row,
				lines: store.lines.get(row.id) ?? empty,
				snaps: store.snaps.get(row.id) ?? empty,
				teams: store.teams.get(row.id) ?? empty
			};
			const score = (line: PointsLine): number => computeFantasyPoints(line, row.position, rules);
			const log = weeks.map((week) => weekRow(week, player, { inputs, store, byes, score }));
			const played = log.filter((entry) => entry.status === 'played');
			const season: PlayerSeason = {
				season: inputs.season,
				format: inputs.format,
				weeks: inputs.weeks,
				through,
				games: played.length,
				pointsPerGame: pointsPerGameOf(played.map((entry) => entry.points ?? 0)),
				totals: totalsOf(
					played,
					played.map((entry) => player.snaps.get(entry.week))
				),
				log
			};
			return [row.id, season];
		})
	);
}
