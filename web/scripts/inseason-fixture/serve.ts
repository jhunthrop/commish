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
	LineupAdvice,
	MatchupBox,
	Scoreboard,
	TradeAdvice,
	TradeCheckInput,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import type { components } from '../../src/lib/api/types.ts';

type OrderAdvice = components['schemas']['OrderAdvice'];
type OrderRow = components['schemas']['OrderRow'];
import type { GameWeek } from '../../src/lib/format/game-facts.ts';
import { FIXTURE_IDS } from './ids.ts';
import { leagueRecordAnswer } from './record.ts';
import { playerWeek, type Sheet } from './player-week.ts';
import { FIXTURE_SEASON, askedPhase, phaseAccount, phaseLeagues, phaseSync } from './phases.ts';
import { ESPN_STAND_IN_NAME, espnMatchup, espnSync } from './espn-sync.ts';
import { yahooStandIn } from './yahoo.ts';
import { ffpcStandIn } from './ffpc.ts';
import { afterSundayOf, SUNDAY, sundayOf } from './sunday.ts';
import { linesOf, recordedMatchups, scoreboardAt } from './scoreboard-at.ts';
import { inSeason, noWeek } from './member-week.ts';
import { inTenths, roundTenth } from './tenths.ts';
import { FIXTURE_CLOCK_VARIABLE, FIXTURE_MONDAY_CLOCK, fixtureClock } from './clock.ts';
import { stamped, stateAt } from './game-state.ts';
import { platformed, platformGames } from './platform-games.ts';
import {
	ORDER_FROM_WEEK,
	orderAtClock,
	restAtClock,
	restPerGameAtClock,
	runIndex,
	tierAskOf
} from './rest-now.ts';
import { CLAIM_FORM_WORDS, HOLD_MS, HOST_ID, espnMoves } from './espn-moves.ts';
import { weekOrderAnswer, weekPosition, type WeekOrderStates } from './week-order-serve.ts';
import { tradeChecker } from './trade-check.ts';
import { proposedTrades } from './trade-needs.ts';
import { tradesAtClock, waiversAtClock } from './waivers-at.ts';
import { finalWords, rateWords, titleWeekHorizon, withRuleList } from './week.ts';
import { lineupSpent, TURNED_WEEK, turnedLineup, turnedTrades, turnedWaivers } from './turn.ts';
import {
	irDropLineup,
	irDropWaivers,
	listedOnly,
	restatedBeats,
	IR_DROP_VARIABLE
} from './waiver-beats.ts';

const PORT = Number(process.env.PORT ?? 8799);

type PlayerWeekAnswer = components['schemas']['PlayerWeek'];

/** His week with his rest of season at the clock, and his figure a game where the line lacks one (the
 * API's per-game rule, Lane 100's vs Avg). */
function withRestAtClock(
	week: PlayerWeekAnswer,
	id: string,
	params: URLSearchParams
): PlayerWeekAnswer {
	const perGame = week.line.rest_of_season_per_game ?? restPerGameAtClock(id, now());
	return {
		...week,
		line: { ...week.line, rest_of_season_per_game: perGame },
		...restAtClock(id, now(), tierAskOf(params))
	};
}
/** The fixture's clock: the real one, or the shots' week clock (FIXTURE_CLOCK=2026-10-17T17:00:00.000Z,
 * clock.ts FIXTURE_WEEK_CLOCK), so every read stamp agrees with the browser's. */
const now = fixtureClock(process.env[FIXTURE_CLOCK_VARIABLE]);
/** The league's horizon (horizon.go HorizonOf, Lane 96): the recorded league's playoffs end in week 17,
 * the run's own; FIXTURE_TITLE_WEEK=18:2 serves it as a league whose playoffs run to week 18 with a
 * two-week final, its terms and every Gain and order sentence through it. */
const HORIZON = titleWeekHorizon(process.env.FIXTURE_TITLE_WEEK);
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
/** The API's own sentences (api/internal/inseason): leaguesync.NoGamesWords and noTeamWords. */
const NO_GAMES = 'Your league has no games this week.';
const NO_TEAM_WORDS = "We could not find your team in this league's last read.";
const READ_MINUTES_AGO = 4;
const MINUTE_MS = 60_000;
const HTTP = {
	ok: 200,
	noContent: 204,
	badRequest: 400,
	notFound: 404,
	conflict: 409,
	unprocessable: 422
} as const;

