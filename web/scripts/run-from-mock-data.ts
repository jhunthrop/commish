// THE STAND-IN RUN. No nightly run exists yet, so this converts the real 2026 data the approved
// mocks were built from into the run format, once, so every nightly page can be built and measured.
// The first real run replaces it with no code change: point PUBLIC_RUN_ID at the real run (or move
// runs/latest.json) and delete this script.
//
// Sources, all real, nothing invented, every date read from the data's own stamps:
//   docs/design/mocks/2026-10-12-commish/data/board-ppr.csv   the 400-row 2026 PPR board (its ADP
//     column is not used: nothing in the store dates it)
//   docs/design/mocks/2026-10-12-commish/data/capsules.csv    the written capsules
//   the local dev database (STANDIN_DATABASE_URL, the compose dev database by default):
//     adp_snapshots: the PPR 12-team captures taken before the season's first kickoff, averaged
//     nfl_games: the 2026 slate, the byes and the first kickoff
//     team_week_observations (vegas_win_totals): each club's latest published season win total
//     register_freeze_rows and register_grade_rows: the record as it stands
//     research.player_week_observations and friends: each player's season so far
//     (standin-season.ts, scored with fantasy-points.ts)
//   research-ts/src/domain/nfl-team-names.ts for each club's city and nickname
//
// Vendors and feeds go in the manifest's sources block as provenance. No screen names them.
//
// Methods the stand-in chose, which the nightly replaces through the same fields:
//   ADP is the mean of each player's preseason captures, the window their first and last stamps.
//   Schedule strength is the mean of a club's opponents' published season win totals.
//
// Derivations mirror the mocks' build (docs/design/mocks/2026-10-12-commish/build/data.py): tier is
// the CSV's zero-based tier plus one, our rank sorts by points over replacement, and its round is
// the rank over 12 rounded up.
//
// Usage: npm run standin              writes web/.runs/runs/<runId>/ and web/.runs/runs/latest.json
//        npm run standin -- --upload  also puts the run in the R2 bucket (needs CLOUDFLARE_API_TOKEN
//                                     and CLOUDFLARE_ACCOUNT_ID, or R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY)
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { parse } from 'csv-parse/sync';
import postgres from 'postgres';
import type { z } from 'zod';
import { NFL_TEAM_NAMES } from '../../research-ts/src/domain/nfl-team-names.ts';
import {
	LATEST_POINTER,
	RUN_PATHS,
	adpSchema,
	boardSchema,
	clubsSchema,
	indexSchema,
	latestPointerSchema,
	manifestSchema,
	playerSchema,
	recordSchema,
	scheduleSchema,
	type Adp,
	type BoardRow,
	type Capsule,
	type Club,
	type Format,
	type Game,
	type IndexEntry,
	type Manifest,
	type Player,
	type RecordWeek,
	type RunRecord,
	type Schedule,
	type Source,
	type Window
} from '../src/lib/run/schema.ts';
import { POSITIONS, type Position } from '../src/lib/types/player.ts';
import { bucketUrl, credentialsFromToken } from './r2.ts';
import { checkRunSeasons } from '../src/lib/run/season-checks.ts';
import { seasonBlocks } from './standin-season.ts';
import type { PlayerSeason } from '../src/lib/run/season.ts';

const RUN_ID = '2026-10-12T00-standin';
const SEASON = 2026;
const TEAMS = 12;
const LAST_WEEK = 18;
const CLUB_COUNT = 32;
const MOCK_DATA = new URL('../../docs/design/mocks/2026-10-12-commish/data/', import.meta.url);
const OUT_ROOT = new URL('../.runs/', import.meta.url);
const DEFAULT_DATABASE_URL = 'postgres://commish:commish@localhost:5432/commish';
const IMPLEMENTATION = 'TypeScript core';
const SERVED_REGISTER_BOARD = 'commish_board_v9_ppr_12';
const ADP_FEED = 'ffc_adp_ppr_12';
const ADP_VENDOR = 'Fantasy Football Calculator, 12-team PPR ADP';
const WIN_TOTALS_FEED = 'vegas_win_totals';
const WIN_TOTALS_VENDOR =
	'Published preseason season win totals, the nfelo win_totals.csv (greerreNFL/nfelosrs)';
/** Why the record lists a week whose first kickoff passed with no board frozen. The ledger records
 * the nightly run's failures over weeks 3 to 5, the only weeks the stand-in finds missed. The
 * nightly writes the real reason for each week it misses. */
