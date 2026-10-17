// A stand-in for the request API's league reads, answering from the fixture build.ts writes, so the
// in-season screens can be built and shot before the API's routes land (Lane 25). Signed in as one
// account that follows the recorded Sleeper league, and three ESPN stand-ins of it whose lineup the
// member may set, and whose adds the member may claim, from our screen (Lanes 35 and 39): the move
// done, refused in ESPN's captured words, and pending. Attachment ids:
// FIXTURE_IDS (ids.ts) names them: the league, the league out of season (409 on the in-season
// routes) and the league held (a page shows its loading rows). The trade builder's check answers a
// trade the finder lists with its own row, and any other with a plain stand-in (tradeCheck).
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
	MatchupBox,
	Scoreboard,
	PlayerLine,
	TradeAdvice,
	TradeCheck,
	TradeCheckInput,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import type { components } from '../../src/lib/api/types.ts';
import type { GameWeek } from '../../src/lib/format/game-facts.ts';
import { FIXTURE_IDS } from './ids.ts';
import { playerWeek, type Sheet } from './player-week.ts';
import { lineupProj, seasonStrength } from './week.ts';
import { FIXTURE_SEASON, askedPhase, phaseAccount, phaseLeagues, phaseSync } from './phases.ts';
import { ESPN_STAND_IN_NAME, espnSync } from './espn-sync.ts';

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
const HTTP = {
	ok: 200,
	noContent: 204,
	badRequest: 400,
	notFound: 404,
	conflict: 409,
	unprocessable: 422
} as const;

async function load<T>(name: string): Promise<T> {
	return JSON.parse(await readFile(new URL(`${name}.json`, DATA), 'utf8')) as T;
}