async function load<T>(name: string): Promise<T> {
	// Every printed figure as the API sends it now: one tenth (tenths.ts).
	return inTenths(JSON.parse(await readFile(new URL(`${name}.json`, DATA), 'utf8')) as T);
}

/** Lane 72's recorded week sheets, the player card's line for those players (player-week.ts). */
const { players: sheets } = await load<{ players: Record<string, Sheet> }>('week-sheets');
const [
	recordedSync,
	lineupRead,
	waiversRead,
	tradesRead,
	gameWeek,
	matchupBox,
	scoreboardLive,
	order,
	weekOrders
] = await Promise.all([
	load<LeagueSync>('sync'),
	load<LineupAdvice>('lineup'),
	load<WaiverAdvice>('waivers'),
	load<TradeAdvice>('trades'),
	load<GameWeek>('games'),
	load<MatchupBox>('matchup'),
	load<Scoreboard>('scoreboard-live'),
	load<OrderAdvice>('order'),
	load<WeekOrderStates>('week-order')
]);
/** The league read with its playoffs through the horizon's last week. */
const sync: LeagueSync =
	recordedSync.terms.playoff_weeks === null ||
	recordedSync.terms.playoff_weeks.last === HORIZON.last
		? recordedSync
		: {
				...recordedSync,
				terms: {
					...recordedSync.terms,
					playoff_weeks: { ...recordedSync.terms.playoff_weeks, last: HORIZON.last }
				}
			};
/** The sense check's case on the fixture when asked (waiver-beats.ts, Lane 98). */
const irDrop = process.env[IR_DROP_VARIABLE] === '1';
const lineup = irDrop ? irDropLineup(lineupRead) : lineupRead;
/** The trades as the API's search lists them, each need named (trade-needs.ts, Lane 103). */
const trades = proposedTrades(tradesRead, lineup);
/** The adds the API lists (waiver-beats.ts listedAdd), before any order is taken over them. */
const waivers = listedOnly(irDrop ? irDropWaivers(waiversRead) : waiversRead);

/** The recorded week the scoreboard is restated from at the fixture's clock (scoreboard-at.ts). */
const recordedWeek = {
	me: sync.me,
	week: sync.week,
	matchups: await recordedMatchups(),
	lines: linesOf({ lineup, waivers, trades, matchup: matchupBox }),
	box: matchupBox
};

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
	const phased = phaseLeagues(contextBase, now());
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

const readAt = (): string => new Date(now() - READ_MINUTES_AGO * MINUTE_MS).toISOString();

/** The scoreboard as the API answers it at the fixture's clock (Lane 85): each game's state and next
 * kickoff by its starters' games (stateAt), each kicked-off starter's stand-in share scored, never the
 * recording's read from before the week's games. */
function scoreboardNow(): Scoreboard {
	const at = now();
	return scoreboardAt(
		recordedWeek,
		{ now: at, final: (line) => stateAt(line.facts, at) === 'final', scored: true },
		readAt()
	);
}

/** From the Monday clock on (Lane 80's FIXTURE_MONDAY_CLOCK and FIXTURE_TUESDAY_CLOCK), every league
 * read is the week after its Sunday at the fixture's clock (sunday.ts afterSundayOf): the Lineup as
 * the engine would advise it then, the points so far, the scoreboard restated, the finished week
 * once every starter's game is final (Lane 85). */
const AFTER_SUNDAY = Date.parse(FIXTURE_MONDAY_CLOCK);
const afterSunday = (): boolean => now() >= AFTER_SUNDAY;

/** The API's sentence for an FFPC read FFPC signed out of (leaguesync HostProblemWords). */
const FFPC_AGAIN = 'FFPC signed you out. Sign in to FFPC again to keep reading your league.';

/** FIXTURE_LEAD_FINAL=1 (Lane 102, B38): the Sleeper league's game read final, every starter's
 * points his last, while the ESPN stand-in's Monday night game is still under way, so the front door
 * leads with the live league's card ahead of the selected one. A stand-in of the sense check's
 * Monday night, never the recorded week. */
