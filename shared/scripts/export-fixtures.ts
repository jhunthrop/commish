/** The web's fixtures as JSON under shared/fixtures, for the apps' view-model and snapshot tests: the
 * mock's 2026 PPR data (web/src/fixtures/mock-2026-ppr.ts) and the in-season fixture league as the
 * FFPC league (web/scripts/inseason-fixture, the `fixture_platform=ffpc` stand-in), each answer the
 * API would give at the fixture's clocks, envelope and all, named by its route. README.md, written
 * beside them, lists each file with its route and its clock.
 *
 *   node shared/scripts/export-fixtures.ts
 *
 * The answers come from the fixture API itself (serve.ts), started once per clock on a free port with
 * its clock stopped there (frozen-clock.ts), so the export is the same on every run. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { REPOSITORY, generatedBy, writeOutputs, type Outputs } from './generated.ts';
import { PUBLIC_SHEET_PLAYER_IDS, SHEET_PLAYER_IDS } from './sheet-players.ts';
import { claimMove } from '../../web/src/lib/league/inseason/move.ts';
import type {
	HostMovePlan,
	TradeAdvice,
	WaiverAdvice
} from '../../web/src/lib/league/inseason/api.ts';
import { worthProposing } from '../../web/src/lib/league/box/trades.ts';
import { TRADE_NEEDS_COOKIE } from '../../web/scripts/inseason-fixture/trade-fills.ts';

const SCRIPT = 'shared/scripts/export-fixtures.ts';
const FIXTURES = 'shared/fixtures';
const MOCK_MODULE = 'web/src/fixtures/mock-2026-ppr.ts';
const SERVE = 'web/scripts/inseason-fixture/serve.ts';
const FROZEN_CLOCK = join(REPOSITORY, 'shared/scripts/frozen-clock.ts');
/** The cookie the fixture API reads the FFPC stand-in of the recorded league by. */
const FFPC_COOKIE = 'fixture_platform=ffpc';
/** The FFPC stand-in with the trade finder's newer fields asked for (trade-fills.ts, Lane 290). */
export const NEEDS_COOKIE = `${FFPC_COOKIE}; ${TRADE_NEEDS_COOKIE}`;
/** The cookie the fixture API reads the recorded Sleeper league's Sunday afternoon by, as the web's
 * Sunday shots do (serve.ts SUNDAY_WEEK): its noon games under way, their points so far stated. */
const SUNDAY_COOKIE = 'fixture_week=sunday';
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 100;

/** The fixture clocks a scoreboard is exported at, by name, from the fixture's own clock module. */
export interface FixtureClocks {
	week: string;
	thursdayNight: string;
	sunday: string;
	monday: string;
	live: string;
	tuesday: string;
}

/** The ESPN stand-ins whose claim the Waivers screen makes from here, by what it comes to. */
export interface EspnLeagues {
	done: string;
	refused: string;
	pending: string;
}

/** The fixture's league id, its ESPN stand-ins and its clocks (web/scripts/inseason-fixture/ids.ts
 * and clock.ts). */
interface FixtureSource {
	leagueId: string;
	espn?: EspnLeagues;
	clocks: FixtureClocks;
}

/** A claim's answer (Lane 186): planned for the first pickup of the Waivers answer in `waivers` with
 * no bid, as the web's first plan is; or made with the plan's token and its bid. */
export interface ClaimRead {
	waivers: string;
	plan: string | null;
}

/** A trade's check (Lane 189): the strip's trade at `index` (trades.ts worthProposing) in the trades
 * answer in `trades`, posted as the web's builder posts a finder row. */
export interface CheckRead {
	trades: string;
	index: number;
}

/** An answer's file: the route it answers, the clock it was read at, and what the file holds; a
 * claim's or a check's, the answers its body is built from. */