/** Lane 72's recorded week sheets, the player card's line for those players (player-week.ts). */
const { players: sheets } = await load<{ players: Record<string, Sheet> }>('week-sheets');
const [sync, lineup, waivers, trades, gameWeek, matchupBox, scoreboard, scoreboardLive] =
	await Promise.all([
		load<LeagueSync>('sync'),
		load<LineupAdvice>('lineup'),
		load<WaiverAdvice>('waivers'),
		load<TradeAdvice>('trades'),
		load<GameWeek>('games'),
		load<MatchupBox>('matchup'),
		load<Scoreboard>('scoreboard'),
		load<Scoreboard>('scoreboard-live')
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
/** The leagues as the switch lists them, one per season phase (phases.ts), drafts timed from now,
 * then the ESPN stand-ins in season under their own name and platform, so the switch on an ESPN
 * screen names the league it shows. */
const leaguesNow = (): components['schemas']['ContextLeague'][] => {
	const phased = phaseLeagues(contextBase, Date.now());
	const inSeason = phased.find((league) => league.id === LEAGUE);
	const espn = inSeason
		? [...ESPN_MOVES.keys()].map((espnId) => ({
				...inSeason,
				id: espnId,
				name: ESPN_STAND_IN_NAME,
				host: 'espn' as const
			}))
		: [];
	return [...phased, ...espn];
};
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

/** The trade builder's honesty line, as the finder's answer carries it (inseason words.go
 * TradeCheckBasis). */
const checkBasis = trades.check_basis;
/** The API's sentence for a team the read does not hold (inseason check.go otherTeamWords). */
const OTHER_TEAM_WORDS = "Pick another team in this league's last read.";
/** A gain on the wire: one decimal. */
const tenth = (n: number): number => Math.round(n * 10) / 10;
/** The finder's close call for them (inseason trades.go CloseCall). */
const CLOSE_CALL = 0.5;

/** The slots each position fills alone, from the lineup's own slots: QB, RB, WR and TE. */
const dedicated = new Map<string, number>();
for (const { slot } of lineup.slots) {
	if (['QB', 'RB', 'WR', 'TE'].includes(slot)) dedicated.set(slot, (dedicated.get(slot) ?? 0) + 1);
}

/** The first dedicated slot a roster no longer fills, as a lineup row labels it ("RB2", "TE"); null
 * when it fills every one. The fixture's rosters of other teams are only the players its trades name,
 * so only the member's is counted. */
function openSlot(roster: readonly PlayerLine[]): string | null {
	for (const [position, need] of dedicated) {
		const have = roster.filter((line) => line.player.position === position).length;
		if (have < need) return need > 1 ? `${position}${String(have + 1)}` : position;
	}
	return null;
}

/** One trade the member built. A trade the finder lists answers the finder's own row, as the API's
 * shared reckoning does; any other is a plain stand-in for the engine, each lineup's change the swap
 * of the players' points over replacement a week. A player not on the named roster is refused with
 * the API's sentence. */
function tradeCheck(input: TradeCheckInput): TradeCheck | string {
	const team = trades.teams.find((t) => t.roster_id === input.team);
	if (!team) return OTHER_TEAM_WORDS;
	const pick = (roster: readonly PlayerLine[], ids: readonly string[], whose: string) =>
		ids.map(
			(id) =>
				roster.find((line) => line.player.host_id === id) ??
				`That player is not on ${whose} roster in the league's last read.`
		);
	const give = pick(trades.roster, input.give, 'your');
	const get = pick(team.roster, input.get, `${team.name}'s`);
	const refused = [...give, ...get].find((line) => typeof line === 'string');
	if (typeof refused === 'string') return refused;
	const gives = give as PlayerLine[];
	const gets = get as PlayerLine[];
	const ids = (side: readonly PlayerLine[]): string =>
		side
			.map((line) => line.player.host_id)
			.sort()
			.join('+');
	const listed = team.trades.find(
		(row) => ids(row.give) === ids(gives) && ids(row.get) === ids(gets)
	);
	const por = (side: readonly PlayerLine[]): number =>
		side.reduce((sum, line) => sum + (line.points_over_replacement ?? 0), 0);
	const swing = tenth(por(gets) - por(gives));
	const slots = lineup.slots.map((s) => s.slot);
	const without = (roster: readonly PlayerLine[], out: readonly PlayerLine[]): PlayerLine[] =>
		roster.filter((line) => !out.includes(line));
	const myBefore = lineupProj(trades.roster, slots);
	const theirBefore = lineupProj(team.roster, slots);
	const trade = listed ?? {
		give: gives,
		get: gets,
		drop: null,
		my_gain: swing,
		their_gain: -swing,
		close_for_them: -swing < CLOSE_CALL,
		my_proj_change: tenth(
			lineupProj([...without(trades.roster, gives), ...gets], slots) - myBefore
		),
		their_proj_change: tenth(
			lineupProj([...without(team.roster, gets), ...gives], slots) - theirBefore
		)
	};
	/** A side's totals as the API's check carries them (check.go sideTotals): the Proj before and
	 * after, and the strength before and after, after being before plus the gain. */
	const side = (
		roster: readonly PlayerLine[],
		before: number,
		change: number | null,
		gain: number
	): TradeCheck['totals']['yours'] => {
		const season = seasonStrength(roster, slots);
		return {
			proj_before: before,
			proj_after: change === null ? null : tenth(before + change),
			season_before: season,
			season_after: tenth(season + gain)
		};
	};
	const yoursOpen = openSlot([...trades.roster.filter((line) => !gives.includes(line)), ...gets]);
	return {
		week: trades.week,
		basis: checkBasis,
		basis_note: trades.basis_note,
		order_basis: trades.order_basis,
		refreshed: trades.refreshed,
		read_at: readAt(),
		trade,
		// The stand-in names no drop off the finder's rows, so it never refuses a trade for room.
		fills: {
			yours: yoursOpen === null,
			theirs: true,
			yours_open: yoursOpen,
			theirs_open: null,
			yours_room: true,
			theirs_room: true
		},
		totals: {
			yours: side(trades.roster, myBefore, trade.my_proj_change, trade.my_gain),
			theirs: side(team.roster, theirBefore, trade.their_proj_change, trade.their_gain)
		},
		host_trades_url: trades.host_trades_url,
		host_note: trades.host_note
	};
}

const CHECK = /^\/leagues\/attached\/([^/]+)\/trades\/check$/;
const IN_SEASON = /^\/leagues\/attached\/([^/]+)\/(lineup|matchup|scoreboard|waivers|trades)$/;
/** The player card's reads (Lane 66h): in the league, and with no league. */
const LEAGUE_PLAYER = /^\/leagues\/attached\/([^/]+)\/players\/([^/]+)$/;
/** Each player's club and position from the built site's run (web/.runs, npm run standin), so the
 * league read places a player no recorded screen carries, as the API's board does. */
const RUNS = new URL('../../.runs/runs/', import.meta.url);
const runIndex = await (async (): Promise<Map<string, { team: string; position: string }>> => {
	try {
		const { runId } = JSON.parse(await readFile(new URL('latest.json', RUNS), 'utf8')) as {
			runId: string;
		};
		const entries = JSON.parse(await readFile(new URL(`${runId}/index.json`, RUNS), 'utf8')) as {
			id: string;
			team: string;
			position: string;
		}[];
		return new Map(entries.map(({ id, team, position }) => [id, { team, position }]));
	} catch {
		return new Map();
	}
})();
const PUBLIC_PLAYER = /^\/players\/([^/]+)\/week$/;
const MOVES = /^\/leagues\/attached\/([^/]+)\/moves(\/plan)?$/;

/** A changed slot's place in the API's words: "at RB", "in the flex". */
function slotPlace(slot: string): string {
	if (slot === 'FLEX') return 'in the flex';
	if (slot === 'SUPERFLEX') return 'in the superflex';
	// A defense's slot as the Lineup prints it (hostmoves slotPlace).
	if (slot === 'DEF') return 'at D/ST';
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
		moves: { lineup: 'available', note: null, takes_writes: true, writes_on: true, reason: null }
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
		const { phase, one, many } = askedPhase(req.headers.cookie);
		const leagues = leaguesNow();
		const asked = url.pathname === '/me/league' ? await bodyOf(req) : null;
		const chosen = (asked as { league_id?: string } | null)?.league_id;
		const answer = {
			...phaseAccount(account, leagues, phase, one),
			features: many ? (['many_leagues'] as const) : []
		};
		const picked = leagues.find((league) => league.id === chosen);
		send(req, res, HTTP.ok, picked ? { ...answer, league: picked } : answer);
		return;
	}
	// The week's games with their facts (Lane 66a), the recorded week whatever week is asked.
	if (url.pathname === '/games/week') {
		send(req, res, HTTP.ok, gameWeek);
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
		const asked = synced[1] ?? '';
		send(req, res, HTTP.ok, {
			...phaseSync(ESPN_MOVES.has(asked) ? espnSync(sync) : sync, asked),
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
	if (CHECK.test(url.pathname) && req.method === 'POST') {
		const checked = tradeCheck((await bodyOf(req)) as TradeCheckInput);
		if (typeof checked === 'string') send(req, res, HTTP.unprocessable, checked, 'invalid');
		else send(req, res, HTTP.ok, checked);
		return;
	}
	const recorded = { sync, lineup, waivers, trades, matchup: matchupBox, games: gameWeek, sheets };
	const publicPlayer = PUBLIC_PLAYER.exec(url.pathname);
	if (publicPlayer) {
		const team = url.searchParams.get('team');
		const position = url.searchParams.get('position') ?? '';
		const week =
			team === null ? null : playerWeek(recorded, publicPlayer[1] ?? '', { team, position }, false);
		if (week === null) send(req, res, HTTP.badRequest, 'Name his club.', 'invalid');
		else send(req, res, HTTP.ok, week);
		return;
	}
	const leaguePlayer = LEAGUE_PLAYER.exec(url.pathname);
	if (leaguePlayer) {
		if (leaguePlayer[1] === OUT_OF_SEASON) {
			send(req, res, HTTP.conflict, NO_GAMES);
			return;
		}
		const id = leaguePlayer[2] ?? '';
		const week = playerWeek(recorded, id, runIndex.get(id) ?? null, true);
		if (week === null) send(req, res, HTTP.notFound, 'Nothing here by that id', 'not_found');
		else send(req, res, HTTP.ok, week);
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
			matchup: matchupBox,
			// The ESPN leagues show the week on its Sunday afternoon, a stand-in (league.ts): the
			// points are made up so the board's played states can be drawn.
			scoreboard: ESPN_MOVES.has(id ?? '') ? scoreboardLive : scoreboard,
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
