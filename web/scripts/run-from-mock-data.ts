// THE STAND-IN RUN. No nightly run exists yet, so this converts the real 2026 data the approved
// mocks were built from into the run format, once, so every nightly page can be built and measured.
// The first real run replaces it with no code change: point PUBLIC_RUN_ID at the real run (or move
// runs/latest.json) and delete this script.
//
// Sources, all real, nothing invented, every date read from the data's own stamps:
//   docs/design/mocks/2026-10-12-commish/data/board-ppr.csv   the 400-row 2026 PPR board (its ADP
//     column is not used: nothing in the store dates it)
//   docs/design/mocks/2026-10-12-commish/data/capsules.csv    the written capsules, where the store holds none
//   the local dev database (STANDIN_DATABASE_URL, the compose dev database by default):
//     adp_snapshots: the PPR 12-team captures taken before the season's first kickoff, averaged,
//       the kickers' and defenses' too, their names, clubs and faces from research.provider_players
//       (standin-market.ts, Lane 132: the board's K and DST market rows)
//     nfl_games: the 2026 slate, the byes and the first kickoff
//     team_week_observations (vegas_win_totals): each club's latest published season win total
//     register_freeze_rows and register_grade_rows: the record as it stands
//     research.player_capsules: the writer's newest read for each player and when it wrote it
//     and the three seasons before it for each page's earlier seasons (standin-season.ts)
//   scripts/standin-week-reads.json   Lane 72's three recorded week-ahead reads, the stand-in's weekRead
//   scripts/standin-designations.json the injury capture the stand-in is marked with (Lane 128): the
//     newest by-date capture in the dev store on 2026-10-21 (stamped 2026-10-14T02:03:35.613Z), as
//     `research.nightly mark` wrote it beside this run, read once and kept, so every build and every
//     shot script reads the same designations and none reads dev at shot time; written as the run's
//     designations.json for the players its board ranks
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
	designationsSchema,
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
	type Designations,
	type Format,
	type Game,
	type IndexEntry,
	type Manifest,
	type MarketEntry,
	type MarketRow,
	type Player,
	type RecordWeek,
	type RunRecord,
	type Schedule,
	type Source,
	type WeekRead,
	type Window
} from '../src/lib/run/schema.ts';
import { POSITIONS, type Position } from '../src/lib/types/player.ts';
import { bucketUrl, credentialsFromToken } from './r2.ts';
import { dropBetween, gapOf, tenth } from './tenth.ts';
import { checkRunSeasons } from '../src/lib/run/season-checks.ts';
import { MISSED_GAMES_FROM, mayMissGames } from '../src/lib/player/basis-words.ts';
import { gamesLeftOf } from '../src/lib/server/pages/player-card.ts';
import { GAME_LENGTH_MS, priorSeasonBlocks, seasonBlocks } from './standin-season.ts';
import { marketRows, slugOf } from './standin-market.ts';
import type { PlayerSeason, PriorSeason } from '../src/lib/run/season.ts';

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
	const rows = byValue.map((row, i) => {
		if (!isPosition(row.position)) throw new Error(`${row.name} plays ${row.position}.`);
		const ourRank = i + 1;
		const adp = adpByGsis.get(row.gsis) ?? null;
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
			adp,
			// The Gap by the nightly's own rule (scripts/tenth.ts gapOf, tested against the shared tables).
			gap: gapOf(adp, ourRank),
			projected: round(num(row.projected_points, `${row.name} points`)),
			vor: round(num(row.value_over_replacement, `${row.name} vor`)),
			expectedGames: round(num(row.expected_games, `${row.name} games`)),
			floor: round(num(row.floor_points, `${row.name} floor`)),
			median: round(num(row.median_points, `${row.name} median`)),
			ceiling: round(num(row.ceiling_points, `${row.name} ceiling`)),
			tier: num(row.tier, `${row.name} tier`) + 1
		};
	});
	return withTierDrops(rows);
}

/** Each row with his tier's drop to the next at his position, as the nightly writes it
 * (research/nightly/build/pages.py tier_drops, scripts/tenth.ts dropBetween): the tier's last
 * projection, by position rank, less the next tier's first; null in a position's last tier. */