export interface FixtureFile {
	file: string;
	route: string;
	clock: string | null;
	about: string;
	claim?: ClaimRead;
	check?: CheckRead;
	/** The cookie it is read with where it is not the FFPC stand-in's: null for the recorded Sleeper
	 * league itself, as another team's game is read (Lane 206), which the platform stand-ins do not
	 * draw. */
	cookie?: string | null;
}

/** The roster whose game the other-game reads ask for: the one other game the fixture holds full
 * lines for (web/scripts/inseason-fixture/other-game.ts TAPPED_ROSTER, Carried by QJs). */
export const OTHER_GAME_ROSTER = 2;

/** The player the Trades holding picker narrows to in the fixtures, by board id: the member's Aaron
 * Rodgers, whom the strip's best trade gives (Lane 189 fix round 1). */
export const HOLDING_PLAYER = '8439';

/** The trades a clock's checks are posted for: the strip's two (trades.ts STRIP_MOST). */
export const CHECKED_TRADES = 2;

/** An instant as a file name part, with no colons: `2026-10-17T17:00:00.000Z` as `2026-10-17T17-00-00Z`. */
export function clockPart(iso: string): string {
	const at = new Date(Date.parse(iso));
	if (Number.isNaN(at.getTime())) throw new Error(`"${iso}" is not an instant.`);
	return at
		.toISOString()
		.replace(/\.\d{3}Z$/, 'Z')
		.replace(/:/g, '-');
}

/** The clocks the player sheet's weeks are read at (Lane 192): its game to come, the Sunday with the
 * noon games under way, and the Monday with them final. */
export const SHEET_CLOCKS: readonly ('week' | 'sunday' | 'monday')[] = ['week', 'sunday', 'monday'];

/** The answers to read at each clock, the League home's reads: the league list and the league once,
 * at the week's clock, with the week's games, and the scoreboard and the member's lineup at every
 * clock (the lineup's lines carry each player's game, which the game-state parity reads, Lane 176);
 * the Matchup's reads at every clock too, its box score and the league read whose matchup keeps the
 * score (Lane 183); the Waivers answer at every clock, and on each ESPN stand-in at the week's clock
 * its Waivers and the claim of its first pickup planned and made, done, refused and pending (Lane
 * 186); the trade finder at every clock, and at the week's and the Sunday's clocks the check of each
 * trade the strip names (Lane 189); at the sheet's clocks each sheet player's week, in the league
 * and, at the week's clock, with none (Lane 192); and the account and its paired devices at the
 * week's clock (Lane 198). */