const leadFinal = process.env.FIXTURE_LEAD_FINAL === '1';

/** A league's game as final: no starter to play, each side's projected final its points. */
function finalGame(
	league: components['schemas']['WeekLeague']
): components['schemas']['WeekLeague'] {
	if (league.bug === null) return league;
	const game = league.bug.game;
	return {
		...league,
		bug: {
			...league.bug,
			first: [],
			game: {
				...game,
				state: 'final',
				next_kickoff: null,
				to_play: null,
				sides: game.sides.map((side) => ({
					...side,
					played: side.starters,
					to_play: null,
					in_play: 0,
					projected_final: side.points
				}))
			}
		}
	};
}

/** The ESPN stand-in's opponent under FIXTURE_LEAD_FINAL (review LOW-5): its own name and score, so
 * the live card and the selected league's never read as one game. A stand-in, named so. */
const LIVE_RIVAL = { name: 'Office Rival (stand-in)', points: 12.4 };

function ownOpponent(
	league: components['schemas']['WeekLeague']
): components['schemas']['WeekLeague'] {
	const bug = league.bug;
	const rival = bug?.game.sides[1];
	if (bug === null || rival === undefined) return league;
	return {
		...league,
		bug: {
			...bug,
			teams: bug.teams.map((team) =>
				team.roster_id === rival.roster_id ? { ...team, name: LIVE_RIVAL.name } : team
			),
			game: {
				...bug.game,
				sides: bug.game.sides.map((side) =>
					side.roster_id === rival.roster_id
						? {
								...side,
								points: roundTenth(side.points + LIVE_RIVAL.points),
								projected_final:
									side.projected_final == null
										? null
										: roundTenth(side.projected_final + LIVE_RIVAL.points)
							}
						: side
				)
			}
		}
	};
}

/** GET /me/week: every league the front door shows, the Sleeper league first. */
function memberWeek(): components['schemas']['MemberWeek'] {
	const at = readAt();
	const when = now();
	const after = afterSunday();
	const sleeperWeek = after ? sleeperAfter() : { sync, lineup, scoreboard: scoreboardNow() };
	const espnWeek = after
		? espnAfter()
		: { sync: espnSync(sync), lineup: espnLineup(), scoreboard: scoreboardLive };
	const base = {
		name: sync.name,
		host: sync.host,
		team_name: contextBase.team_name,
		standing: contextBase.standing
	};
	const lead = (
		league: components['schemas']['WeekLeague']
	): components['schemas']['WeekLeague'] => (leadFinal ? finalGame(league) : league);
	return {
		leagues: [
			lead(
				inSeason(
					LEAGUE,
					{
						...sleeperWeek,
						waivers: waiversNow(),
						readAt: at,
						...(turnedNow()
							? { turned: { week: TURNED_WEEK, lineup: turnedLineup(lineupNow()) } }
							: {})
					},
					when
				)
			),
			((espn) => (leadFinal ? ownOpponent(espn) : espn))(
				inSeason(ESPN_DONE, { ...espnWeek, waivers: espnWaivers(null), readAt: at }, when)
			),
			noWeek(
				NO_TEAM,
				{ ...base, name: 'Main Event (FFPC stand-in)', host: 'ffpc', phase: 'in_season' },
				FFPC_AGAIN,
				'2026-10-12T19:00:00.000Z'
			),
			noWeek(
				FIXTURE_IDS.offseason,
				{ ...base, name: 'Last Year Keepers (stand-in)', phase: 'offseason' },
				null
			)
		]
	};
}

const HOURS_AGO_2 = 2 * 60 * MINUTE_MS;
/** GET /hosts as the stand-in account answers it. */
const HOSTS: components['schemas']['HostConnections'] = {
	enabled: ['ffpc', 'yahoo', 'espn', 'mfl'],
	connections: [
		{
			host: 'espn',
			status: 'connected',
			proven: true,
			connected_at: '2026-10-03T14:00:00.000Z',
			last_read_at: new Date(now() - HOURS_AGO_2).toISOString(),
			consent_version: 3,
			writes_on: true,
			writes_reason: null
		},
		{
			host: 'ffpc',
			status: 'signed_out',
			proven: true,
			connected_at: '2026-09-28T14:00:00.000Z',
			last_read_at: '2026-10-12T14:00:00.000Z',
			consent_version: 3,
			writes_on: false,
			writes_reason: 'FFPC takes no lineups from here.'
		}
	]
};

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
			// Every game stamped with the API's state at the fixture's clock (Lane 80).
			// The rules a basis names beside its sentence, as the API sends them (Lane 115, B92).
			data: ok ? stamped(withRuleList(body), now()) : null,
			error: ok ? null : { code, message: String(body) }
		})
	);
}