function withTierDrops(rows: readonly BoardRow[]): BoardRow[] {
	const ends = new Map<string, { last: BoardRow; first: BoardRow }>();
	const byRank = [...rows].sort((a, b) => a.positionRank - b.positionRank);
	for (const row of byRank) {
		const key = `${row.position} ${String(row.tier)}`;
		const end = ends.get(key);
		ends.set(key, { first: end?.first ?? row, last: row });
	}
	return rows.map((row) => {
		const own = ends.get(`${row.position} ${String(row.tier)}`);
		const next = ends.get(`${row.position} ${String(row.tier + 1)}`);
		const tierDrop = own && next ? dropBetween(own.last.projected, next.first.projected) : null;
		return { ...row, tierDrop };
	});
}

/** The board's position ranks as the API's in-season read gives them (inseason PlayingRanks, Lane 128
 * review fix round 2), not as the nightly publishes them: the nightly keeps the store's ranks (its
 * designations step writes statuses only), and a player page restates its rank from the API's read
 * once read (fix round 3). The available are numbered first at each position, in the board's order,
 * and a player on a season-long list after them, so the stand-in's pages and the fixture's league
 * screens say one rank. */
function playingFirst(rows: readonly BoardRow[], designations: Designations): BoardRow[] {
	const listed = (row: BoardRow): boolean => designations.players[row.id]?.seasonLong === true;
	const ranks = new Map<string, number>();
	for (const position of new Set(rows.map((row) => row.position))) {
		const at = rows
			.filter((row) => row.position === position)
			.sort((a, b) => a.positionRank - b.positionRank);
		[...at.filter((row) => !listed(row)), ...at.filter(listed)].forEach((row, i) =>
			ranks.set(row.id, i + 1)
		);
	}
	return rows.map((row) => ({ ...row, positionRank: ranks.get(row.id) ?? row.positionRank }));
}

/** A capsule the writer stored, with when it wrote it. */
interface StoredCapsule {
	body: string;
	writtenAt: string;
}

/** The writer's newest stored read for each player, by his board (ESPN) id: the page carries the
 * writer's current text and its day, as the nightly does, and the mock's CSV only where the store has
 * none (that text's day is not recorded, so it carries no stamp). */
async function storedCapsules(sql: postgres.Sql): Promise<Map<string, StoredCapsule>> {
	const rows = await sql<{ espn_id: string; body_full: string; generated_at: Date }[]>`
		select p.espn_id, c.body_full, c.generated_at
		from research.player_capsules c join research.players p on p.id = c.player_id
		where c.source = 'llm' and p.espn_id is not null`;
	return new Map(
		rows.map((row) => [
			row.espn_id,
			{ body: row.body_full.trim(), writtenAt: row.generated_at.toISOString() }
		])
	);
}

/** A page's capsule: the stored read when there is one, else the CSV's; the mock's pull figures kept
 * where the text still carries them, so the schema's check holds. */
function capsuleOf(
	name: string,
	stored: StoredCapsule | undefined,
	csv: CapsuleCsv | undefined
): Capsule | null {
	if (HELD_CAPSULES.has(name)) return null;
	const pulls = PULL_FIGURES[name] ?? [];
	if (stored)
		return {
			body: stored.body,
			pulls: pulls.filter((pull) => stored.body.includes(pull.figure)),
			writtenAt: stored.writtenAt
		};
	return csv ? { body: csv.body_full.trim(), pulls } : null;
}

/** Lane 72's recorded week-ahead reads, by board id: the stand-in's weekRead for those players. */
async function weekReads(): Promise<Map<string, WeekRead>> {
	const file = new URL('./standin-week-reads.json', import.meta.url);
	const recorded = JSON.parse(await readFile(file, 'utf8')) as {
		reads: (Pick<
			WeekRead,
			'week' | 'body' | 'caption' | 'writtenAt' | 'call' | 'status' | 'projection' | 'movedCaption'
		> & {
			id: string;
		})[];
	};
	return new Map(recorded.reads.map(({ id, ...read }) => [id, { ...read, factsAt: null }]));
}

/** The recorded injury capture (scripts/standin-designations.json) for the players the board ranks,
 * as `research.nightly mark` writes a run's designations.json (designations_file): one capture, so
 * the board, the player pages and every shot read the same statuses. */