export function fixturePlan(source: FixtureSource): { clock: string; files: FixtureFile[] }[] {
	const id = source.leagueId;
	const { week, ...rest } = source.clocks;
	const scoreboard = (clock: string, name: string): FixtureFile => ({
		file: `scoreboard-${id}-${clockPart(clock)}.json`,
		route: `GET /leagues/attached/${id}/scoreboard`,
		clock,
		about: `the week's scoreboard, ${name}`
	});
	const lineup = (clock: string, name: string): FixtureFile => ({
		file: `lineup-${id}-${clockPart(clock)}.json`,
		route: `GET /leagues/attached/${id}/lineup`,
		clock,
		about: `the member's lineup, ${name}`
	});
	const matchup = (clock: string, name: string): FixtureFile => ({
		file: `matchup-${id}-${clockPart(clock)}.json`,
		route: `GET /leagues/attached/${id}/matchup`,
		clock,
		about: `the week's matchup as a box score, ${name}`
	});
	const sync = (clock: string, name: string): FixtureFile => ({
		file: `sync-${id}-${clockPart(clock)}.json`,
		route: `GET /leagues/attached/${id}/sync`,
		clock,
		about: `the league read with its matchup's score, ${name}`
	});
	const player = (clock: string, name: string, board: string): FixtureFile => ({
		file: `player-${id}-${board}-${clockPart(clock)}.json`,
		route: `GET /leagues/attached/${id}/players/${board}`,
		clock,
		about: `a player sheet's week in the league, his verb with it, ${name}`
	});
	const publicPlayer = (clock: string, name: string, board: string): FixtureFile => ({
		file: `player-${board}-${clockPart(clock)}.json`,
		route: `GET /players/${board}/week`,
		clock,
		about: `a player sheet's week with no league, in PPR, ${name}`
	});
	const sheetClocks = new Set<string>(SHEET_CLOCKS.map((key) => source.clocks[key]));
	const waivers = (league: string, clock: string, name: string): FixtureFile => ({
		file: `waivers-${league}-${clockPart(clock)}.json`,
		route: `GET /leagues/attached/${league}/waivers`,
		clock,
		about: `the players free to add, ${name}`
	});
	const trades = (clock: string, name: string): FixtureFile => ({
		file: `trades-${id}-${clockPart(clock)}.json`,
		route: `GET /leagues/attached/${id}/trades`,
		clock,
		about: `the trade finder, ${name}`
	});
	const checks = (clock: string, name: string): FixtureFile[] =>
		Array.from({ length: CHECKED_TRADES }, (_, index) => ({
			file: `trade-check-${id}-${clockPart(clock)}-${String(index + 1)}.json`,
			route: `POST /leagues/attached/${id}/trades/check`,
			clock,
			about: `the check of the strip's trade ${String(index + 1)}, ${name}`,
			check: { trades: trades(clock, name).file, index }
		}));
	// Another team's game (Lane 206): its box by roster, and the league read and the scoreboard it
	// draws its names and score from, all three as the recorded Sleeper league reads them (on its
	// Sunday afternoon as the web's Sunday shots read it).
	const sleeper = (clock: string): string | null =>
		clock === source.clocks.sunday ? SUNDAY_COOKIE : null;
	const otherGame = (clock: string, name: string): FixtureFile[] => [
		{
			file: `matchup-${id}-roster-${String(OTHER_GAME_ROSTER)}-${clockPart(clock)}.json`,
			route: `GET /leagues/attached/${id}/matchup?roster=${String(OTHER_GAME_ROSTER)}`,
			clock,
			about: `another team's game as a box score, as the Sleeper league reads it, ${name}`,
			cookie: sleeper(clock)
		},
		{
			file: `sync-${id}-sleeper-${clockPart(clock)}.json`,
			route: `GET /leagues/attached/${id}/sync`,
			clock,
			about: `the league read as the Sleeper league reads it, ${name}`,
			cookie: sleeper(clock)
		},
		{
			file: `scoreboard-${id}-sleeper-${clockPart(clock)}.json`,
			route: `GET /leagues/attached/${id}/scoreboard`,
			clock,
			about: `the week's scoreboard as the Sleeper league reads it, ${name}`,
			cookie: sleeper(clock)
		}
	];
	const checked = new Set([source.clocks.week, source.clocks.sunday]);
	// The finder's newer fields (Lane 290): its rows' fills and lineup rest of season, each empty team's
	// reason and the host's offers, as the fixture serves them only when asked (trade-fills.ts), and the
	// check of the strip's first trade with them; at the week's clock, beside the recorded shape.
	const needs = (clock: string, name: string): FixtureFile[] => {
		const finder: FixtureFile = {
			file: `trades-${id}-needs-${clockPart(clock)}.json`,
			route: `GET /leagues/attached/${id}/trades`,
			clock,
			about: `the trade finder with each idea's fills, each empty team's reason and the host's offers, ${name}`,
			cookie: NEEDS_COOKIE
		};
		return [
			finder,
			{
				file: `trade-check-${id}-needs-${clockPart(clock)}-1.json`,
				route: `POST /leagues/attached/${id}/trades/check`,
				clock,
				about: `the check of the strip's trade 1 with each lineup's rest of season, ${name}`,
				check: { trades: finder.file, index: 0 },
				cookie: NEEDS_COOKIE
			}
		];
	};
	const orders = (clock: string, name: string): FixtureFile[] => orderFiles(clock, name);
	const atClock = (clock: string, name: string): FixtureFile[] => [
		scoreboard(clock, name),
		lineup(clock, name),
		matchup(clock, name),
		sync(clock, name),
		...otherGame(clock, name),
		waivers(id, clock, name),
		trades(clock, name),
		...(checked.has(clock) ? checks(clock, name) : []),
		...(clock === week ? needs(clock, name) : []),
		...(sheetClocks.has(clock) ? SHEET_PLAYER_IDS.map((board) => player(clock, name, board)) : []),
		...(clock === week
			? PUBLIC_SHEET_PLAYER_IDS.map((board) => publicPlayer(clock, name, board))
			: [])
	];
	const claims = Object.entries(source.espn ?? {}).flatMap(([outcome, league]): FixtureFile[] => {
		const pool = waivers(league, week, `the ESPN stand-in whose claim is ${outcome}`);
		const plan = `claim-plan-${league}.json`;
		return [
			pool,
			{
				file: plan,
				route: `POST /leagues/attached/${league}/moves/plan`,
				clock: week,
				about: `the claim of the first pickup planned, no bid typed, on the ESPN stand-in whose claim is ${outcome}`,
				claim: { waivers: pool.file, plan: null }
			},
			{
				file: `claim-move-${league}.json`,
				route: `POST /leagues/attached/${league}/moves`,
				clock: week,
				about: `the claim made with the plan's token and bid: ${outcome}`,
				claim: { waivers: pool.file, plan }
			}
		];
	});
	return [
		{
			clock: week,
			files: [
				{
					file: 'leagues-attached.json',
					route: 'GET /leagues/attached',
					clock: week,
					about: "the account's leagues, the FFPC league among the fixture's stand-ins"
				},
				{
					file: `leagues-attached-${id}.json`,
					route: `GET /leagues/attached/${id}/sync`,
					clock: week,
					about: "the FFPC league: teams, standings, moves, terms, the member's matchup"
				},
				{
					file: 'me.json',
					route: 'GET /me',
					clock: week,
					about: "the account (the Account screen's name, email and plan, and the switch's leagues)"
				},
				{
					file: 'devices.json',
					route: 'GET /devices',
					clock: week,
					about:
						"the account's paired devices: the member's iPhone and a browser extension never used"
				},
				{
					file: 'games-week.json',
					route: 'GET /games/week',
					clock: week,
					about: "the week's NFL games with their facts, as the platform games are drawn from"
				},
				{
					file: 'boards-ppr.json',
					route: 'GET /boards/ppr',
					clock: week,
					about: 'the PPR draft board as a dev API answered it (record-boards.ts), the Board screen'
				},
				...atClock(week, 'Saturday noon Central, every Sunday game to come'),
				{
					file: `waivers-${id}-DEF-${clockPart(week)}.json`,
					route: `GET /leagues/attached/${id}/waivers?position=DEF`,
					clock: week,
					about: 'the players free to add narrowed to defenses, as the D/ST chip reads them'
				},
				{
					file: `trades-${id}-player-${HOLDING_PLAYER}-${clockPart(week)}.json`,
					route: `GET /leagues/attached/${id}/trades?player=${HOLDING_PLAYER}`,
					clock: week,
					about:
						"the trades holding one player, the member's Aaron Rodgers, as the Trades holding picker reads them"
				},
				...claims,
				...orders(week, 'Saturday noon Central, every Sunday game to come')
			]
		},
		...Object.entries(rest).map(([name, clock]) => ({
			clock,
			files: [
				...atClock(clock, CLOCK_WORDS[name as keyof typeof rest]),
				...(name === 'sunday' ? orders(clock, CLOCK_WORDS.sunday).filter(sundayOrder) : [])
			]
		}))
	];
}

