// A stand-in for the request API's league reads, answering from the fixture build.ts writes, so the
// in-season screens can be built and shot before the API's routes land (Lane 25). Signed in as one
// account that follows the recorded Sleeper league, and three ESPN stand-ins of it whose lineup the
// member may set, and whose adds the member may claim, from our screen (Lanes 35 and 39): the move
// done, refused in ESPN's captured words, and pending. Attachment ids:
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
	HostMoveInput,
	HostMovePlan,
	HostMoveResult,
	LineupAdvice,
	TradeAdvice,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import type { components } from '../../src/lib/api/types.ts';
import { FIXTURE_IDS } from './ids.ts';
import { FIXTURE_SEASON, askedPhase, phaseAccount, phaseLeagues, phaseSync } from './phases.ts';

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
/** The API's own sentences for a claim (api/internal/hostmoves words.go and claim.go). */
const CLAIM_SENTENCES = {
	done: 'Done on ESPN. He is on your roster there now.',
	refused: 'ESPN did not take the claim, so nothing changed there.',
	pending:
		'Claim submitted. ESPN processes claims on Wednesday, and your lineup screen will show him once it goes through.'
} as const;
/** The stand-in leagues' waiver settings: the pending one bids (a budget of 100, 13 spent), the
 * done one adds a free agent at once, the refused one does not bid. */
const CLAIM_BUDGET = { min: 0, max: 87 } as const;
/** When the pending league's claims run: ESPN's processDate, a Wednesday's 07:00 UTC. */
const CLAIM_RUNS_AT = '2026-10-21T07:00:00.000Z';
const ESPN_LEAGUE_URL =
	'https://fantasy.espn.com/football/league?leagueId=1081607624&seasonId=2026';
const ESPN_LINEUP_URL =
	'https://fantasy.espn.com/football/team?leagueId=1081607624&seasonId=2026&teamId=3';