const MISSED_WEEK_NOTE = 'Our nightly run failed that week.';

const FORMAT: Format = {
	id: 'ppr-12',
	label: 'PPR',
	unit: 'PPR pts',
	teams: TEAMS,
	basis: [
		`PPR, full ${String(SEASON)} season`,
		'ranked by points over replacement',
		'tiers drawn within each position'
	]
};

const ADP_SOURCE_ID = 'ppr-preseason';
const ADP_DRAFTS = 'PPR drafts';

/** The approved player mock's pull figures, each verified in its capsule by the mock's build and
 * again here by the schema. The writer emits them for every capsule once the nightly runs. */
const PULL_FIGURES: Readonly<Record<string, Capsule['pulls']>> = {
	'Chris Olave': [
		{ figure: '29%', caption: 'target share last season' },
		{ figure: '49.7%', caption: "of the team's air yards" },
		{ figure: '16.8', caption: 'PPR points from the end of his tier to the next' }
	]
};

/** Capsules the approved direction held back as writer defects (direction.html, "What did not
 * reconcile"): Chase Brown's calls him 32nd overall and carries an unedited writer aside. */
const HELD_CAPSULES = new Set(['Chase Brown']);

/** nflverse spells two clubs differently from the board. */
const CLUB_ALIASES: Readonly<Record<string, string>> = { LA: 'LAR', WAS: 'WSH' };

type BoardCsv = Record<
	| 'rank'
	| 'position_rank'
	| 'name'
	| 'position'
	| 'nfl_team'
	| 'adp'
	| 'headshot_url'
	| 'projected_points'
	| 'value_over_replacement'
	| 'expected_games'
	| 'floor_points'
	| 'median_points'
	| 'ceiling_points'
	| 'tier'
	| 'player_id'
	| 'gsis',
	string
>;
type CapsuleCsv = Record<'player_id' | 'name' | 'body_full', string>;

async function readCsv<T>(file: string): Promise<T[]> {
	const text = await readFile(new URL(file, MOCK_DATA), 'utf8');
	return parse<T>(text, { columns: true, skip_empty_lines: true });
}

function num(value: string, what: string): number {
	const parsed = Number(value);
	if (value.trim() === '' || !Number.isFinite(parsed)) throw new Error(`${what} is not a number.`);
	return parsed;
}

function round(value: number, places = 2): number {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}

function isPosition(value: string): value is Position {
	return (POSITIONS as readonly string[]).includes(value);
}