/** The order's reads the Rankings screen makes with no league (Lane 194, OrderScreen.svelte on the
 * Players page): every position and each of our order's four, each in the week's rankings with the
 * byes last and the page's first hundred rows; a search, alone and inside a position; and the
 * kickers' and defenses' week (WeekScreen.svelte). */
export const ORDER_READS: readonly {
	part: string;
	path: string;
	about: string;
}[] = [
	{ part: '', path: '', about: 'every position' },
	...(['QB', 'RB', 'WR', 'TE'] as const).map((position) => ({
		part: `-${position}`,
		path: `&position=${position}`,
		about: `the ${position}s alone`
	})),
	{
		part: '-q-wa',
		path: '&q=wa',
		about: 'the search "wa", the matches keeping their places'
	},
	{
		part: '-WR-q-wa',
		path: '&position=WR&q=wa',
		about: 'the search "wa" among the WRs, the matches keeping their places'
	}
];

/** The order's limit and the byes' order, as the Rankings page asks (order/path.ts). */
const ORDER_QUERY = 'limit=100&byes=last';

/** The order's whole read with the byes in their places, as the in-season pages read it at their clock
 * (web/src/lib/run/live-order-read.ts, the apps' OrderReader, Lane 224): the API's most rows, no byes. */
const FULL_ORDER_QUERY = 'limit=400';

