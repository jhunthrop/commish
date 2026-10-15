// A stand-in for the request API's league reads, answering from the fixture build.ts writes, so the
// in-season screens can be built and shot before the API's routes land (Lane 25). Signed in as one
// account that follows the recorded Sleeper league, and three ESPN stand-ins of it whose lineup the
// member may set from our screen (Lane 35): the move done, refused in ESPN's captured words, and
// pending. Attachment ids:
// FIXTURE_IDS (ids.ts) names them: the league, the league out of season (409 on the in-season
// routes) and the league held (a page shows its loading rows).
// Every answer is the API's envelope, with the league's read stamped a few minutes before the call.
//
//   PORT=8799 node scripts/inseason-fixture/serve.ts
// and build the site with PUBLIC_API_URL=http://localhost:8799.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type {
	HostMovePlan,
	HostMoveResult,
	LineupAdvice,
	TradeAdvice,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import type { components } from '../../src/lib/api/types.ts';
import { FIXTURE_IDS } from './ids.ts';

const PORT = Number(process.env.PORT ?? 8799);
const DATA = new URL('./data/', import.meta.url);
const {
	league: LEAGUE,
	outOfSeason: OUT_OF_SEASON,
	slow: SLOW,
	noTeam: NO_TEAM,
	espnDone: ESPN_DONE,
	espnRefused: ESPN_REFUSED,
	espnPending: ESPN_PENDING
} = FIXTURE_IDS;
/** The leagues the fixture answers as ESPN's, each with what its move comes to. */
const ESPN_MOVES = new Map<string, 'done' | 'refused' | 'pending'>([
	[ESPN_DONE, 'done'],
	[ESPN_REFUSED, 'refused'],
	[ESPN_PENDING, 'pending']
]);
/** The API's own sentences for a move (api/internal/hostmoves words.go). */
const MOVE_SENTENCES = {
	done: 'Set on ESPN. Your lineup there now reads as ours.',
	refused: 'ESPN did not make the move, so nothing changed there.',
	pending:
		'Sent to ESPN, but your lineup there did not show it when we read it back. Check your lineup on ESPN before you set it again.'
} as const;
const ESPN_LINEUP_URL =
	'https://fantasy.espn.com/football/team?leagueId=1081607624&seasonId=2026&teamId=3';
/** The API's own sentences (api/internal/inseason): leaguesync.NoGamesWords and noTeamWords. */
const NO_GAMES = 'Your league has no games this week.';
const NO_TEAM_WORDS = "We could not find your team in this league's last read.";
const READ_MINUTES_AGO = 4;
const MINUTE_MS = 60_000;
const HOLD_MS = 10 * MINUTE_MS;
const HTTP = { ok: 200, noContent: 204, notFound: 404, conflict: 409 } as const;

async function load<T>(name: string): Promise<T> {
	return JSON.parse(await readFile(new URL(`${name}.json`, DATA), 'utf8')) as T;
}

const [sync, lineup, waivers, trades] = await Promise.all([
	load<LeagueSync>('sync'),
	load<LineupAdvice>('lineup'),
	load<WaiverAdvice>('waivers'),
	load<TradeAdvice>('trades')
]);

const myTeam = sync.teams.find((t) => t.roster_id === sync.me);
const contextLeague: components['schemas']['ContextLeague'] = {
	id: LEAGUE,
	name: sync.name,
	host: sync.host,
	team_name: myTeam?.name ?? '',
	standing: myTeam
		? {
				wins: myTeam.wins,
				losses: myTeam.losses,
				ties: myTeam.ties,
				place: sync.teams.indexOf(myTeam) + 1,
				teams: sync.teams.length
			}
		: null,
	scoring: sync.scoring_like,
	format: sync.board_format,
	settings_league_id: null
};
const account: components['schemas']['Account'] = {
	id: '6f1d1c52-2626-4a26-9a26-0000000000a1',
	email: 'fixture@example.com',
	league: contextLeague,
	leagues: [contextLeague],
	format: contextLeague.format,
	first_name: null,
	last_name: null,
	handle: 'fixture',
	features: [],
	draft_pass: null,
	membership: null,
	created_at: '2026-09-01T12:00:00.000Z'
};

const readAt = (): string => new Date(Date.now() - READ_MINUTES_AGO * MINUTE_MS).toISOString();

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Access-Control-Allow-Origin': req.headers.origin ?? '*',
		'Access-Control-Allow-Credentials': 'true'
	});
	const ok = status < 300;
	res.end(
		JSON.stringify({
			ok,
			data: ok ? body : null,
			error: ok ? null : { code: 'fixture', message: String(body) }
		})
	);
}

/** The trades holding one player, by his board id, every team kept. */
function waiversAt(position: string | null): WaiverAdvice {
	if (position === null) return waivers;
	const rows = waivers.rows.filter((row) => row.add.player.position === position);
	return { ...waivers, rows, best: rows.find((row) => row.gain > 0) ?? null };
}

function tradesHolding(player: string | null): TradeAdvice {
	if (player === null) return trades;
	const holds = (side: { player: { board_id: string | null } }[]): boolean =>
		side.some((line) => line.player.board_id === player);
	return {
		...trades,
		teams: trades.teams.map((team) => ({
			...team,
			trades: team.trades.filter((row) => holds(row.give) || holds(row.get))
		}))
	};
}

