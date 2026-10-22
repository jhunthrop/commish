// The runs the club shots build from (Lane 132, B111), each the contract run (2026-10-21T12-ros) with
// Jahmyr Gibbs's page rewritten by the research writer's rules (player_season.py `season_block`,
// page_club.py `last_game_club`, free_agent.py `run_club`), so the shots that read them are made by
// the repo and never by hand. Every other file is the contract run's.
//   mover       (club-move-shots.ts, Lane 120): STAND-IN, a constructed mover. His club stays the
//               Lions; his week 5 line is his own under the Chargers' week 5 game and his week 6 line is
//               his week 4 line under the Chargers' week 6 game (the Lions are off that week), so his
//               newest line is the Chargers' (`lastGameClub` LAC, week 6); weeks 1 to 4, before his
//               first line with a club the run can name, name no opponent.
//   free-agent  (free-agent-shots.ts, Lane 123): STAND-IN, a constructed free agent. His club is "FA";
//               his Lions lines of weeks 1, 2, 4 and 5 kept; week 3 his offensive snaps with no club edge,
//               which names no opponent and is a game he played the run cannot name (`unnamedGame`, Lane
//               138); every later week names no opponent; his newest line is the Lions' (`lastGameClub`
//               DET, week 5).
//   special-teams (club-move-shots.ts special-teams, Lane 144, B117): STAND-IN, Lane 135's Deguara on
//               Gibbs's page. His club stays the Lions; his week 4 line is his own under the Chargers'
//               week 4 game, and his newest line is the Chargers' week 5 game with no stat line and no
//               offensive snap, so that week reads inactive under it (home to DEN) and `lastGameClub` is
//               LAC, week 5; weeks 1 to 3 name no opponent; week 6 is the Lions' bye.
//
//   node scripts/inseason-fixture/mover-run.ts mover|free-agent|special-teams
// then build with PUBLIC_RUN_ID=<the run's id> PUBLIC_RUN_BASE_URL=.runs and start the fixture API
// with FIXTURE_RUN_ID=<the run's id>.
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { FREE_AGENT_CLUB } from '../../src/lib/format/free-agent.ts';
import {
	pointsPerGameOf,
	pointsTotalOf,
	STAT_FIELDS,
	type GameLogRow,
	type PlayerSeason
} from '../../src/lib/run/season.ts';
import { scheduleSchema } from '../../src/lib/run/schema.ts';
import { CONTRACT_RUN_ID, clubRunId, type ClubRun } from './run-ids.ts';

const GIBBS = '4429795';
const MOVED_TO = 'LAC';
const OWN_CLUB = 'DET';
/** The mover's weeks before his first line the run can place, and the week whose line stands in for
 * his week 6. */
const UNPLACED_WEEKS = [1, 2, 3, 4];
const STAND_IN_WEEK = 4;
/** The free agent's last week with a club. */
const LAST_CLUB_WEEK = 5;
/** The free agent's week of offensive snaps with no club edge (Lane 138). */
const UNNAMED_GAME_WEEK = 3;

/** The special-teams mover's newest line: the Chargers' week 5 game. */
const SPECIAL_TEAMS_WEEK = 5;

const kind = process.argv[2];
if (kind !== 'mover' && kind !== 'free-agent' && kind !== 'special-teams')
	throw new Error(
		'Name the run: node scripts/inseason-fixture/mover-run.ts mover|free-agent|special-teams'
	);
const run: ClubRun = kind;
const RUN_ID = clubRunId(run);
const SOURCE = new URL(
	`../../../research/nightly/contract/fixture/runs/${CONTRACT_RUN_ID}/`,
	import.meta.url
);
const OUT = new URL(`../../.runs/runs/${RUN_ID}/`, import.meta.url);

type Json = Record<string, unknown>;
const readJson = async (url: URL): Promise<Json> => JSON.parse(await readFile(url, 'utf8')) as Json;

/** A week the run cannot place him in a club for: no stat, no opponent (season_block). */
const UNPLACED: Partial<GameLogRow> = {
	...Object.fromEntries(STAT_FIELDS.map((field) => [field, null])),
	snapShare: null,
	points: null,
	status: 'inactive',
	opponent: null,
	home: null
};

/** His season with some weeks rewritten, its totals and points a game the played weeks', as the
 * writer sums them (`_totals`, `points_per_game`). */
function withRows(
	season: PlayerSeason,
	rows: Readonly<Record<number, Partial<GameLogRow>>>
): PlayerSeason {
	const log = season.log.map((row) => ({ ...row, ...rows[row.week] }));
	const played = log.filter((row) => row.status === 'played');
	const sum = (field: keyof GameLogRow): number | null =>
		played.some((row) => row[field] === null)
			? null
			: played.reduce((total, row) => total + Number(row[field]), 0);
	const shares = played.map((row) => row.snapShare);
	const snapShare = shares.includes(null)
		? null
		: shares.reduce<number>((t, s) => t + (s ?? 0), 0) / shares.length;
	const totals = Object.fromEntries(
		Object.keys(season.totals).map((field) => [field, sum(field as keyof GameLogRow)])
	);
	const points = played.map((row) => Number(row.points));
	return {
		...season,
		log,
		games: played.length,
		pointsPerGame: pointsPerGameOf(points),
		totals: { ...totals, points: pointsTotalOf(points), snapShare } as PlayerSeason['totals']
	};
}