/** The order's first week at the fixture's clock (rest-now.ts, Lane 86): the Gain words count from it. */
const fromWeekNow = (): number => orderAtClock(order, now()).from_week ?? ORDER_FROM_WEEK;
/** The member's lineup at the fixture's clock: the week after its Sunday once that has come. */
const lineupNow = (): LineupAdvice => (afterSunday() ? sleeperAfter().lineup : lineup);
/** Whether the action screens address week 7 at the fixture's clock (turn.ts, Lane 95). */
const turnedNow = (): boolean => lineupSpent(lineupNow(), now());
/** The waiver answer as the API gives it at the fixture's clock (waivers-at.ts), week 7's once the
 * member's lineup has played week 6 (turn.ts). */
const waiversNow = (): WaiverAdvice => {
	const answer = waiversAtClock(waivers, now(), fromWeekNow(), HORIZON);
	// Turned, the week 7 rows are ordered from the stored answer (its moves to make intact), with
	// the Gain sentence at the clock.
	const ordered = turnedNow()
		? turnedWaivers({ ...waivers, season_basis: answer.season_basis }, now())
		: answer;
	// Beats as the API names them in that order (waiver-beats.ts, Lane 98), each starter's bye his
	// bye in the week the page addresses (Lane 108, B81): week 7's once turned, so a starter whose
	// club sits week 7 reads "Starter, bye" (Lane 115, B90).
	return restatedBeats(ordered, turnedNow() ? turnedLineup(lineupNow()) : lineupNow());
};

function waiversAt(position: string | null): WaiverAdvice {
	const answer = waiversNow();
	if (position === null) return answer;
	const rows = answer.rows.filter((row) => row.add.player.position === position);
	const pickups = answer.pickups.filter((row) => row.add.player.position === position);
	return { ...answer, rows, pickups };
}

/** The trades holding one player, by his board id, every team kept. */
function tradesHolding(player: string | null): TradeAdvice {
	const atClock = tradesAtClock(trades, fromWeekNow(), HORIZON);
	const answer = turnedNow() ? turnedTrades(atClock, now()) : atClock;
	if (player === null) return answer;
	const holds = (side: { player: { board_id: string | null } }[]): boolean =>
		side.some((line) => line.player.board_id === player);
	return {
		...answer,
		teams: answer.teams.map((team) => ({
			...team,
			trades: team.trades.filter((row) => holds(row.give) || holds(row.get))
		}))
	};
}

/** The recorded league's finals its platform scored once its Sunday has come (platform-games.ts,
 * Lane 111): the Avg, Last and GP of every answer about the league count them. */
const platformNow = (): ReturnType<typeof platformGames> =>
	afterSunday() ? platformGames(sync.host, sleeperAfter(), now()) : new Map();

/** The trade builder's check (trade-check.ts). */
const tradeCheck = tradeChecker({ trades, lineup, readAt });

const CHECK = /^\/leagues\/attached\/([^/]+)\/trades\/check$/;
const IN_SEASON = /^\/leagues\/attached\/([^/]+)\/(lineup|matchup|scoreboard|waivers|trades)$/;
/** The player card's reads (Lane 66h): in the league, and with no league. */
const LEAGUE_PLAYER = /^\/leagues\/attached\/([^/]+)\/players\/([^/]+)$/;
const PUBLIC_PLAYER = /^\/players\/([^/]+)\/week$/;
const MOVES = /^\/leagues\/attached\/([^/]+)\/moves(\/plan)?$/;

/** The ESPN stand-ins' lineup, waivers and moves (espn-moves.ts). */
const { espnLineup, espnWaivers, moveAnswer } = espnMoves({
	lineup,
	waivers,
	waiversAt,
	now,
	outcomes: ESPN_MOVES
});

