// THE STAND-IN RUN. No nightly run exists yet, so this converts the real 2026 data the approved
// mocks were built from into the run format, once, so every nightly page can be built and measured.
// The first real run replaces it with no code change: point PUBLIC_RUN_ID at the real run (or move
// runs/latest.json) and delete this script.
//
// Sources, all real, nothing invented:
//   docs/design/mocks/2026-10-12-commish/data/board-ppr.csv   the 400-row 2026 PPR board
//   docs/design/mocks/2026-10-12-commish/data/capsules.csv    the written capsules
//   the local dev database (STANDIN_DATABASE_URL, the compose dev database by default):
//     nfl_games for the 2026 slate and byes, vegas_win_totals for each club's 2026 win total,
//     register_freeze_rows and register_grade_rows for the record as it stands
//   src/domain/nfl-team-names.ts for each club's city and nickname
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
import { NFL_TEAM_NAMES } from '../../src/domain/nfl-team-names.ts';
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
	type RunRecord,
	type Schedule
} from '../src/lib/run/schema.ts';
import { POSITIONS, type Position } from '../src/lib/types/player.ts';
import { bucketUrl, credentialsFromToken } from './r2.ts';

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

/** The ADP column of the board CSV is the stats provider's PPR ADP feed (src/stats/tank01/config.ts,
 * adpType PPR), the only writer of players.adp the board read. It does not date its numbers. */
const ADP_SOURCE = {
	id: 'tank01-ppr',
	name: 'Tank01',
	drafts: 'PPR drafts',
	formats: [FORMAT.id],
	readAt: null
};

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
	| 'player_id',
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

function boardRows(csv: readonly BoardCsv[]): BoardRow[] {
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
			adp: row.adp.trim() === '' ? null : num(row.adp, `${row.name} ADP`),
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

function playerPages(rows: readonly BoardRow[], capsules: readonly CapsuleCsv[]): Player[] {
	const byId = new Map(capsules.map((capsule) => [capsule.player_id, capsule]));
	return rows.map((row) => {
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
			capsule
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
}

async function slateAndValues(
	sql: postgres.Sql
): Promise<{ games: GameRow[]; winTotals: Map<string, number> }> {
	const games = await sql<GameRow[]>`
		select week, home_nfl_team, away_nfl_team from nfl_games order by week, game_id`;
	const totals = await sql<{ team: string; value: number }[]>`
		select distinct on (team) team, value from team_week_observations
		where source = 'vegas_win_totals' and metric = 'vegas_win_total' and season = ${SEASON}
		order by team, as_of desc`;
	return {
		games,
		winTotals: new Map(totals.map((row) => [canonicalClub(row.team), row.value]))
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
	winTotals: ReadonlyMap<string, number>
): Schedule {
	const unranked = codes.map((abbr) => {
		const slate: Game[] = games.flatMap((game): Game[] => {
			if (game.home_nfl_team === abbr)
				return [{ week: game.week, opponent: game.away_nfl_team, home: true }];
			if (game.away_nfl_team === abbr)
				return [{ week: game.week, opponent: game.home_nfl_team, home: false }];
			return [];
		});
		const values = slate.map((game) => {
			const total = winTotals.get(game.opponent);
			if (total === undefined) throw new Error(`No 2026 win total for ${game.opponent}.`);
			return total;
		});
		const strength = round(values.reduce((sum, v) => sum + v, 0) / values.length);
		return { abbr, games: slate, strength };
	});
	const ordered = [...unranked].sort(
		(a, b) => b.strength - a.strength || a.abbr.localeCompare(b.abbr)
	);
	return {
		season: SEASON,
		basis: `average ${String(SEASON)} win total of its opponents`,
		opponentValues: Object.fromEntries(codes.map((abbr) => [abbr, winTotals.get(abbr) ?? 0])),
		opponentBasis: `${String(SEASON)} win total`,
		slates: unranked.map((slate) => ({
			...slate,
			rank: ordered.findIndex((other) => other.abbr === slate.abbr) + 1
		}))
	};
}

async function recordFrom(sql: postgres.Sql): Promise<RunRecord> {
	const frozen = await sql<{ week: number; frozen_at: Date }[]>`
		select week, max(frozen_at) as frozen_at from register_freeze_rows
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
		implementation: { current: IMPLEMENTATION, since: null },
		weeks: frozen.map((row) => ({
			week: row.week,
			frozenAt: row.frozen_at.toISOString(),
			gradedAt: null,
			population: 0,
			lines: []
		})),
		toDate: []
	};
}

function adpFrom(rows: readonly BoardRow[]): Adp {
	return {
		sources: [ADP_SOURCE],
		players: Object.fromEntries(
			rows.flatMap((row) => (row.adp === null ? [] : [[row.id, { [ADP_SOURCE.id]: row.adp }]]))
		)
	};
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
	const rows = boardRows(boardCsv);
	const codes = [...new Set(rows.map((row) => row.team))].sort();
	if (codes.length !== CLUB_COUNT)
		throw new Error(`The board names ${String(codes.length)} clubs.`);

	const sql = postgres(process.env.STANDIN_DATABASE_URL ?? DEFAULT_DATABASE_URL, { max: 2 });
	try {
		const [{ games, winTotals }, record] = await Promise.all([
			slateAndValues(sql),
			recordFrom(sql)
		]);
		const players = playerPages(rows, capsuleCsv);
		const index: IndexEntry[] = rows.map(({ id, slug, name, team, position }) => ({
			id,
			slug,
			name,
			team,
			position
		}));
		const files = artifacts({
			manifest: {
				runId: RUN_ID,
				runAt: new Date().toISOString(),
				season: SEASON,
				implementation: IMPLEMENTATION,
				standIn: true,
				formats: [FORMAT],
				players: players.length
			},
			rows,
			players,
			adp: adpFrom(rows),
			record,
			index,
			clubs: clubList(codes, games),
			schedule: scheduleFrom(codes, games, winTotals)
		});
		await writeLocal(files);
		if (process.argv.includes('--upload')) await upload(files);
	} finally {
		await sql.end();
	}
}

await main();