/** Every order read at a clock: our order's views, its whole read, then the kickers' and defenses'
 * week. */
function orderFiles(clock: string, name: string): FixtureFile[] {
	const at = clockPart(clock);
	return [
		{
			file: `order-all-${at}.json`,
			route: `GET /order?${FULL_ORDER_QUERY}`,
			clock,
			about: `our rest-of-season order with no league, every row with the byes in their places, as the in-season pages read it, ${name}`
		},
		...ORDER_READS.map((read) => ({
			file: `order${read.part}-${at}.json`,
			route: `GET /order?${ORDER_QUERY}${read.path}`,
			clock,
			about: `our rest-of-season order with no league, ${read.about}, ${name}`
		})),
		...(['K', 'DEF'] as const).map((position) => ({
			file: `order-week-${position}-${at}.json`,
			route: `GET /order/week?position=${position}`,
			clock,
			about: `this week's ${position === 'K' ? 'kickers' : 'defenses'} with no league, in the published projection's order, ${name}`
		}))
	];
}

/** On Sunday the order with every position and the kickers' week, a game kicked off among them. */
function sundayOrder(file: FixtureFile): boolean {
	return (
		file.file.startsWith('order-2') ||
		file.file.startsWith('order-all-') ||
		file.file.startsWith('order-week-K-')
	);
}

const CLOCK_WORDS: Readonly<Record<Exclude<keyof FixtureClocks, 'week'>, string>> = {
	thursdayNight: 'Thursday night, the Thursday game under way',
	sunday: 'Sunday afternoon, the noon games in their fourth quarter',
	monday: 'Monday morning, every Sunday game final',
	live: 'Monday night, the Monday game in its first quarter',
	tuesday: 'Tuesday noon, every game of the week final'
};

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

