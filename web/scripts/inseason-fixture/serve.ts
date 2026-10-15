// A stand-in for the request API's league reads, answering from the fixture build.ts writes, so the
// in-season screens can be built and shot before the API's routes land (Lane 25). Signed in as one
// account that follows the recorded Sleeper league. Three attachment ids:
// FIXTURE_IDS (ids.ts) names them: the league, the league out of season (409 on the in-season
// routes) and the league held (a page shows its loading rows).
// Every answer is the API's envelope, with the league's read stamped a few minutes before the call.
//
//   PORT=8799 node scripts/inseason-fixture/serve.ts
// and build the site with PUBLIC_API_URL=http://localhost:8799.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type { TradeAdvice } from '../../src/lib/league/inseason/types.ts';
import type { components } from '../../src/lib/api/types.ts';
import { FIXTURE_IDS } from './ids.ts';

const PORT = Number(process.env.PORT ?? 8799);
const DATA = new URL('./data/', import.meta.url);
const { league: LEAGUE, outOfSeason: OUT_OF_SEASON, slow: SLOW } = FIXTURE_IDS;
const READ_MINUTES_AGO = 4;
const MINUTE_MS = 60_000;
const HOLD_MS = 10 * MINUTE_MS;
const HTTP = { ok: 200, noContent: 204, notFound: 404, conflict: 409 } as const;

async function load<T>(name: string): Promise<T> {
	return JSON.parse(await readFile(new URL(`${name}.json`, DATA), 'utf8')) as T;
}

const [sync, lineup, waivers, trades] = await Promise.all([
	load<LeagueSync>('sync'),
	load<object>('lineup'),
	load<object>('waivers'),
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
		send(req, res, HTTP.ok, [
			{
				id: LEAGUE,
				host: sync.host,
				host_league_id: sync.host_league_id,
				season: sync.season,
				name: sync.name,
				roster_id: sync.me,
				team_name: contextLeague.team_name,
				standing: contextLeague.standing,
				attached_at: '2026-09-01T12:00:00.000Z'
			}
		]);
		return;
	}
	const synced = SYNC.exec(url.pathname);
	if (synced) {
		send(req, res, HTTP.ok, { ...sync, id: synced[1], read_at: readAt() });
		return;
	}
	const inSeason = IN_SEASON.exec(url.pathname);
	if (inSeason) {
		const [, id, route] = inSeason;
		if (id === OUT_OF_SEASON) {
			send(req, res, HTTP.conflict, 'Your league is not in season, so there is nothing to set.');
			return;
		}
		if (id === SLOW) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
		const bodies = {
			lineup,
			waivers,
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