function slugOf(name: string): string {
	return name
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Slugs from names, with the position and club added only where two players share a name. */
function slugsFor(rows: readonly BoardCsv[]): Map<string, string> {
	const counts = new Map<string, number>();
	for (const row of rows) counts.set(slugOf(row.name), (counts.get(slugOf(row.name)) ?? 0) + 1);
	return new Map(
		rows.map((row) => {
			const base = slugOf(row.name);
			const slug =
				(counts.get(base) ?? 0) > 1
					? `${base}-${row.position.toLowerCase()}-${row.nfl_team.toLowerCase()}`
					: base;
			return [row.player_id, slug];
		})
	);
}

function boardRows(csv: readonly BoardCsv[], adpByGsis: ReadonlyMap<string, number>): BoardRow[] {
	const slugs = slugsFor(csv);
	const byValue = [...csv].sort(
		(a, b) =>
			num(b.value_over_replacement, 'vor') - num(a.value_over_replacement, 'vor') ||
			num(a.rank, 'rank') - num(b.rank, 'rank')
	);
	return byValue.map((row, i) => {
		if (!isPosition(row.position)) throw new Error(`${row.name} plays ${row.position}.`);
		const ourRank = i + 1;
		return {
			id: row.player_id,
			slug: slugs.get(row.player_id) ?? slugOf(row.name),
			name: row.name,
			position: row.position,
			positionRank: num(row.position_rank, `${row.name} position rank`),
			team: row.nfl_team,
			headshot: row.headshot_url,
			ourRank,
			vorRound: Math.ceil(ourRank / TEAMS),
			adp: adpByGsis.get(row.gsis) ?? null,
			projected: round(num(row.projected_points, `${row.name} points`)),
			vor: round(num(row.value_over_replacement, `${row.name} vor`)),
			expectedGames: round(num(row.expected_games, `${row.name} games`)),
			floor: round(num(row.floor_points, `${row.name} floor`)),
			median: round(num(row.median_points, `${row.name} median`)),
			ceiling: round(num(row.ceiling_points, `${row.name} ceiling`)),
			tier: num(row.tier, `${row.name} tier`) + 1
		};
	});
}

function playerPages(
	rows: readonly BoardRow[],
	capsules: readonly CapsuleCsv[],
	seasons: ReadonlyMap<string, PlayerSeason>
): Player[] {
	const byId = new Map(capsules.map((capsule) => [capsule.player_id, capsule]));
	return rows.map((row) => {
		const season = seasons.get(row.id);
		if (!season) throw new Error(`${row.name} has no season block.`);
		const { id, slug, name, position, team, headshot, ...numbers } = row;
		const written = byId.get(id);
		const capsule: Capsule | null =
			written && !HELD_CAPSULES.has(name)
				? { body: written.body_full.trim(), pulls: PULL_FIGURES[name] ?? [] }
				: null;
		return {
			id,
			slug,
			name,
			position,
			team,
			headshot,
			formats: { [FORMAT.id]: numbers },
			capsule,
			season
		};
	});
}

function canonicalClub(code: string): string {
	return CLUB_ALIASES[code] ?? code;
}

interface GameRow {
	week: number;
	home_nfl_team: string;
	away_nfl_team: string;
	game_date: string;
	kickoff_et: string;
}

interface Preseason {
	/** Each player's mean preseason ADP, by gsis id, to one decimal. */
	byGsis: Map<string, number>;
	window: Window;
}

const EASTERN_OFFSET = new Intl.DateTimeFormat('en-US', {
	timeZone: 'America/New_York',
	timeZoneName: 'longOffset'
});

/** The Eastern offset on a game's date ("-04:00" under daylight time, "-05:00" after), read at
 * noon UTC, hours clear of the 2 AM change. */
function easternOffset(date: string): string {
	const noon = new Date(`${date}T12:00:00Z`);
	const name = EASTERN_OFFSET.formatToParts(noon).find((part) => part.type === 'timeZoneName');
	const offset = /GMT([+-]\d{2}:\d{2})/.exec(name?.value ?? '')?.[1];
	if (!offset) throw new Error(`No Eastern offset for ${date}.`);
	return offset;
}

/** The slate's word for a late-season kickoff the league has not set yet. */
const KICKOFF_NOT_SET = 'TBD';

/** A game's kickoff, from nfl_games' date ("20260909") and Eastern time ("8:20p"). A kickoff not
 * set yet counts from the start of its day, the earliest it can be. */
function kickoffOf(game: GameRow): Date {
	const d = game.game_date;
	const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
	if (game.kickoff_et === KICKOFF_NOT_SET)
		return new Date(`${date}T00:00:00${easternOffset(date)}`);
	const time = /^(\d{1,2}):(\d{2})([ap])$/.exec(game.kickoff_et);
	if (!time)
		throw new Error(`Week ${String(game.week)} has an unreadable kickoff "${game.kickoff_et}".`);
	const [, hourText = '', minute = '', half = ''] = time;
	const hour = (Number(hourText) % 12) + (half === 'p' ? 12 : 0);
	return new Date(`${date}T${String(hour).padStart(2, '0')}:${minute}:00${easternOffset(date)}`);
}

/** Each club's kickoff in a week, for the season block's "is his game final". */
function clubKickoffs(games: readonly GameRow[]): (club: string, week: number) => Date | null {
	const byClubWeek = new Map(
		games.flatMap((game) => [
			[`${game.home_nfl_team}:${String(game.week)}`, kickoffOf(game)] as const,
			[`${game.away_nfl_team}:${String(game.week)}`, kickoffOf(game)] as const
		])
	);
	return (club, week) => byClubWeek.get(`${club}:${String(week)}`) ?? null;
}

/** A week's first kickoff. */
function weekKickoff(games: readonly GameRow[], week: number): Date {
	const kickoffs = games.filter((game) => game.week === week).map(kickoffOf);
	if (kickoffs.length === 0) throw new Error(`The 2026 slate has no week ${String(week)} kickoff.`);
	return new Date(Math.min(...kickoffs.map((kickoff) => kickoff.getTime())));
}

/** The season's first kickoff. */
function firstKickoff(games: readonly GameRow[]): Date {
	return weekKickoff(games, 1);
}

/** Every PPR 12-team capture before the first kickoff, averaged per player. */
async function preseasonAdp(sql: postgres.Sql, kickoff: Date): Promise<Preseason> {
	const rows = await sql<{ player_id: string; adp: number; first: Date; last: Date }[]>`
		select player_id, avg(adp)::float8 as adp, min(captured_at) as first, max(captured_at) as last
		from adp_snapshots where source = ${ADP_FEED} and captured_at < ${kickoff}
		group by player_id`;
	if (rows.length === 0) throw new Error('No preseason ADP captures before the first kickoff.');
	const first = rows.reduce(
		(min, row) => (row.first < min ? row.first : min),
		rows[0]?.first ?? kickoff
	);
	const last = rows.reduce(
		(max, row) => (row.last > max ? row.last : max),
		rows[0]?.last ?? kickoff
	);
	return {
		byGsis: new Map(rows.map((row) => [row.player_id, round(row.adp, 1)])),
		window: { from: first.toISOString(), to: last.toISOString() }
	};
}

interface WinTotals {
	byClub: Map<string, number>;
	window: Window;
}

async function slateAndValues(
	sql: postgres.Sql
): Promise<{ games: GameRow[]; winTotals: WinTotals }> {
	const games = await sql<GameRow[]>`
		select week, home_nfl_team, away_nfl_team, game_date, kickoff_et from nfl_games
		order by week, game_id`;
	const totals = await sql<{ team: string; value: number; as_of: Date }[]>`
		select distinct on (team) team, value, as_of from team_week_observations
		where source = ${WIN_TOTALS_FEED} and metric = 'vegas_win_total' and season = ${SEASON}
		order by team, as_of desc`;
	const stamps = totals.map((row) => row.as_of.getTime());
	return {
		games,
		winTotals: {
			byClub: new Map(totals.map((row) => [canonicalClub(row.team), row.value])),
			window: {
				from: new Date(Math.min(...stamps)).toISOString(),
				to: new Date(Math.max(...stamps)).toISOString()
			}
		}
	};
}

function clubList(codes: readonly string[], games: readonly GameRow[]): Club[] {
	return codes.map((abbr) => {
		const names = NFL_TEAM_NAMES[abbr];
		if (!names) throw new Error(`No city and nickname for ${abbr}.`);
		const played = new Set(
			games
				.filter((game) => game.home_nfl_team === abbr || game.away_nfl_team === abbr)
				.map((game) => game.week)
		);
		const open = Array.from({ length: LAST_WEEK }, (_, i) => i + 1).filter((w) => !played.has(w));
		if (open.length !== 1) throw new Error(`${abbr} has ${String(open.length)} open weeks.`);
		return { abbr, city: names.city, nickname: names.nickname, bye: open[0] ?? null };
	});
}

function scheduleFrom(
	codes: readonly string[],
	games: readonly GameRow[],
	winTotals: WinTotals
): Schedule {
	const value = (club: string): number => {
		const total = winTotals.byClub.get(club);
		if (total === undefined) throw new Error(`No ${String(SEASON)} win total for ${club}.`);
		return total;
	};
	const unranked = codes.map((abbr) => {
		const slate: Game[] = games.flatMap((game): Game[] => {
			const kickoff = kickoffOf(game).toISOString();
			if (game.home_nfl_team === abbr)
				return [{ week: game.week, opponent: game.away_nfl_team, home: true, kickoff }];
			if (game.away_nfl_team === abbr)
				return [{ week: game.week, opponent: game.home_nfl_team, home: false, kickoff }];
			return [];
		});
		const values = slate.map((game) => value(game.opponent));
		const strength = round(values.reduce((sum, v) => sum + v, 0) / values.length);
		return { abbr, games: slate, strength };
	});
	const ordered = [...unranked].sort(
		(a, b) => b.strength - a.strength || a.abbr.localeCompare(b.abbr)
	);
	return {
		season: SEASON,
		opponentValues: Object.fromEntries(codes.map((abbr) => [abbr, value(abbr)])),
		opponentBasis: 'Published season win total',
		unit: "opponents' average win total",
		slates: unranked.map((slate) => ({
			...slate,
			rank: ordered.findIndex((other) => other.abbr === slate.abbr) + 1,
			method: "the average of its opponents' published season win totals",
			window: winTotals.window
		}))
	};
}

interface FrozenRow {
	week: number;
	frozen_at: Date;
	board_as_of: Date;
}

/** Every week of the season by its status as of now: frozen when the register froze it, missed
 * when its first kickoff passed with no freeze, and upcoming otherwise, the next one with its day. */
function seasonWeeks(
	frozen: readonly FrozenRow[],
	games: readonly GameRow[],
	now: Date
): RecordWeek[] {
	const byWeek = new Map(frozen.map((row) => [row.week, row]));
	const empty = { gradedAt: null, population: 0, lines: [] };
	const weeks = Array.from({ length: LAST_WEEK }, (_, i) => i + 1);
	const next = weeks.find((week) => !byWeek.has(week) && weekKickoff(games, week) > now);
	return weeks.map((week): RecordWeek => {
		const row = byWeek.get(week);
		if (row) {
			return {
				week,
				status: 'frozen',
				frozenAt: row.frozen_at.toISOString(),
				frozenBy: runIdOf(row.board_as_of),
				...empty
			};
		}
		const kickoff = weekKickoff(games, week);
		if (kickoff <= now) {
			return {
				week,
				status: 'missed',
				frozenAt: null,
				frozenBy: null,
				...empty,
				note: MISSED_WEEK_NOTE
			};
		}
		// The next week names its first kickoff, the day it freezes by.
		const frozenAt = week === next ? kickoff.toISOString() : null;
		return { week, status: 'upcoming', frozenAt, frozenBy: null, ...empty };
	});
}

async function recordFrom(
	sql: postgres.Sql,
	games: readonly GameRow[],
	now: Date
): Promise<RunRecord> {
	const frozen = await sql<FrozenRow[]>`
		select week, max(frozen_at) as frozen_at, max(board_as_of) as board_as_of
		from register_freeze_rows
		where season = ${SEASON} and board_source = ${SERVED_REGISTER_BOARD}
		group by week order by week`;
	const graded = await sql<{ count: string }[]>`
		select count(*)::text as count from register_grade_rows where season = ${SEASON}`;
	if ((graded[0]?.count ?? '0') !== '0') {
		throw new Error(
			'The register has graded rows. Grade them into record.json before using the stand-in.'
		);
	}
	return {
		season: SEASON,
		format: FORMAT.id,
		// The register's own rules (research-ts/src/projections/register/grade.ts), in drafter words:
		// the agreement is Spearman's rank correlation, the places off the mean distance in places.
		statistic: { agreement: 'agreement with the finish', placesOff: 'places off, typical player' },
		method:
			'Each week our PPR board is frozen before the first kickoff and graded after the games against how its players finished, with ADP graded the same way on the same players.',
		weeks: seasonWeeks(frozen, games, now),
		toDate: []
	};
}

/** A board's run id from its as-of stamp: "2026-09-07T21". */
function runIdOf(stamp: Date): string {
	return stamp.toISOString().slice(0, 13);
}

function adpFrom(rows: readonly BoardRow[], window: Window): Adp {
	return {
		sources: [{ id: ADP_SOURCE_ID, drafts: ADP_DRAFTS, formats: [FORMAT.id], window }],
		players: Object.fromEntries(
			rows.flatMap((row) => (row.adp === null ? [] : [[row.id, { [ADP_SOURCE_ID]: row.adp }]]))
		)
	};
}

function sourcesFor(adpWindow: Window, winTotals: Window): Source[] {
	return [
		{ artifact: 'adp', vendor: ADP_VENDOR, feed: ADP_FEED, window: adpWindow },
		{ artifact: 'schedule', vendor: WIN_TOTALS_VENDOR, feed: WIN_TOTALS_FEED, window: winTotals }
	];
}

/** Every artifact, validated with the schema the build reads it with, keyed by its path in the run. */
function artifacts(parts: {
	manifest: Manifest;
	rows: BoardRow[];
	players: Player[];
	adp: Adp;
	record: RunRecord;
	index: IndexEntry[];
	clubs: Club[];
	schedule: Schedule;
}): Map<string, unknown> {
	const check = <T>(schema: z.ZodType<T>, value: T, path: string): [string, T] => {
		const result = schema.safeParse(value);
		if (!result.success) throw new Error(`${path}: ${result.error.message}`);
		return [path, result.data];
	};
	return new Map<string, unknown>([
		check(manifestSchema, parts.manifest, RUN_PATHS.manifest),
		check(boardSchema, { format: FORMAT.id, rows: parts.rows }, RUN_PATHS.board(FORMAT.id)),
		...parts.players.map((player) => check(playerSchema, player, RUN_PATHS.player(player.id))),
		check(adpSchema, parts.adp, RUN_PATHS.adp),
		check(recordSchema, parts.record, RUN_PATHS.record),
		check(indexSchema, parts.index, RUN_PATHS.index),
		check(clubsSchema, parts.clubs, RUN_PATHS.clubs),
		check(scheduleSchema, parts.schedule, RUN_PATHS.schedule)
	]);
}

async function writeLocal(files: ReadonlyMap<string, unknown>): Promise<void> {
	const runDir = new URL(`runs/${RUN_ID}/`, OUT_ROOT);
	await rm(runDir, { recursive: true, force: true });
	for (const [path, value] of files) {
		const file = new URL(path, runDir);
		await mkdir(dirname(file.pathname), { recursive: true });
		await writeFile(file, JSON.stringify(value));
	}
	const pointer = latestPointerSchema.parse({ runId: RUN_ID });
	await writeFile(new URL(`runs/${LATEST_POINTER}`, OUT_ROOT), JSON.stringify(pointer));
	process.stdout.write(`Wrote ${String(files.size)} artifacts to ${runDir.pathname}\n`);
}

async function upload(files: ReadonlyMap<string, unknown>): Promise<void> {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
	if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is not set.');
	const client = new AwsClient({
		...(await credentialsFromToken()),
		service: 's3',
		region: 'auto'
	});
	const base = bucketUrl(accountId);
	const put = async (key: string, value: unknown): Promise<void> => {
		const response = await client.fetch(`${base}/${key}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(value)
		});
		if (!response.ok) throw new Error(`PUT ${key} answered ${String(response.status)}.`);
	};
	const entries = [...files];
	const BATCH = 16;
	for (let i = 0; i < entries.length; i += BATCH) {
		await Promise.all(
			entries.slice(i, i + BATCH).map(([path, value]) => put(join('runs', RUN_ID, path), value))
		);
	}
	// The pointer moves last, so a reader never sees a run that is half written.
	await put(`runs/${LATEST_POINTER}`, { runId: RUN_ID });
	process.stdout.write(`Uploaded ${String(files.size)} artifacts and the pointer to ${base}\n`);
}

async function main(): Promise<void> {
	const [boardCsv, capsuleCsv] = await Promise.all([
		readCsv<BoardCsv>('board-ppr.csv'),
		readCsv<CapsuleCsv>('capsules.csv')
	]);
	const sql = postgres(process.env.STANDIN_DATABASE_URL ?? DEFAULT_DATABASE_URL, { max: 2 });
	const now = new Date();
	try {
		const { games, winTotals } = await slateAndValues(sql);
		const record = await recordFrom(sql, games, now);
		const adp = await preseasonAdp(sql, firstKickoff(games));
		const rows = boardRows(boardCsv, adp.byGsis);
		const codes = [...new Set(rows.map((row) => row.team))].sort();
		if (codes.length !== CLUB_COUNT)
			throw new Error(`The board names ${String(codes.length)} clubs.`);
		const clubs = clubList(codes, games);
		const schedule = scheduleFrom(codes, games, winTotals);
		const seasons = await seasonBlocks(sql, rows, {
			season: SEASON,
			format: FORMAT.id,
			weeks: LAST_WEEK,
			canonicalClub,
			schedule,
			clubs,
			kickoff: clubKickoffs(games),
			now
		});
		const players = playerPages(rows, capsuleCsv, seasons);
		checkRunSeasons(players, schedule);
		const index: IndexEntry[] = rows.map(({ id, slug, name, team, position, headshot }) => {
			const season = seasons.get(id);
			if (!season) throw new Error(`${name} has no season block.`);
			return {
				id,
				slug,
				name,
				team,
				position,
				headshot,
				season: { games: season.games, pointsPerGame: season.pointsPerGame }
			};
		});
		const files = artifacts({
			manifest: {
				runId: RUN_ID,
				runAt: now.toISOString(),
				season: SEASON,
				implementation: IMPLEMENTATION,
				standIn: true,
				formats: [FORMAT],
				players: players.length,
				sources: sourcesFor(adp.window, winTotals.window)
			},
			rows,
			players,
			adp: adpFrom(rows, adp.window),
			record,
			index,
			clubs,
			schedule
		});
		await writeLocal(files);
		if (process.argv.includes('--upload')) await upload(files);
	} finally {
		await sql.end();
	}
}

await main();