/** The API's own sentences (api/internal/inseason): leaguesync.NoGamesWords and noTeamWords. */
const NO_GAMES = 'Your league has no games this week.';
const NO_TEAM_WORDS = "We could not find your team in this league's last read.";
const READ_MINUTES_AGO = 4;
const MINUTE_MS = 60_000;
const HOLD_MS = 10 * MINUTE_MS;
const HTTP = { ok: 200, noContent: 204, badRequest: 400, notFound: 404, conflict: 409 } as const;

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
const contextBase = {
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
/** The leagues as the switch lists them, one per season phase (phases.ts), drafts timed from now. */
const leaguesNow = (): components['schemas']['ContextLeague'][] =>
	phaseLeagues(contextBase, Date.now());
const contextLeague = leaguesNow().find((league) => league.id === LEAGUE);
if (!contextLeague) throw new Error('The fixture has no in-season league.');
const account: components['schemas']['Account'] = {
	id: '6f1d1c52-2626-4a26-9a26-0000000000a1',
	email: 'fixture@example.com',
	league: contextLeague,
	leagues: [contextLeague],
	format: contextLeague.format,
	season: FIXTURE_SEASON,
	first_name: null,
	last_name: null,
	handle: 'fixture',
	features: [],
	draft_pass: null,
	membership: null,
	created_at: '2026-09-01T12:00:00.000Z'
};

const readAt = (): string => new Date(Date.now() - READ_MINUTES_AGO * MINUTE_MS).toISOString();

function send(
	req: IncomingMessage,
	res: ServerResponse,
	status: number,
	body: unknown,
	code = 'fixture'
): void {
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
			error: ok ? null : { code, message: String(body) }
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

/** The shape of a host id the claim route takes (api hostmoves checkClaim). */
const HOST_ID = /^-?[0-9]{1,12}$/;
/** The API's words for a claim whose add it cannot name (hostmoves claimFormWords). */
const CLAIM_FORM_WORDS = 'Send the claim from the waivers screen.';

/** The ESPN league's waivers, as the API answers an ESPN league: each add named by his board id
 * (ESPN's own), the claim open, the verb ESPN's league page. A defense needs ESPN's D/ST id, which
 * the fixture does not carry, so it keeps no host id and its Add stays the host's page. */
function espnWaivers(position: string | null): WaiverAdvice {
	const named = waiversAt(position);
	const withId = (row: WaiverAdvice['rows'][number]): WaiverAdvice['rows'][number] => {
		const board = row.add.player.board_id ?? '';
		const hostId = row.add.player.position !== 'DEF' && HOST_ID.test(board) ? board : '';
		return { ...row, add: { ...row.add, player: { ...row.add.player, host_id: hostId } } };
	};
	return {
		...named,
		rows: named.rows.map(withId),
		best: named.best ? withId(named.best) : null,
		host_waivers_url: ESPN_LEAGUE_URL,
		moves: { claim: 'available', note: null }
	};
}

/** A player in the waiver answer by his host id, for the plan's words. */
function nameOf(hostId: string | null): string {
	const lines = waivers.rows.flatMap((row) => (row.drop ? [row.add, row.drop] : [row.add]));
	return lines.find((line) => line.player.host_id === hostId)?.player.name ?? '';
}

/** A claim on an ESPN fixture league: the plan in the API's words with a token (and the bid where
 * the league bids), or what the claim came to. */
function claimAnswer(
	id: string,
	plan: boolean,
	move: HostMoveInput
): HostMovePlan | HostMoveResult {
	const outcome = ESPN_MOVES.get(id) ?? 'done';
	const claim = move.claim ?? { add: '', drop: null, bid: null };
	if (plan) {
		const bids = outcome === 'pending';
		const amount = claim.bid ?? CLAIM_BUDGET.min;
		const named = `Add ${nameOf(claim.add)}${claim.drop ? `, drop ${nameOf(claim.drop)}` : ''}`;
		const bidWords = bids ? `, bid $${String(amount)}` : '';
		const sentence =
			outcome === 'done'
				? `${named}, on ESPN now. He is a free agent, so the add is made at once.`
				: `${named}${bidWords}. He is on waivers, so ESPN runs the claim on Wednesday.`;
		return {
			status: 'ready',
			sentence,
			confirm: 'fixture-token',
			expires_at: new Date(Date.now() + HOLD_MS).toISOString(),
			host_url: ESPN_LEAGUE_URL,
			bid: bids ? { amount, ...CLAIM_BUDGET, left_known: true } : null
		};
	}
	return {
		outcome,
		sentence: CLAIM_SENTENCES[outcome],
		// ESPN's refusal as captured live (jwulff 06-espn-add-drop-surface p1, TRAN_PLAYER_NOT_FREEAGENT).
		host_words: outcome === 'refused' ? `Player ${claim.add} is not a free agent` : null,
		host_url: ESPN_LEAGUE_URL,
		move_id: '6f1d1c52-2626-4a26-9a26-0000000000f2',
		processes_at: outcome === 'pending' ? CLAIM_RUNS_AT : null
	};
}

/** A move on an ESPN fixture league: the plan in words with a token, or what the move came to. */
function moveAnswer(id: string, plan: boolean, body: unknown): HostMovePlan | HostMoveResult {
	const move = (plan ? body : (body as { move?: unknown } | null)?.move) as
		HostMoveInput | undefined;
	if (move?.kind === 'claim') return claimAnswer(id, plan, move);
	if (plan) {
		return {
			status: 'ready',
			sentence: planSentence(),
			confirm: 'fixture-token',
			expires_at: new Date(Date.now() + HOLD_MS).toISOString(),
			host_url: ESPN_LINEUP_URL,
			bid: null
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
		move_id: '6f1d1c52-2626-4a26-9a26-0000000000f1',
		processes_at: null
	};
}

/** A request's JSON body, or null when it has none. */
async function bodyOf(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const text = Buffer.concat(chunks).toString('utf8');
	return text === '' ? null : (JSON.parse(text) as unknown);
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
		const { phase, one } = askedPhase(req.headers.cookie);
		const leagues = leaguesNow();
		const asked = url.pathname === '/me/league' ? await bodyOf(req) : null;
		const chosen = (asked as { league_id?: string } | null)?.league_id;
		const answer = phaseAccount(account, leagues, phase, one);
		const picked = leagues.find((league) => league.id === chosen);
		send(req, res, HTTP.ok, picked ? { ...answer, league: picked } : answer);
		return;
	}
	if (url.pathname === '/season') {
		send(req, res, HTTP.ok, FIXTURE_SEASON);
		return;
	}
	// The account page's other lists, empty for the fixture account.
	if (url.pathname === '/mocks' || url.pathname === '/billing/group-passes') {
		send(req, res, HTTP.ok, []);
		return;
	}
	if (url.pathname === '/sheets') {
		send(req, res, HTTP.ok, []);
		return;
	}
	if (url.pathname === '/leagues/attached') {
		// Every fixture league is on the account; only the first is in the switch's list (/me), so
		// the page names the others from this list.
		const phased = new Map(leaguesNow().map((league) => [league.id, league]));
		send(
			req,
			res,
			HTTP.ok,
			Object.values(FIXTURE_IDS).map((id) => {
				const league = phased.get(id) ?? { ...contextLeague, name: sync.name };
				return {
					id,
					host: ESPN_MOVES.has(id) ? 'espn' : sync.host,
					host_league_id: sync.host_league_id,
					season: sync.season,
					name: league.name,
					roster_id: sync.me,
					team_name: league.team_name,
					standing: league.standing,
					attached_at: '2026-09-01T12:00:00.000Z',
					phase: league.phase,
					phase_basis: league.phase_basis,
					draft_at: league.draft_at,
					playoff_start_week: league.playoff_start_week,
					waivers_open: league.waivers_open
				};
			})
		);
		return;
	}
	const synced = SYNC.exec(url.pathname);
	if (synced) {
		send(req, res, HTTP.ok, {
			...phaseSync(sync, synced[1] ?? ''),
			id: synced[1],
			read_at: readAt()
		});
		return;
	}
	const moved = MOVES.exec(url.pathname);
	if (moved && req.method === 'POST') {
		const body = await bodyOf(req);
		const move = (moved[2] !== undefined ? body : (body as { move?: unknown } | null)?.move) as
			HostMoveInput | undefined;
		// The API's own form check: an add it cannot name is refused before anything is read.
		if (move?.kind === 'claim' && !HOST_ID.test(move.claim?.add ?? '')) {
			send(req, res, HTTP.badRequest, CLAIM_FORM_WORDS, 'invalid');
			return;
		}
		send(req, res, HTTP.ok, moveAnswer(moved[1] ?? '', moved[2] !== undefined, body));
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
			send(req, res, HTTP.notFound, NO_TEAM_WORDS, 'team_not_read');
			return;
		}
		if (id === SLOW) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
		const bodies = {
			lineup: ESPN_MOVES.has(id ?? '') ? espnLineup() : lineup,
			waivers: ESPN_MOVES.has(id ?? '')
				? espnWaivers(url.searchParams.get('position'))
				: waiversAt(url.searchParams.get('position')),
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