/** The leagues on their Sunday afternoon (sunday.ts), for a browser that asks for the Sunday with
 * the fixture_week cookie: points by player where the platform gives them, totals the platform's,
 * the Lineup advised with the kicked-off players locked, read at the Sunday. */
const sleeperOnSunday = sundayOf({ sync, lineup, matchup: matchupBox, scoreboardLive });
const espnOnSunday = sundayOf({
	sync: espnSync(sync),
	lineup: espnLineup(),
	matchup: espnMatchup(matchupBox),
	scoreboardLive
});
const SUNDAY_WEEK = /(?:^|; )fixture_week=sunday(?:;|$)/;
/** The recorded league after its Sunday, at the fixture's clock. */
const sleeperAfter = (): StandInWeek =>
	afterSundayOf({ sync, lineup, matchup: matchupBox }, recordedWeek, now(), readAt());
/** An ESPN league after its Sunday, at the fixture's clock. */
const espnAfter = (): StandInWeek =>
	afterSundayOf(
		{ sync: espnSync(sync), lineup: espnLineup(), matchup: espnMatchup(matchupBox) },
		recordedWeek,
		now(),
		readAt()
	);
/** The recorded league as a Yahoo league's (yahoo.ts), for a browser that asks with the
 * fixture_platform cookie: team totals alone, so its Pts sentence keeps a shot, on the week's
 * Saturday or its Sunday. */
const yahooWeek = yahooStandIn({ sync, lineup, matchup: matchupBox });
const yahooOnSunday = yahooStandIn(sleeperOnSunday);
const YAHOO_PLATFORM = /(?:^|; )fixture_platform=yahoo(?:;|$)/;
/** The request asks for the recorded league as Yahoo's. */
const yahooAsked = (req: IncomingMessage, id: string): boolean =>
	id === LEAGUE && YAHOO_PLATFORM.test(req.headers.cookie ?? '');
/** The recorded league as an FFPC league's (ffpc.ts), by the same cookie: FFPC's seeding and its
 * tight end premium beside the PPR column (Lane 94). */
const ffpcWeek = ffpcStandIn({ sync, lineup, matchup: matchupBox });
const FFPC_PLATFORM = /(?:^|; )fixture_platform=ffpc(?:;|$)/;
const ffpcAsked = (req: IncomingMessage, id: string): boolean =>
	id === LEAGUE && FFPC_PLATFORM.test(req.headers.cookie ?? '');
/** The platform a request asks the recorded league on, its own when none. */
const platformAsked = (req: IncomingMessage, id: string): 'yahoo' | 'ffpc' | null =>
	yahooAsked(req, id) ? 'yahoo' : ffpcAsked(req, id) ? 'ffpc' : null;

/** A stand-in's answers. */
interface StandInWeek {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
	scoreboard: Scoreboard;
}

/** A stand-in's answers and when they were read. */
interface StandIn extends StandInWeek {
	readAt: string;
}

/** The stand-in a request asks for by its cookies, null for the recorded answers: an ESPN league or
 * the recorded league on the Sunday, the recorded league as Yahoo's on either day. */
function standInAsked(req: IncomingMessage, id: string): StandIn | null {
	const sunday = SUNDAY_WEEK.test(req.headers.cookie ?? '');
	// The FFPC stand-in reads on the week's Saturday alone (its shots, Lane 94).
	if (ffpcAsked(req, id)) {
		const board = scoreboardNow();
		const scoring = ffpcWeek.lineup.projection_scoring;
		return { ...ffpcWeek, scoreboard: { ...board, projection_scoring: scoring }, readAt: readAt() };
	}
	if (!sunday && afterSunday()) {
		const at = readAt();
		if (yahooAsked(req, id)) {
			const week = sleeperAfter();
			return { ...yahooStandIn(week), scoreboard: week.scoreboard, readAt: at };
		}
		if (ESPN_MOVES.has(id)) return { ...espnAfter(), readAt: at };
		return id === LEAGUE ? { ...sleeperAfter(), readAt: at } : null;
	}
	const live = { scoreboard: scoreboardLive, readAt: SUNDAY };
	if (yahooAsked(req, id))
		return sunday
			? { ...yahooOnSunday, ...live }
			: { ...yahooWeek, scoreboard: scoreboardNow(), readAt: readAt() };
	if (!sunday) return null;
	if (ESPN_MOVES.has(id)) return { ...espnOnSunday, ...live };
	return id === LEAGUE ? { ...sleeperOnSunday, ...live } : null;
}