async function waitFor(origin: string, child: ChildProcess): Promise<void> {
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`${SERVE} exited with ${String(child.exitCode)}.`);
		try {
			if ((await fetch(`${origin}/fixture/clock`)).ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
	throw new Error(`${SERVE} did not answer within ${String(START_TIMEOUT_MS)} ms.`);
}

interface Envelope<T> {
	data: T;
}

/** A claim's body, as the web's Waivers sends it (move.ts claimMove): the first pickup's add and
 * drop with no bid when planned; made, the move planned with the plan's bid and its token. */
export function claimBody(file: FixtureFile, answers: ReadonlyMap<string, unknown>): unknown {
	const { claim } = file;
	if (claim === undefined) return undefined;
	const advice = (answers.get(claim.waivers) as Envelope<WaiverAdvice> | undefined)?.data;
	const row = advice?.pickups[0];
	if (advice === undefined || row === undefined)
		throw new Error(`${claim.waivers} has no pickup to claim.`);
	if (claim.plan === null) return claimMove(advice.week, row, null);
	const plan = (answers.get(claim.plan) as Envelope<HostMovePlan> | undefined)?.data;
	if (plan?.confirm == null) throw new Error(`${claim.plan} has no token to make the claim with.`);
	return {
		move: claimMove(advice.week, row, plan.bid?.amount ?? null),
		confirm: plan.confirm
	};
}

/** A check's body, as the web's builder sends a finder row (builder.ts builtFrom): the strip's trade's
 * team and both sides by host id. */
export function checkBody(file: FixtureFile, answers: ReadonlyMap<string, unknown>): unknown {
	const { check } = file;
	if (check === undefined) return undefined;
	const advice = (answers.get(check.trades) as Envelope<TradeAdvice> | undefined)?.data;
	const entry = advice === undefined ? undefined : worthProposing(advice.teams)[check.index];
	if (entry === undefined)
		throw new Error(`${check.trades} has no strip trade ${String(check.index + 1)}.`);
	const ids = (side: readonly { player: { host_id: string } }[]): string[] =>
		side.map((line) => line.player.host_id);
	return { team: entry.team.roster_id, give: ids(entry.row.give), get: ids(entry.row.get) };
}

/** A file posted after the answers its body is built from: a claim or a check. */
const posted = (file: FixtureFile): boolean => file.claim !== undefined || file.check !== undefined;

/** The cookie header a file is read with: the FFPC stand-in's unless the file names its own or none. */
function cookieOf(file: FixtureFile): { cookie?: string } {
	const cookie = file.cookie === undefined ? FFPC_COOKIE : file.cookie;
	return cookie === null ? {} : { cookie };
}

/** Starts the fixture API on `clock`, stopped there, reads each file's route and stops it. */
async function readAt(clock: string, files: readonly FixtureFile[]): Promise<[string, string][]> {
	const port = await freePort();
	const origin = `http://127.0.0.1:${String(port)}`;
	// A clean environment: no FIXTURE_* flag of the caller's changes what the API answers.
	const child = spawn(process.execPath, ['--import', FROZEN_CLOCK, join(REPOSITORY, SERVE)], {
		env: {
			PATH: process.env.PATH ?? '',
			PORT: String(port),
			FIXTURE_CLOCK: clock,
			FROZEN_CLOCK: clock
		},
		stdio: ['ignore', 'ignore', 'inherit']
	});
	const read = async (file: FixtureFile, body: unknown): Promise<unknown> => {
		const [method = 'GET', path = ''] = file.route.split(' ');
		const response = await fetch(`${origin}${path}`, {
			method,
			headers: {
				...cookieOf(file),
				'content-type': 'application/json'
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});
		if (!response.ok)
			throw new Error(`${file.route} at ${clock} answered ${String(response.status)}.`);
		return response.json();
	};
	try {
		await waitFor(origin, child);
		const answers = new Map<string, unknown>();
		const gets = files.filter((file) => !posted(file));
		await Promise.all(
			gets.map(async (file) => answers.set(file.file, await read(file, undefined)))
		);
		// A claim or a check after the answers its body is built from, one at a time, in the plan's
		// order.
		for (const file of files.filter(posted))
			answers.set(
				file.file,
				await read(
					file,
					file.check === undefined ? claimBody(file, answers) : checkBody(file, answers)
				)
			);
		return files.map((file): [string, string] => [
			`${FIXTURES}/inseason/${file.file}`,
			`${JSON.stringify(answers.get(file.file), null, '\t')}\n`
		]);
	} finally {
		child.kill();
	}
}

/** The mock's data: every export of the module, by its name. */
async function mockFixture(): Promise<string> {
	const module = (await import(join(REPOSITORY, MOCK_MODULE))) as Record<string, unknown>;
	for (const [name, value] of Object.entries(module)) {
		if (typeof value === 'function') throw new Error(`${MOCK_MODULE} exports ${name}, a function.`);
	}
	const sorted = Object.fromEntries(Object.entries(module).sort(([a], [b]) => a.localeCompare(b)));
	return `${JSON.stringify(sorted, null, '\t')}\n`;
}

function readme(plan: ReturnType<typeof fixturePlan>, source: FixtureSource): string {
	const rows = plan
		.flatMap((step) => step.files)
		.map((f) => `| \`inseason/${f.file}\` | \`${f.route}\` | ${f.clock ?? ''} | ${f.about} |`);
	const clocks = Object.entries(source.clocks).map(
		([name, clock]) => `- \`${name}\`: ${clock} (${clockPart(clock)} in a file name)`
	);
	return `# Shared fixtures

${generatedBy(SCRIPT, `${MOCK_MODULE} and ${SERVE}`)}

The apps' view-model and snapshot tests read these, so the iOS app, the Android app and the web are
tested on the same data. Each in-season file is one answer of the fixture API (the stand-in of the
request API the web's shots run against) exactly as it sends it, the envelope (\`ok\`, \`data\`,
\`error\`) included, read with its clock stopped at the instant named. The league is the recorded
Sleeper league as the FFPC stand-in reads it (cookie \`${FFPC_COOKIE}\`), id \`${source.leagueId}\`,
save another team's game and the reads it is drawn with, read as the Sleeper league itself (no cookie,
or \`${SUNDAY_COOKIE}\` at the Sunday clock).
A test that draws a screen at a clock passes the same instant as its injected clock.

| File | Route | Clock | What it holds |
| --- | --- | --- | --- |
| \`mock-2026-ppr.json\` | none | none | the mock's 2026 PPR data, every export of \`${MOCK_MODULE}\` by name |
${rows.join('\n')}

## The fixture clocks

${clocks.join('\n')}
`;
}

async function fixtureSource(): Promise<FixtureSource> {
	const ids = (await import(join(REPOSITORY, 'web/scripts/inseason-fixture/ids.ts'))) as {
		FIXTURE_IDS: {
			league: string;
			espnDone: string;
			espnRefused: string;
			espnPending: string;
		};
	};
	const c = (await import(join(REPOSITORY, 'web/scripts/inseason-fixture/clock.ts'))) as Record<
		string,
		string
	>;
	const clock = (name: string): string => {
		const value = c[name];
		if (typeof value !== 'string') throw new Error(`clock.ts exports no ${name}.`);
		return value;
	};
	return {
		leagueId: ids.FIXTURE_IDS.league,
		espn: {
			done: ids.FIXTURE_IDS.espnDone,
			refused: ids.FIXTURE_IDS.espnRefused,
			pending: ids.FIXTURE_IDS.espnPending
		},
		clocks: {
			week: clock('FIXTURE_WEEK_CLOCK'),
			thursdayNight: clock('FIXTURE_THURSDAY_NIGHT_CLOCK'),
			sunday: clock('FIXTURE_SUNDAY_CLOCK'),
			monday: clock('FIXTURE_MONDAY_CLOCK'),
			live: clock('FIXTURE_LIVE_CLOCK'),
			tuesday: clock('FIXTURE_TUESDAY_CLOCK')
		}
	};
}

export async function generate(): Promise<Outputs> {
	const source = await fixtureSource();
	const plan = fixturePlan(source);
	const answers: [string, string][] = [];
	// One clock at a time: each starts its own fixture API.
	for (const step of plan) answers.push(...(await readAt(step.clock, step.files)));
	return new Map([
		[`${FIXTURES}/mock-2026-ppr.json`, await mockFixture()],
		...answers,
		[`${FIXTURES}/README.md`, readme(plan, source)]
	]);
}

if (import.meta.main) await writeOutputs(await generate());