const IN_SEASON = /^\/leagues\/attached\/([^/]+)\/(lineup|waivers|trades)$/;
const MOVES = /^\/leagues\/attached\/([^/]+)\/moves(\/plan)?$/;

/** A changed slot's place in the API's words: "at RB", "in the flex". */
function slotPlace(slot: string): string {
	if (slot === 'FLEX') return 'in the flex';
	if (slot === 'SUPERFLEX') return 'in the superflex';
	return `at ${slot}`;
}

/** The plan's sentence as the API words it (hostmoves lineupWords): every change, then the host. */
function planSentence(): string {
	const clauses = lineup.slots
		.filter((slot) => slot.changed)
		.map(
			(slot) =>
				`${slot.ours.player.name}${slot.host ? ` over ${slot.host.player.name}` : ''} ${slotPlace(slot.slot)}`
		);
	const joined =
		clauses.length < 2
			? (clauses[0] ?? '')
			: `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1) ?? ''}`;
	return `Start ${joined}, on ESPN now.`;
}

/** The ESPN league's lineup: the move open, the verb ESPN's lineup page. */
function espnLineup(): LineupAdvice {
	return {
		...lineup,
		host_lineup_url: ESPN_LINEUP_URL,
		moves: { lineup: 'available', note: null }
	};
}

/** A move on an ESPN fixture league: the plan in words with a token, or what the move came to. */
function moveAnswer(id: string, plan: boolean): HostMovePlan | HostMoveResult {
	if (plan) {
		return {
			status: 'ready',
			sentence: planSentence(),
			confirm: 'fixture-token',
			expires_at: new Date(Date.now() + HOLD_MS).toISOString(),
			host_url: ESPN_LINEUP_URL
		};
	}
	const outcome = ESPN_MOVES.get(id) ?? 'done';
	const first = lineup.slots.find((slot) => slot.changed)?.ours.player.name ?? '';
	return {
		outcome,
		sentence: MOVE_SENTENCES[outcome],
		// ESPN's refusal as captured live (jwulff 05-espn-write-surface.md 5.1, TRAN_LINEUP_LOCKED).
		host_words:
			outcome === 'refused'
				? `Lineup transaction could not be completed, ${first} is locked`
				: null,
		host_url: ESPN_LINEUP_URL,
		move_id: '6f1d1c52-2626-4a26-9a26-0000000000f1'
	};
}
const SYNC = /^\/leagues\/attached\/([^/]+)\/(sync|refresh)$/;

async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const url = new URL(req.url ?? '/', `http://localhost:${String(PORT)}`);
	if (req.method === 'OPTIONS') {
		res.writeHead(HTTP.noContent, {
			'Access-Control-Allow-Origin': req.headers.origin ?? '*',
			'Access-Control-Allow-Credentials': 'true',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
			'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, Accept'
		});
		res.end();
		return;
	}
	if (url.pathname === '/me' || url.pathname === '/me/league') {
		send(req, res, HTTP.ok, account);
		return;
	}
	if (url.pathname === '/sheets') {
		send(req, res, HTTP.ok, []);
		return;
	}
	if (url.pathname === '/leagues/attached') {
		// Every fixture league is on the account; only the first is in the switch's list (/me), so
		// the page names the others from this list.
		send(
			req,
			res,
			HTTP.ok,
			Object.values(FIXTURE_IDS).map((id) => ({
				id,
				host: ESPN_MOVES.has(id) ? 'espn' : sync.host,
				host_league_id: sync.host_league_id,
				season: sync.season,
				name: sync.name,
				roster_id: sync.me,
				team_name: contextLeague.team_name,
				standing: contextLeague.standing,
				attached_at: '2026-09-01T12:00:00.000Z'
			}))
		);
		return;
	}
	const synced = SYNC.exec(url.pathname);
	if (synced) {
		send(req, res, HTTP.ok, { ...sync, id: synced[1], read_at: readAt() });
		return;
	}
	const moved = MOVES.exec(url.pathname);
	if (moved && req.method === 'POST') {
		send(req, res, HTTP.ok, moveAnswer(moved[1] ?? '', moved[2] !== undefined));
		return;
	}
	const inSeason = IN_SEASON.exec(url.pathname);
	if (inSeason) {
		const [, id, route] = inSeason;
		if (id === OUT_OF_SEASON) {
			send(req, res, HTTP.conflict, NO_GAMES);
			return;
		}
		if (id === NO_TEAM) {
			send(req, res, HTTP.notFound, NO_TEAM_WORDS);
			return;
		}
		if (id === SLOW) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
		const bodies = {
			lineup: ESPN_MOVES.has(id ?? '') ? espnLineup() : lineup,
			waivers: waiversAt(url.searchParams.get('position')),
			trades: tradesHolding(url.searchParams.get('player'))
		} as const;
		send(req, res, HTTP.ok, { ...bodies[route as keyof typeof bodies], read_at: readAt() });
		return;
	}
	send(req, res, HTTP.notFound, 'Not in the fixture.');
}

createServer((req, res) => void answer(req, res)).listen(PORT, () => {
	process.stdout.write(`In-season fixture API on http://localhost:${String(PORT)}\n`);
});