/** A request's JSON body, or null when it has none. */
async function bodyOf(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const text = Buffer.concat(chunks).toString('utf8');
	return text === '' ? null : (JSON.parse(text) as unknown);
}
const SYNC = /^\/leagues\/attached\/([^/]+)\/(sync|refresh)$/;
const LEAGUE_ORDER = /^\/leagues\/attached\/([^/]+)\/order$/;
/** The record in a league (Lane 93, record.ts). */
const LEAGUE_RECORD = /^\/leagues\/attached\/([^/]+)\/record$/;
/** The kickers' and defenses' week (Lane 66w), in a league and with none. */
const LEAGUE_WEEK_ORDER = /^\/leagues\/attached\/([^/]+)\/order\/week$/;
const WEEK_POSITION_WORDS = 'Pick a position: K or DEF';
const DEFAULT_ORDER_ROWS = 100;
const MIN_SEARCH = 2;

/** FIXTURE_TWO_QB=1 (Lane 117, B78): a league's order valued as a two-quarterback league's, so the
 * front door's strip holds quarterbacks the run's top rows do not and builds them from the answer.
 * STAND-INS, named so: each quarterback's points over replacement rises by TWO_QB_LIFT (the second
 * quarterback slot lowers his replacement level), the rows are ranked again by it, and a line with
 * an Avg and no games count carries STAND_IN_GAMES (the API's games_played, Lane 111). */
const twoQb = process.env.FIXTURE_TWO_QB === '1';
const TWO_QB_LIFT = 50;
const STAND_IN_GAMES = 5;

function twoQbRows(rows: readonly OrderRow[]): OrderRow[] {
	return rows
		.map((row) => {
			if (row.line.player.position !== 'QB') return row;
			const vor = row.points_over_replacement;
			const games =
				row.line.games_played ?? (row.line.season_avg === null ? undefined : STAND_IN_GAMES);
			return {
				...row,
				points_over_replacement: vor === null ? null : vor + TWO_QB_LIFT,
				line: games === undefined ? row.line : { ...row.line, games_played: games }
			};
		})
		.sort(
			(a, b) =>
				(b.points_over_replacement ?? Number.NEGATIVE_INFINITY) -
				(a.points_over_replacement ?? Number.NEGATIVE_INFINITY)
		)
		.map((row, i) => ({ ...row, rank: i + 1 }));
}

/** The order's view as the API answers it (order.ts): one position ranked by its total (a stand-in
 * place: the fixture's own order of its stand-in totals, 1 to n among the players it holds), or every
 * position in order.json's order; a search's letters in the name or club;
 * the limit. Without a league the rows carry no roster and no move, and no read. */