/** The week's game of a club on the run's slate, as a log row names it. */
function gameOf(
	schedule: ReturnType<typeof scheduleSchema.parse>,
	club: string,
	week: number
): Pick<GameLogRow, 'opponent' | 'home'> {
	const game = schedule.slates.find((s) => s.abbr === club)?.games.find((g) => g.week === week);
	if (game === undefined) throw new Error(`${club} has no week ${String(week)} game on the run.`);
	return { opponent: game.opponent, home: game.home };
}

/** His played row of `week` on the contract run. */
function lineOf(season: PlayerSeason, week: number): GameLogRow {
	const row = season.log.find((r) => r.week === week);
	if (row?.status !== 'played') throw new Error(`Gibbs has no week ${String(week)} line.`);
	return row;
}

function moved(page: Json, schedule: ReturnType<typeof scheduleSchema.parse>): Json {
	const season = page.season as PlayerSeason;
	const line = (week: number): GameLogRow => lineOf(season, week);
	const rows: Record<number, Partial<GameLogRow>> = {
		...Object.fromEntries(UNPLACED_WEEKS.map((week) => [week, UNPLACED])),
		5: { ...line(5), ...gameOf(schedule, MOVED_TO, 5) },
		6: { ...line(STAND_IN_WEEK), week: 6, ...gameOf(schedule, MOVED_TO, 6) }
	};
	return { ...page, season: withRows(season, rows), lastGameClub: { club: MOVED_TO, week: 6 } };
}

function specialTeams(page: Json, schedule: ReturnType<typeof scheduleSchema.parse>): Json {
	const season = page.season as PlayerSeason;
	const before = SPECIAL_TEAMS_WEEK - 1;
	const rows: Record<number, Partial<GameLogRow>> = {
		...Object.fromEntries(UNPLACED_WEEKS.map((week) => [week, UNPLACED])),
		[before]: { ...lineOf(season, before), ...gameOf(schedule, MOVED_TO, before) },
		[SPECIAL_TEAMS_WEEK]: { ...UNPLACED, ...gameOf(schedule, MOVED_TO, SPECIAL_TEAMS_WEEK) }
	};
	return {
		...page,
		season: withRows(season, rows),
		lastGameClub: { club: MOVED_TO, week: SPECIAL_TEAMS_WEEK, specialTeams: true }
	};
}

function freeAgent(page: Json): Json {
	const season = page.season as PlayerSeason;
	const later = season.log.filter((row) => row.week > LAST_CLUB_WEEK);
	const rows = {
		...Object.fromEntries(later.map((row) => [row.week, UNPLACED])),
		[UNNAMED_GAME_WEEK]: { ...UNPLACED, unnamedGame: true as const }
	};
	return {
		...page,
		team: FREE_AGENT_CLUB,
		season: withRows(season, rows),
		lastGameClub: { club: OWN_CLUB, week: LAST_CLUB_WEEK }
	};
}

await rm(OUT, { recursive: true, force: true });
await cp(SOURCE, OUT, { recursive: true });
const schedule = scheduleSchema.parse(await readJson(new URL('schedule.json', OUT)));
const pageUrl = new URL(`players/${GIBBS}.json`, OUT);
const page = await readJson(pageUrl);
if (page.team !== OWN_CLUB)
	throw new Error(`Gibbs's club on the contract run is ${String(page.team)}.`);
const rewritten =
	run === 'mover'
		? moved(page, schedule)
		: run === 'special-teams'
			? specialTeams(page, schedule)
			: freeAgent(page);
await writeFile(pageUrl, JSON.stringify(rewritten));
// His index entry says his club and his season as his page does (the build's reader holds them equal).
const indexUrl = new URL('index.json', OUT);
const rewrittenSeason = rewritten.season as PlayerSeason;
const index = JSON.parse(await readFile(indexUrl, 'utf8')) as Json[];
await writeFile(
	indexUrl,
	JSON.stringify(
		index.map((entry) =>
			entry.id === GIBBS
				? {
						...entry,
						team: rewritten.team,
						season: {
							games: rewrittenSeason.games,
							pointsPerGame: rewrittenSeason.pointsPerGame
						}
					}
				: entry
		)
	)
);
const manifestUrl = new URL('manifest.json', OUT);
await writeFile(manifestUrl, JSON.stringify({ ...(await readJson(manifestUrl)), runId: RUN_ID }));
process.stdout.write(`${RUN_ID}: Gibbs rewritten (${run}), written to ${OUT.pathname}\n`);