async function recordedDesignations(rows: readonly BoardRow[]): Promise<Designations> {
	const file = new URL('./standin-designations.json', import.meta.url);
	const recorded = designationsSchema.parse(JSON.parse(await readFile(file, 'utf8')));
	const ranked = new Set(rows.map((row) => row.id));
	const players = Object.entries(recorded.players).filter(([id]) => ranked.has(id));
	return { ...recorded, players: Object.fromEntries(players) };
}

function playerPages(
	rows: readonly BoardRow[],
	capsules: readonly CapsuleCsv[],
	stored: ReadonlyMap<string, StoredCapsule>,
	reads: ReadonlyMap<string, WeekRead>,
	seasons: ReadonlyMap<string, PlayerSeason>,
	prior: ReadonlyMap<string, PriorSeason[]>
): Player[] {
	const byId = new Map(capsules.map((capsule) => [capsule.player_id, capsule]));
	return rows.map((row) => {
		const season = seasons.get(row.id);
		if (!season) throw new Error(`${row.name} has no season block.`);
		const { id, slug, name, position, team, headshot, ...numbers } = row;
		const capsule = capsuleOf(name, stored.get(id), byId.get(id));
		return {
			id,
			slug,
			name,
			position,
			team,
			headshot,
			formats: { [FORMAT.id]: numbers },
			capsule,
			weekRead: reads.get(id) ?? null,
			season,
			priorSeasons: prior.get(id) ?? []
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

/** A game's state at the stand-in's clock (the nightly's rule, Lane 80), its final estimated as the
 * stand-in's season block estimates it: GAME_LENGTH_MS after its kickoff. */
function stateAt(kickoff: Date, now: Date): NonNullable<Game['state']> {
	if (kickoff.getTime() + GAME_LENGTH_MS <= now.getTime()) return 'final';
	return kickoff.getTime() <= now.getTime() ? 'kicked_off' : 'upcoming';
}

const mean = (values: readonly number[]): number =>
	values.reduce((sum, v) => sum + v, 0) / values.length;

/** Each club's place by its mean, 1 the highest, ties by club code. */
function ranksOf(means: ReadonlyMap<string, number>): Map<string, number> {
	const order = [...means].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
	return new Map(order.map(([abbr], i) => [abbr, i + 1] as const));
}

function scheduleFrom(
	codes: readonly string[],
	games: readonly GameRow[],
	winTotals: WinTotals,
	now: Date
): Schedule {
	const value = (club: string): number => {
		const total = winTotals.byClub.get(club);
		if (total === undefined) throw new Error(`No ${String(SEASON)} win total for ${club}.`);
		return total;
	};
	const unranked = codes.map((abbr) => {
		const slate: Game[] = games.flatMap((game): Game[] => {
			const at = kickoffOf(game);
			const where = { week: game.week, kickoff: at.toISOString(), state: stateAt(at, now) };
			if (game.home_nfl_team === abbr)
				return [{ ...where, opponent: game.away_nfl_team, home: true }];
			if (game.away_nfl_team === abbr)
				return [{ ...where, opponent: game.home_nfl_team, home: false }];
			return [];
		});
		// Ranked on the unrounded mean, written to the tenth every screen prints (the nightly's rule, X9).
		const left = slate.filter((game) => game.state === 'upcoming');
		return {
			abbr,
			games: slate,
			mean: mean(slate.map((game) => value(game.opponent))),
			rest: left.length === 0 ? null : mean(left.map((game) => value(game.opponent)))
		};
	});
	const ordered = [...unranked].sort((a, b) => b.mean - a.mean || a.abbr.localeCompare(b.abbr));
	const restRanks = ranksOf(
		new Map(unranked.flatMap(({ abbr, rest }) => (rest === null ? [] : [[abbr, rest] as const])))
	);
	return {
		season: SEASON,
		opponentValues: Object.fromEntries(codes.map((abbr) => [abbr, value(abbr)])),
		// The nightly's words (research/nightly/reads/schedule.py, Lane 132): an opponent's value is his
		// expected wins, never a "total", a betting word on the copy guard's list.
		opponentBasis: 'Expected wins, set before the season',
		unit: "opponents' average expected wins",
		slates: unranked.map(({ abbr, games: slate, mean: strength, rest }) => ({
			abbr,
			games: slate,
			strength: tenth(strength),
			rank: ordered.findIndex((other) => other.abbr === abbr) + 1,
			method:
				"the average of its opponents' expected wins for the season, one per game, set before the first kickoff",
			window: winTotals.window,
			rest:
				rest === null
					? null
					: {
							strength: tenth(rest),
							rank: restRanks.get(abbr) ?? 0,
							method:
								"the average of each club's remaining opponents' expected wins, one per game still to play, set before the first kickoff"
						}
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
				order: 'preseason',
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
				order: null,
				...empty,
				note: MISSED_WEEK_NOTE
			};
		}
		// The next week names its first kickoff, the day it freezes by.
		const frozenAt = week === next ? kickoff.toISOString() : null;
		return { week, status: 'upcoming', frozenAt, frozenBy: null, order: null, ...empty };
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
		statistic: { agreement: 'order matched', placesOff: 'places off', starters: 'starters right' },
		scale: "1.00 is a perfect match of the week's finishing order, 0.00 is none.",
		startersBasis: null,
		// The run's words (research/nightly/reads/record.py method, ADP alone before a graded published score).
		method:
			"Each week our preseason board froze before the first kickoff and was graded on its players' points, ADP on the same players.",
		publishedFromWeek: null,
		honest: null,
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
	rows: (BoardRow | MarketRow)[];
	players: Player[];
	adp: Adp;
	record: RunRecord;
	index: (IndexEntry | MarketEntry)[];
	clubs: Club[];
	schedule: Schedule;
	designations: Designations;
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
		check(scheduleSchema, parts.schedule, RUN_PATHS.schedule),
		check(designationsSchema, parts.designations, RUN_PATHS.designations)
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
	process.stdout.write(`${missedGamesCount(files)}\n`);
}

/** How many players' caption says games he may miss (D17), so the first live run can be checked. */
function missedGamesCount(files: ReadonlyMap<string, unknown>): string {
	const schedule = files.get(RUN_PATHS.schedule) as Schedule;
	const pages = [...files.values()].filter((value): value is Player => isPlayerPage(value));
	const above = pages.filter((page) => {
		const numbers = page.formats[FORMAT.id];
		return (
			numbers !== undefined &&
			mayMissGames(numbers.expectedGames, gamesLeftOf(schedule.slates, page.team))
		);
	});
	return `Players with ${String(MISSED_GAMES_FROM)} or more games he may miss: ${String(above.length)} of ${String(pages.length)}`;
}

function isPlayerPage(value: unknown): value is Player {
	return typeof value === 'object' && value !== null && 'formats' in value && 'season' in value;
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
		const designations = await recordedDesignations(boardRows(boardCsv, adp.byGsis));
		const rows = playingFirst(boardRows(boardCsv, adp.byGsis), designations);
		const codes = [...new Set(rows.map((row) => row.team))].sort();
		if (codes.length !== CLUB_COUNT)
			throw new Error(`The board names ${String(codes.length)} clubs.`);
		const clubs = clubList(codes, games);
		const schedule = scheduleFrom(codes, games, winTotals, now);
		const seasonInputs = {
			season: SEASON,
			format: FORMAT.id,
			weeks: LAST_WEEK,
			canonicalClub,
			schedule,
			clubs,
			kickoff: clubKickoffs(games),
			now
		};
		const seasons = await seasonBlocks(sql, rows, seasonInputs);
		const players = playerPages(
			rows,
			capsuleCsv,
			await storedCapsules(sql),
			await weekReads(),
			seasons,
			await priorSeasonBlocks(sql, rows, seasonInputs)
		);
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
		const market = await marketRows(sql, {
			feed: ADP_FEED,
			kickoff: firstKickoff(games),
			canonicalClub,
			ranked: rows.length,
			taken: new Set(rows.map((row) => row.slug))
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
			rows: [...rows, ...market.rows],
			players,
			adp: adpFrom(rows, adp.window),
			record,
			index: [...index, ...market.index],
			clubs,
			schedule,
			designations
		});
		await writeLocal(files);
		if (process.argv.includes('--upload')) await upload(files);
	} finally {
		await sql.end();
	}
}

await main();