function orderAt(params: URLSearchParams, league: boolean): OrderAdvice {
	// Each total over his club's games left at the clock (Lane 86, rest-now.ts).
	const atClock = orderAtClock(order, now());
	const live = league && twoQb ? { ...atClock, rows: twoQbRows(atClock.rows) } : atClock;
	const position = params.get('position');
	const q = (params.get('q') ?? '').trim().toLowerCase();
	const limit = Number(params.get('limit') ?? DEFAULT_ORDER_ROWS);
	const ranked: OrderRow[] =
		position === null
			? live.rows
			: live.rows
					.filter((row) => row.line.player.position === position)
					.sort(
						(a, b) =>
							(b.rest_of_season_points ?? Number.NEGATIVE_INFINITY) -
							(a.rest_of_season_points ?? Number.NEGATIVE_INFINITY)
					)
					.map((row, i) => ({ ...row, rank: i + 1 }));
	const roster = params.get('roster');
	const found = ranked.filter(
		(row) =>
			(roster === null || row.roster?.kind === roster) &&
			(q.length < MIN_SEARCH ||
				row.line.player.name.toLowerCase().includes(q) ||
				row.line.player.team.toLowerCase().includes(q))
	);
	const rows = found
		.slice(0, limit)
		.map((row) => (league ? row : { ...row, roster: null, move: null }));
	return {
		...live,
		// A league's order runs to its last week (words.go OrderScreenBasis, Lane 96); the read with no
		// league keeps the run's.
		basis: league
			? live.basis
					.replace(
						/through week \d+, byes out/,
						`through week ${String(HORIZON.last)}${finalWords(HORIZON, live.from_week ?? ORDER_FROM_WEEK)}, byes out`
					)
					.replace(
						/in your league\./,
						`in your league.${rateWords(HORIZON, live.from_week ?? ORDER_FROM_WEEK)}`
					)
			: live.basis,
		read_at: league ? readAt() : null,
		moves: league ? order.moves : null,
		rank_by: position === null ? 'points_over_replacement' : 'rest_of_season_points',
		total: found.length,
		rows
	};
}

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
		// The player card's claim shot (Lane 66h): the selected league is an ESPN stand-in, whose
		// claims are made from here.
		const espn = /(?:^|; )fixture_league=espn(?:;|$)/.test(req.headers.cookie ?? '')
			? { ...contextLeague, id: ESPN_DONE, host: 'espn' as const }
			: null;
		const chosenAnswer = espn
			? { ...answer, league: espn }
			: picked
				? { ...answer, league: picked }
				: answer;
		// The recorded league as Yahoo's (yahoo.ts): the account names it on its platform too.
		const platform = platformAsked(req, LEAGUE);
		const onPlatform = <T extends { id: string; host: string }>(league: T): T =>
			platform !== null && league.id === LEAGUE ? { ...league, host: platform } : league;
		send(req, res, HTTP.ok, {
			...chosenAnswer,
			league: chosenAnswer.league === null ? null : onPlatform(chosenAnswer.league),
			leagues: chosenAnswer.leagues.map(onPlatform)
		});
		return;
	}
	// The fixture's own clock, for a shots script to check before it shoots (Lane 66x): the instant
	// FIXTURE_CLOCK started it at, null on the real clock, and the instant it reads now, which a
	// script starts its browser at so the two agree however long the API has run (Lane 77). No API
	// route has this name.
	if (url.pathname === '/fixture/clock') {
		send(req, res, HTTP.ok, {
			clock: process.env[FIXTURE_CLOCK_VARIABLE] ?? null,
			now: new Date(now()).toISOString()
		});
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
	// The front door's week (Lane 66k): the Sleeper league, the ESPN stand-in with its Sunday points,
	// a stand-in whose read failed and the league out of season.
	if (url.pathname === '/me/week') {
		send(req, res, HTTP.ok, memberWeek());
		return;
	}
	// The Account room's platforms (Lane 66k), every connection a stand-in: ESPN connected with
	// lineups set from here, FFPC signed out, Yahoo and MyFantasyLeague open and not connected.
	if (url.pathname === '/hosts') {
		// With the FFPC stand-in asked for, FFPC is signed in and ESPN's session kept unproven, the
		// two states the one state word set says (Lane 94).
		const signedIn = ffpcAsked(req, LEAGUE)
			? {
					...HOSTS,
					connections: HOSTS.connections.map((c) =>
						c.host === 'ffpc'
							? { ...c, status: 'connected' as const, last_read_at: readAt() }
							: { ...c, proven: false }
					)
				}
			: HOSTS;
		send(req, res, HTTP.ok, signedIn);
		return;
	}
	if (url.pathname === '/devices') {
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
					host: ESPN_MOVES.has(id) ? 'espn' : (platformAsked(req, id) ?? sync.host),
					host_league_id: sync.host_league_id,
					season: sync.season,
					name: league.name,
					roster_id: sync.me,
					team_name: league.team_name,
					standing: league.standing,
					attached_at: '2026-09-01T12:00:00.000Z',
					last_read_at: league.phase === 'offseason' ? null : readAt(),
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
		const standIn = standInAsked(req, asked);
		if (standIn) {
			send(req, res, HTTP.ok, {
				...phaseSync(standIn.sync, asked),
				id: asked,
				read_at: standIn.readAt
			});
			return;
		}
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
	if (url.pathname === '/order') {
		send(req, res, HTTP.ok, orderAt(url.searchParams, false));
		return;
	}
	const leagueWeek = LEAGUE_WEEK_ORDER.exec(url.pathname);
	if (url.pathname === '/order/week' || leagueWeek) {
		const position = weekPosition(url.searchParams);
		if (position === null) {
			send(req, res, HTTP.badRequest, WEEK_POSITION_WORDS, 'invalid');
			return;
		}
		const id = leagueWeek?.[1] ?? null;
		const league =
			id === null ? null : { espn: ESPN_MOVES.has(id), moves: waivers.moves, readAt: readAt() };
		send(req, res, HTTP.ok, weekOrderAnswer(weekOrders, position, league, now()));
		return;
	}
	const leagueRecord = LEAGUE_RECORD.exec(url.pathname);
	if (leagueRecord) {
		send(req, res, HTTP.ok, leagueRecordAnswer(ESPN_MOVES.has(leagueRecord[1] ?? '')));
		return;
	}
	if (LEAGUE_ORDER.test(url.pathname)) {
		send(req, res, HTTP.ok, platformed(orderAt(url.searchParams, true), platformNow()));
		return;
	}
	// The player's week restated at the fixture's clock (Lane 85 fix round 2, M-D): after the Sunday
	// his verb comes from the Lineup as the engine advises it then, never Saturday's changes.
	const week = afterSunday() ? sleeperAfter() : null;
	const recorded = {
		sync: week?.sync ?? sync,
		lineup: week?.lineup ?? lineup,
		waivers,
		trades,
		matchup: week?.matchup ?? matchupBox,
		games: gameWeek,
		sheets
	};
	const publicPlayer = PUBLIC_PLAYER.exec(url.pathname);
	if (publicPlayer) {
		// His club and position are our board's, as the API's (the built site's run here).
		const id = publicPlayer[1] ?? '';
		const week = playerWeek(recorded, id, runIndex.get(id) ?? null, false);
		if (week === null) send(req, res, HTTP.notFound, 'Nothing here by that id', 'not_found');
		else send(req, res, HTTP.ok, withRestAtClock(week, id, url.searchParams));
		return;
	}
	const leaguePlayer = LEAGUE_PLAYER.exec(url.pathname);
	if (leaguePlayer) {
		if (leaguePlayer[1] === OUT_OF_SEASON) {
			send(req, res, HTTP.conflict, NO_GAMES);
			return;
		}
		const id = leaguePlayer[2] ?? '';
		const week = playerWeek(
			recorded,
			id,
			runIndex.get(id) ?? null,
			true,
			ESPN_MOVES.has(leaguePlayer[1] ?? '')
		);
		if (week === null) send(req, res, HTTP.notFound, 'Nothing here by that id', 'not_found');
		else send(req, res, HTTP.ok, withRestAtClock(week, id, url.searchParams));
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
		const standIn = standInAsked(req, id ?? '');
		if (standIn && (route === 'lineup' || route === 'matchup' || route === 'scoreboard')) {
			const games = platformGames(standIn.sync.host, standIn, now());
			send(req, res, HTTP.ok, platformed({ ...standIn[route], read_at: standIn.readAt }, games));
			return;
		}
		const bodies = {
			lineup: ESPN_MOVES.has(id ?? '') ? espnLineup() : lineup,
			matchup: ESPN_MOVES.has(id ?? '') ? espnMatchup(matchupBox) : matchupBox,
			// The ESPN leagues show the week on its Sunday afternoon, a stand-in (league.ts): the
			// points are made up so the board's played states can be drawn.
			scoreboard: ESPN_MOVES.has(id ?? '') ? scoreboardLive : scoreboardNow(),
			waivers: ESPN_MOVES.has(id ?? '')
				? espnWaivers(url.searchParams.get('position'))
				: platformed(waiversAt(url.searchParams.get('position')), platformNow()),
			trades: platformed(tradesHolding(url.searchParams.get('player')), platformNow())
		} as const;
		send(req, res, HTTP.ok, { ...bodies[route as keyof typeof bodies], read_at: readAt() });
		return;
	}
	send(req, res, HTTP.notFound, 'Not in the fixture.');
}

createServer((req, res) => void answer(req, res)).listen(PORT, () => {
	process.stdout.write(`In-season fixture API on http://localhost:${String(PORT)}\n`);
});
