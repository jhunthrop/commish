// Builds the in-season screens' fixture until the API's three routes land (Lane 25): the recorded
// Sleeper league (api/internal/leaguesync/replay/sleeper, a real 12-team league read in week 6) read
// as a LeagueSync, and the three answers of spec §7 for one of its teams, every figure taken from the
// run's own board and game logs:
//   - position_rank and points_over_replacement are the run's PPR board row, as served;
//   - rest_of_season_per_game is the row's rest-of-season points over the games his club has left
//     from the run's first week through week 17 (the run's schedule, byes out), as the API divides;
//   - last_games are the run's game logs scored with the league's own rules (its scoring settings);
//   - opponent, home, kickoff and bye are the run's schedule;
//   - designation, points_this_week and allowed_to_position are not held by the run: absent (null);
//   - game_total, spread, roof and weather are each club's facts in data/games.json, which is GET
//     /games/week's answer for the week recorded from the research store (Lane 66a, read from the
//     lane66a_scratch copy of dev on 2026-10-16: the figures from nflverse's game table, since the
//     store held no hourly figures for week 6, the weather service's forecasts of that day, the venues
//     of the stadium table, with the API's rounding and sides). serve.ts answers that route from it.
// The lineups, the drops and the trades come from a plain stand-in for the API's engine (§4.2 on the
// run's rest-of-season order, flex by points over replacement), and a gain a week is the change in a
// lineup's summed points over replacement divided by the weeks the rest-of-season order covers (the
// league's week through week 17, as the API divides). The API's own engine replaces all of it; only
// the shapes and the figures' sources are meant to hold. The words are the API's own
// (api/internal/inseason words.go and sentences.go): the basis lines, a change's reason (the order,
// then his last two games only when they beat the player he replaces), a waiver row's sentence and a
// team's line when every trade with it is a close call for them, so the shots read as members' do.
//
//   node scripts/inseason-fixture/build.ts [roster id]   (reads .runs/runs/<PUBLIC_RUN_ID or latest>)
// then node scripts/inseason-fixture/project.ts, which stamps the week's projection on the answers
// and writes the Matchup screen's box answer (Lane 66d).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format as prettierFormat, resolveConfig } from 'prettier';
import { listWords } from '../../src/lib/format/list.ts';
import { FIXTURE_IDS } from './ids.ts';
import type { LeaguePlayer, LeagueSync, MatchupSide } from '../../src/lib/league/api.ts';
import type {
	AdviceHead,
	LineupAdvice,
	LineupSlot,
	PlayerLine,
	TradeAdvice,
	TradeRow,
	TradeTeam,
	WaiverAdvice,
	WaiverRow,
	WeekFacts
} from '../../src/lib/league/inseason/api.ts';

import type { GameWeek } from '../../src/lib/format/game-facts.ts';

const REPLAY = new URL('../../../api/internal/leaguesync/replay/sleeper/', import.meta.url);
const RUNS = new URL('../../.runs/runs/', import.meta.url);
const OUT = new URL('./data/', import.meta.url);
const FORMAT = 'ppr-12';
const LAST_WEEK = 18;
/** The API's line under the copy verb on a platform with no lineup write (hostmoves words.go). */
const SLEEPER_NO_LINEUP = 'Sleeper does not take lineups from here, so copy the lineup there.';
const LAST_GAMES = 3;
const POOL_CANDIDATES = 60;
const WAIVER_ROWS_UNDER_RULE = 8;
const TRADES_PER_TEAM = 4;
const CLOSE_FOR_THEM = 0.5;
/** The last week the rest-of-season order covers (the API's LastWeek). */
const LAST_FANTASY_WEEK = 17;
/** A gain or a points over replacement figure on the wire: one decimal. */
const TENTH = 10;
/** The last games a change's reason names. */
const NAMED_GAMES = 2;
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const FLEX = new Set(['RB', 'WR', 'TE']);
const SUPER_FLEX = new Set(['QB', 'RB', 'WR', 'TE']);
const DECIMALS = 100;
/** The one player the fixture's member tags Hold: a sheet tag, not a figure. */
const HELD_ON_SHEET = 'Christian Kirk';
/** The league's slot words in the contract's: Sleeper's SUPER_FLEX is SUPERFLEX. */
const SLOT_OF: Readonly<Record<string, LineupSlot['slot']>> = {
	QB: 'QB',
	RB: 'RB',
	WR: 'WR',
	TE: 'TE',
	FLEX: 'FLEX',
	SUPER_FLEX: 'SUPERFLEX',
	K: 'K',
	DEF: 'DEF'
};

const round = (n: number): number => Math.round(n * DECIMALS) / DECIMALS;
const tenth = (n: number): number => Math.round(n * TENTH) / TENTH;

async function json<T>(url: URL): Promise<T> {
	return JSON.parse(await readFile(url, 'utf8')) as T;
}

interface SleeperPlayer {
	full_name?: string;
	first_name?: string;
	last_name?: string;
	position: string;
	team: string | null;
}
interface SleeperRoster {
	roster_id: number;
	owner_id: string;
	players: string[];
	starters: string[];
	reserve: string[] | null;
	taxi: string[] | null;
	settings: { wins: number; losses: number; ties: number; fpts: number; fpts_decimal?: number };
}
interface SleeperUser {
	user_id: string;
	display_name: string;
	metadata: { team_name?: string } | null;
}
interface SleeperMatchup {
	roster_id: number;
	matchup_id: number | null;
	starters: string[];
	starters_points: number[];
	points: number;
}
interface SleeperMove {
	status: string;
	type: 'free_agent' | 'waiver' | 'trade';
	created: number;
	roster_ids: number[];
	adds: Record<string, number> | null;
	drops: Record<string, number> | null;
}
interface SleeperLeague {
	league_id: string;
	name: string;
	season: string;
	roster_positions: string[];
	scoring_settings: Record<string, number>;
}
interface BoardRow {
	id: string;
	slug: string;
	headshot: string | null;
	name: string;
	position: string;
	team: string;
	positionRank: number;
	vor: number;
	/** His points for the rest of the season on a run that ranks it, null without a projection. */
	projected: number | null;
}
interface RunFormat {
	id: string;
	rosFromWeek?: number;
	refreshedAt?: string;
}
interface Game {
	week: number;
	opponent: string;
	home: boolean;
	kickoff: string;
}
interface LogLine extends Record<string, number | string | boolean> {
	week: number;
	status: string;
}

const runId = await (async (): Promise<string> => {
	const named = process.env.PUBLIC_RUN_ID;
	if (named && named !== 'latest') return named;
	return (await json<{ runId: string }>(new URL('latest.json', RUNS))).runId;
})();
const run = new URL(`${runId}/`, RUNS);

const [league, rosters, users, matchups, moves, sleeperPlayers, state] = await Promise.all([
	json<SleeperLeague>(new URL('league.json', REPLAY)),
	json<SleeperRoster[]>(new URL('rosters.json', REPLAY)),
	json<SleeperUser[]>(new URL('users.json', REPLAY)),
	json<SleeperMatchup[]>(new URL('matchups.json', REPLAY)),
	json<SleeperMove[]>(new URL('transactions_last.json', REPLAY)),
	json<Record<string, SleeperPlayer>>(new URL('players.json', REPLAY)),
	json<{ week: number }>(new URL('state.json', REPLAY))
]);
const [manifest, board, schedule] = await Promise.all([
	json<{ runAt: string; formats: RunFormat[] }>(new URL('manifest.json', run)),
	json<{ rows: BoardRow[] }>(new URL(`boards/${FORMAT}.json`, run)),
	json<{ slates: { abbr: string; games: Game[] }[] }>(new URL('schedule.json', run))
]);
const format = manifest.formats.find((f) => f.id === FORMAT);
if (!format?.rosFromWeek || !format.refreshedAt) {
	throw new Error(`Run ${runId} has no rest-of-season ${FORMAT} board.`);
}
const refreshed = format.refreshedAt;
const week = state.week;
/** The weeks the rest-of-season order covers from the league's week: a week's figure is over them. */
const weeksCovered = Math.max(1, LAST_FANTASY_WEEK - week + 1);

/** What every basis ends with, in the API's words (words.go porWords): what points over
 * replacement are and what a week's figure is. */
const basisTail = `Points over replacement, and every gain in them, are points above what a free pickup at his position gives you, a week: the rest of the season on our rest-of-season order, averaged over its ${String(weeksCovered)} weeks, not a projection of any one week. Points a game are our rest-of-season projection from week ${String(format.rosFromWeek)} over the games his club has left, byes out.`;

/** The rest of the basis, under the rows, in the API's words (words.go BasisNote): the league's
 * shape and the league's rules the stat lines leave out. */
const basisNote = ((): string => {
	const count = (slot: string): number => league.roster_positions.filter((s) => s === slot).length;
	const flexes = count('FLEX');
	const flex =
		count('SUPER_FLEX') > 0 ? 'a flex and a superflex' : flexes > 1 ? 'two flex spots' : 'a flex';
	const shape = `a ${String(rosters.length)}-team league with ${String(count('QB'))} QB, ${String(count('RB'))} RB, ${String(count('WR'))} WR, ${String(count('TE'))} TE and ${flex}`;
	const s = league.scoring_settings;
	const scores = (...keys: string[]): boolean =>
		Object.entries(s).some(
			([k, v]) => v !== 0 && keys.some((key) => k === key || k.startsWith(`${key}_`))
		);
	const left = [
		scores('pass_2pt', 'rush_2pt', 'rec_2pt') ? 'two-point conversions' : null,
		scores('fgmiss') ? 'missed field goals' : null,
		scores('xpmiss') ? 'missed extra points' : null,
		scores('kr_td', 'pr_td') ? 'return touchdowns' : null,
		scores('fum_rec') ? 'fumble recoveries' : null,
		scores('safe') ? 'safeties' : null
	].filter((w): w is string => w !== null);
	const por = `Points over replacement are for ${shape}.`;
	return left.length === 0
		? por
		: `${por} Points so far leave out your league's points for ${listWords(left)}: the stat lines we hold do not carry them.`;
})();

/** "amon-ra st brown": a name as both sources can agree on it. */
function key(name: string): string {
	return name
		.toLowerCase()
		.replace(/[.'’]/g, '')
		.replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
		.replace(/[^a-z]+/g, ' ')
		.trim();
}
const boardByKey = new Map(board.rows.map((r) => [`${key(r.name)}|${r.position}`, r] as const));
const boardById = new Map(board.rows.map((r) => [r.id, r] as const));

function sleeperName(p: SleeperPlayer): string {
	return p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
}

/** The board row for a Sleeper player, by name and position. A defense is never on the board. */
function placed(id: string): BoardRow | null {
	const p = sleeperPlayers[id];
	if (!p) return null;
	return boardByKey.get(`${key(sleeperName(p))}|${p.position}`) ?? null;
}

const games = new Map(schedule.slates.map((s) => [s.abbr, s.games] as const));
const byes: Record<string, number> = Object.fromEntries(
	schedule.slates.flatMap((s) => {
		const played = new Set(s.games.map((g) => g.week));
		const bye = Array.from({ length: LAST_WEEK }, (_, i) => i + 1).find((w) => !played.has(w));
		return bye === undefined ? [] : [[s.abbr, bye] as const];
	})
);

/** Each club's games from the run's first week through the last the order covers (the API's
 * GamesLeft): a bye is no game. */
const fromWeek = format.rosFromWeek;
const gamesLeft = new Map(
	schedule.slates.map(
		(s) =>
			[
				s.abbr,
				s.games.filter((g) => g.week >= fromWeek && g.week <= LAST_FANTASY_WEEK).length
			] as const
	)
);

/** His rest-of-season points a game, as the API's RestOfSeasonPerGame divides them. */
function perGameOf(row: BoardRow | null): number | null {
	const projected = row?.projected ?? null;
	const left = row === null ? 0 : (gamesLeft.get(row.team) ?? 0);
	return projected === null || left === 0 ? null : tenth(projected / left);
}

/** Points under the league's own rules from one game's stat line. Two-point plays are not in the
 * log, so they are not counted. */
function leaguePoints(line: LogLine): number {
	const s = league.scoring_settings;
	const n = (field: string): number => Number(line[field] ?? 0);
	return round(
		n('passing_yards') * (s.pass_yd ?? 0) +
			n('passing_touchdowns') * (s.pass_td ?? 0) +
			n('interceptions') * (s.pass_int ?? 0) +
			n('rushing_yards') * (s.rush_yd ?? 0) +
			n('rushing_touchdowns') * (s.rush_td ?? 0) +
			n('receptions') * (s.rec ?? 0) +
			n('receiving_yards') * (s.rec_yd ?? 0) +
			n('receiving_touchdowns') * (s.rec_td ?? 0) +
			n('fumbles_lost') * (s.fum_lost ?? 0)
	);
}

const playerFiles = new Set(await readdir(new URL('players/', run)));
async function lastGames(boardId: string | null): Promise<WeekFacts['last_games']> {
	if (boardId === null || !playerFiles.has(`${boardId}.json`)) return [];
	const file = await json<{ season: { log: LogLine[] } }>(new URL(`players/${boardId}.json`, run));
	return file.season.log
		.filter((g) => g.status === 'played')
		.slice(-LAST_GAMES)
		.reverse()
		.map((g) => ({ week: g.week, points: leaguePoints(g) }));
}

/** The week's game facts by club, GET /games/week's recorded answer. */
const gameFacts = new Map(
	(await json<GameWeek>(new URL('games.json', OUT))).games.map((g) => [g.team, g] as const)
);
const NO_FACTS = { game_total: null, spread: null, roof: null, weather: null } as const;

async function factsFor(team: string, boardId: string | null): Promise<WeekFacts> {
	const game = games.get(team)?.find((g) => g.week === week) ?? null;
	const held = game === null ? undefined : gameFacts.get(team);
	return {
		week,
		opponent: game?.opponent ?? null,
		home: game?.home ?? null,
		kickoff: game?.kickoff ?? null,
		bye: game === null,
		designation: null,
		played: false,
		points_this_week: null,
		last_games: await lastGames(boardId),
		allowed_to_position: null,
		...(held === undefined
			? NO_FACTS
			: {
					game_total: held.game_total,
					spread: held.spread,
					roof: held.roof,
					weather: held.weather
				})
	};
}

const reserveOf = new Map(rosters.map((r) => [r.roster_id, new Set(r.reserve ?? [])] as const));

function leaguePlayer(id: string, rosterId: number | null): LeaguePlayer {
	const p = sleeperPlayers[id];
	const row = placed(id);
	return {
		host_id: id,
		board_id: row?.id ?? null,
		name: p ? sleeperName(p) : id,
		position: p?.position ?? '',
		team: p?.team ?? '',
		injured_reserve: rosterId !== null && (reserveOf.get(rosterId)?.has(id) ?? false)
	};
}

async function lineOf(player: LeaguePlayer): Promise<PlayerLine> {
	const row = player.board_id === null ? null : (boardById.get(player.board_id) ?? null);
	return {
		player,
		headshot: row?.headshot ?? null,
		slug: row?.slug ?? null,
		position_rank: row?.positionRank ?? null,
		points_over_replacement: row === null ? null : tenth(row.vor / weeksCovered),
		rest_of_season_per_game: perGameOf(row),
		// project.ts stamps the week's projection and the evidence after this build.
		week_projection: null,
		projection_delta: null,
		opp_rank: null,
		season_avg: null,
		last_points: null,
		held: false,
		facts: await factsFor(row?.team ?? player.team, player.board_id)
	};
}

async function boardLine(row: BoardRow): Promise<PlayerLine> {
	return lineOf({
		// As the API answers an add on Sleeper: no host id (an ESPN league's is its board id, serve.ts).
		host_id: '',
		board_id: row.id,
		name: row.name,
		position: row.position,
		team: row.team,
		injured_reserve: false
	});
}

// The lineup stand-in: a slot's eligible players best first, fixed slots before the flexes.
const slots = league.roster_positions.filter((s) => s !== 'BN');

function eligible(slot: string, position: string): boolean {
	if (slot === 'FLEX') return FLEX.has(position);
	if (slot === 'SUPER_FLEX') return SUPER_FLEX.has(position);
	return slot === position;
}

const vorOf = (line: PlayerLine): number => line.points_over_replacement ?? 0;
const rankOf = (line: PlayerLine): number => line.position_rank ?? Number.POSITIVE_INFINITY;

/** Fills the slots. thisWeek: a player on bye is never started over one who plays. preferred: the
 * host's starters win a tie (two unranked defenses keep the one the host has in). */
function fill(
	lines: readonly PlayerLine[],
	thisWeek: boolean,
	preferred: ReadonlySet<string> = new Set()
): (PlayerLine | null)[] {
	const out: (PlayerLine | null)[] = slots.map(() => null);
	const used = new Set<string>();
	const plays = (l: PlayerLine): number => (thisWeek && l.facts.bye ? 1 : 0);
	const pick = (i: number, flex: boolean): void => {
		const slot = slots[i] ?? '';
		const best = lines
			.filter((l) => !used.has(l.player.host_id) && eligible(slot, l.player.position))
			.sort(
				(a, b) =>
					plays(a) - plays(b) ||
					(flex ? 0 : rankOf(a) - rankOf(b)) ||
					vorOf(b) - vorOf(a) ||
					Number(preferred.has(b.player.host_id)) - Number(preferred.has(a.player.host_id))
			)[0];
		if (best) {
			used.add(best.player.host_id);
			out[i] = best;
		}
	};
	slots.forEach((slot, i) => {
		if (!slot.includes('FLEX')) pick(i, false);
	});
	slots.forEach((slot, i) => {
		if (slot.includes('FLEX')) pick(i, true);
	});
	return out;
}

const strength = (filled: readonly (PlayerLine | null)[]): number =>
	filled.reduce((sum, l) => sum + (l ? vorOf(l) : 0), 0);
const fillsEvery = (filled: readonly (PlayerLine | null)[]): boolean =>
	filled.every((l, i) => l !== null || slots[i] === 'DEF');

const usersById = new Map(users.map((u) => [u.user_id, u] as const));
const teamName = (r: SleeperRoster): string =>
	usersById.get(r.owner_id)?.metadata?.team_name ??
	usersById.get(r.owner_id)?.display_name ??
	`Team ${String(r.roster_id)}`;
const ownerName = (r: SleeperRoster): string => usersById.get(r.owner_id)?.display_name ?? '';

/** Every roster's players as lines, IR and taxi apart. */
async function rosterLines(r: SleeperRoster): Promise<PlayerLine[]> {
	const out = new Set([...(r.reserve ?? []), ...(r.taxi ?? [])]);
	return Promise.all(
		r.players.filter((id) => !out.has(id)).map((id) => lineOf(leaguePlayer(id, r.roster_id)))
	);
}

const me = Number(process.argv[2] ?? 1);
function rosterOf(id: number): SleeperRoster {
	const found = rosters.find((r) => r.roster_id === id);
	if (!found) throw new Error(`The recorded league has no roster ${String(id)}.`);
	return found;
}
const mine = rosterOf(me);
const lines = new Map(
	await Promise.all(rosters.map(async (r) => [r.roster_id, await rosterLines(r)] as const))
);
const myLines = lines.get(me) ?? [];

// The lineup.
async function lineup(): Promise<LineupAdvice> {
	const hostStarters = await Promise.all(
		mine.starters.map(async (id) => (id === '0' ? null : lineOf(leaguePlayer(id, me))))
	);
	const ours = fill(myLines, true, new Set(mine.starters));
	// Keep the host's arrangement where the same players start in alike slots.
	for (let i = 0; i < ours.length; i += 1) {
		const host = hostStarters[i]?.player.host_id;
		const j = ours.findIndex(
			(l, k) => k !== i && l?.player.host_id === host && slots[k] === slots[i]
		);
		if (j >= 0) [ours[i], ours[j]] = [ours[j] ?? null, ours[i] ?? null];
	}
	const started = new Set(ours.map((l) => l?.player.host_id));
	// As the API answers: a slot changes when ours is on the host's bench, and its host player is a
	// starter we sit (the one in that place when he sits, else the next one sat); an unchanged slot's
	// host player is ours.
	const hostIds = new Set(hostStarters.map((h) => h?.player.host_id));
	const sat = hostStarters.filter(
		(h): h is PlayerLine => h !== null && !started.has(h.player.host_id)
	);
	const out = slots.flatMap((slot, i): LineupSlot[] => {
		const o = ours[i];
		if (!o) return [];
		const kind = SLOT_OF[slot] ?? 'FLEX';
		if (hostIds.has(o.player.host_id)) {
			return [
				{ slot: kind, ours: o, host: o, changed: false, no_one_can_play: false, sentence: null }
			];
		}
		const here = hostStarters[i];
		const h =
			here && sat.includes(here)
				? here
				: (sat.find((l) => eligible(slot, l.player.position)) ?? sat[0] ?? null);
		if (h) sat.splice(sat.indexOf(h), 1);
		return [
			{
				slot: kind,
				ours: o,
				host: h,
				changed: true,
				no_one_can_play: false,
				sentence: changeSentence(o, h)
			}
		];
	});
	const bench = myLines
		.filter((l) => !started.has(l.player.host_id))
		.sort((a, b) => vorOf(b) - vorOf(a))
		// One bench player tagged Hold, as a member would on a sheet, so the screen draws a held row.
		.map((l) => (l.player.name === HELD_ON_SHEET ? { ...l, held: true } : l));
	return {
		...head(
			// project.ts words it as the API does now (Lane 66d).
			`Ranked by our rest-of-season order and this week's designations. We do not project a week's points. ${basisTail}`
		),
		projection_read_at: null,
		projection_previous_read_at: null,
		projection_scoring: { format: 'ppr', league_own: false },
		// Sleeper gives each player's points; no game has kicked off in the recorded week.
		player_points: true,
		team_points: null,
		set: out.every((s) => !s.changed),
		slots: out,
		bench,
		reserve: [],
		empty_slots: [],
		host_lineup_url: `https://sleeper.com/leagues/${league.league_id}/team`,
		host_note: null,
		// Sleeper has no write API: the verb copies the lineup, the API's line saying why.
		moves: {
			lineup: 'unavailable',
			note: null,
			takes_writes: false,
			writes_on: false,
			reason: SLEEPER_NO_LINEUP
		}
	};
}

/** A name's second mention, as the API's lastName: the last word, or the one before a suffix. */
function lastName(full: string): string {
	const words = full.trim().split(/\s+/);
	const last = words.at(-1) ?? full;
	return /^(jr|sr|ii|iii|iv|v)\.?$/i.test(last) && words.length > 1 ? (words.at(-2) ?? last) : last;
}

/** The mean of the last games a reason names, null with none. */
function namedMean(line: PlayerLine): number | null {
	const games = line.facts.last_games.slice(0, NAMED_GAMES);
	return games.length === 0 ? null : games.reduce((sum, g) => sum + g.points, 0) / games.length;
}

/** A change's reason in the API's words (sentences.go Change): the bye that forces it, else the
 * order, then his last games only when they beat the player he replaces. */
function changeSentence(ours: PlayerLine, host: PlayerLine | null): string {
	if (host === null) return `Your lineup has nobody in this spot, so ${ours.player.name} starts.`;
	if (host.facts.bye) {
		return `${host.player.name} is on bye this week, so ${lastName(ours.player.name)} starts.`;
	}
	const rank = (l: PlayerLine): string => `${l.player.position}${String(l.position_rank ?? '')}`;
	const order = `${lastName(ours.player.name)} is ${rank(ours)} in our rest-of-season order, ${lastName(host.player.name)} ${rank(host)}.`;
	const mine = namedMean(ours);
	const theirs = namedMean(host);
	const games = ours.facts.last_games;
	if (mine === null || theirs === null || mine <= theirs) return order;
	const support =
		games.length >= NAMED_GAMES
			? `He scored ${(games[0]?.points ?? 0).toFixed(1)} and ${(games[1]?.points ?? 0).toFixed(1)} in his last two games under your league's scoring.`
			: `He scored ${(games[0]?.points ?? 0).toFixed(1)} in his last game under your league's scoring.`;
	return `${order} ${support}`;
}

function head(basis: string): AdviceHead {
	return {
		week,
		basis,
		basis_note: basisNote,
		order_basis: 'rest_of_season',
		refreshed,
		read_at: manifest.runAt
	};
}

// The waiver adds.
async function waivers(held: ReadonlySet<string>): Promise<WaiverAdvice> {
	const pool = await Promise.all(
		board.rows
			.filter((r) => !held.has(r.id))
			.slice(0, POOL_CANDIDATES)
			.map(boardLine)
	);
	const defenses = myLines.filter((l) => l.player.position === 'DEF').length;
	const droppable = myLines.filter(
		(l) => l.player.position !== 'DEF' || defenses > slots.filter((s) => s === 'DEF').length
	);
	const base = strength(fill(myLines, false));
	const thisWeek = fill(myLines, true);
	const rows = pool.map((add): WaiverRow => {
		const options = droppable.map((drop) => {
			const roster = [...myLines.filter((l) => l !== drop), add];
			return { drop, after: strength(fill(roster, false)), roster };
		});
		const best = options.sort((a, b) => b.after - a.after || vorOf(a.drop) - vorOf(b.drop))[0];
		const week = best ? fill(best.roster, true) : thisWeek;
		const at = week.findIndex((l) => l === add);
		const gain = best ? tenth(best.after - base) : 0;
		return {
			add,
			drop: best?.drop ?? null,
			gain,
			// As the API answers: he starts for you only with a gain to show.
			starts: at >= 0 && gain > 0,
			sentence: waiverSentence(add, best?.drop ?? null, gain, at >= 0),
			// The week's figures (Lane 66f) need the projection: project.ts stamps them.
			week_gain: 0,
			pickup: false,
			beats: null,
			drops: [],
			clears: null
		};
	});
	const gaining = rows.filter((r) => r.gain > 0).sort((a, b) => b.gain - a.gain);
	const rest = rows.filter((r) => r.gain <= 0).slice(0, WAIVER_ROWS_UNDER_RULE);
	return {
		...head(
			`Ranked by the gain to your lineup on our rest-of-season order. A drop is the player it costs you least to lose. ${basisTail}`
		),
		rows: [...gaining, ...rest],
		host_waivers_url: `https://sleeper.com/leagues/${league.league_id}/players`,
		host_note: null,
		// Sleeper has no write path: the verb is the platform's page (inseason CopyOnlyClaims).
		moves: {
			claim: 'unavailable',
			note: null,
			takes_writes: false,
			writes_on: false,
			reason: 'Sleeper does not take claims from here, so add him on its waiver page.'
		},
		// Lane 66f: the pickup table's own fields, stamped by project.ts with the projection.
		season_basis: '',
		lineup_proj: null,
		pickups_proj: null,
		pickups: [],
		roster: myLines,
		projection_read_at: null,
		projection_previous_read_at: null,
		projection_scoring: { format: 'ppr', league_own: false }
	};
}

/** A waiver row's sentence in the API's words (sentences.go Waiver): the gain and the drop, the gain
 * from a player who sits this week, or his place on the order behind your starters. */
function waiverSentence(
	add: PlayerLine,
	drop: PlayerLine | null,
	gain: number,
	starts: boolean
): string {
	const name = add.player.name;
	const dropped =
		drop === null
			? 'Your open roster spot takes him with no drop.'
			: `${drop.player.name} is the player it costs you least to lose.`;
	if (gain > 0 && !starts) {
		return `${name} does not start for you this week, and your lineup still gains ${gain.toFixed(1)} points over replacement a week with him on our rest-of-season order. ${dropped}`;
	}
	if (gain > 0) {
		return `${name} starts for you, and your lineup gains ${gain.toFixed(1)} points over replacement a week on our rest-of-season order. ${dropped}`;
	}
	if (add.position_rank !== null) {
		return `${name} is ${add.player.position}${String(add.position_rank)} in our rest-of-season order and would not start for you.`;
	}
	return `${name} is not in our order and would not start for you.`;
}

// The trades.
function pairs<T>(items: readonly T[]): T[][] {
	return items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b]));
}

/** The member's drop for a trade that brings in more than it sends to his full roster (the API's
 * withDrop): the last on our order among those the lineup after the trade does not start, never a
 * player held, never his only defense. */
function tradeDrop(
	after: readonly PlayerLine[],
	give: readonly PlayerLine[],
	get: readonly PlayerLine[]
): PlayerLine | null {
	if (get.length <= give.length || after.length <= spots) return null;
	const starting = new Set(fill(after, false).map((l) => l?.player.host_id));
	const defenses = after.filter((l) => l.player.position === 'DEF').length;
	const droppable = after.filter(
		(l) =>
			!get.includes(l) &&
			!starting.has(l.player.host_id) &&
			!l.held &&
			(l.player.position !== 'DEF' || defenses > slots.filter((s) => s === 'DEF').length)
	);
	return droppable.sort((a, b) => vorOf(a) - vorOf(b) || rankOf(b) - rankOf(a))[0] ?? null;
}

/** Every spot on a roster, starters and bench. */
const spots = league.roster_positions.length;

function tradesWith(theirs: readonly PlayerLine[]): TradeRow[] {
	const tradable = (l: PlayerLine): boolean => SKILL.has(l.player.position);
	const mineSkill = myLines.filter(tradable);
	const theirSkill = theirs.filter(tradable);
	const myBase = strength(fill(myLines, false));
	const theirBase = strength(fill(theirs, false));
	const shapes: [PlayerLine[], PlayerLine[]][] = [
		...mineSkill.flatMap((a) => theirSkill.map((b): [PlayerLine[], PlayerLine[]] => [[a], [b]])),
		...pairs(mineSkill).flatMap((give) =>
			theirSkill.map((b): [PlayerLine[], PlayerLine[]] => [give, [b]])
		),
		...mineSkill.flatMap((a) =>
			pairs(theirSkill).map((get): [PlayerLine[], PlayerLine[]] => [[a], get])
		)
	];
	return (
		shapes
			.flatMap(([give, get]): TradeRow[] => {
				const myAfter = fill([...myLines.filter((l) => !give.includes(l)), ...get], false);
				const theirAfter = fill([...theirs.filter((l) => !get.includes(l)), ...give], false);
				if (!fillsEvery(myAfter) || !fillsEvery(theirAfter)) return [];
				const myGain = tenth(strength(myAfter) - myBase);
				const theirGain = tenth(strength(theirAfter) - theirBase);
				if (myGain <= 0 || theirGain <= 0) return [];
				const myRoster = [...myLines.filter((l) => !give.includes(l)), ...get];
				const drop = tradeDrop(myRoster, give, get);
				if (get.length > give.length && drop === null) return [];
				return [
					{
						give,
						get,
						drop,
						my_gain: myGain,
						their_gain: theirGain,
						close_for_them: theirGain < CLOSE_FOR_THEM,
						// The week's Proj is stamped by project.ts (Lane 66g).
						my_proj_change: null,
						their_proj_change: null
					}
				];
			})
			// As the API orders them: the trades they gain from first, then the close calls for them, each
			// by your gain.
			.sort(
				(a, b) =>
					Number(a.close_for_them) - Number(b.close_for_them) ||
					b.my_gain - a.my_gain ||
					b.their_gain - a.their_gain
			)
			.slice(0, TRADES_PER_TEAM)
	);
}

/** The order the API lists a roster in (advice.go positionOrder): by position, then name. */
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function rosterByPosition(roster: readonly PlayerLine[]): PlayerLine[] {
	const rank = (l: PlayerLine): number => {
		const at = POSITION_ORDER.indexOf(l.player.position);
		return at < 0 ? POSITION_ORDER.length : at;
	};
	return [...roster].sort(
		(a, b) =>
			rank(a) - rank(b) ||
			(a.player.name < b.player.name ? -1 : a.player.name > b.player.name ? 1 : 0)
	);
}

function trades(): TradeAdvice {
	const teams: TradeTeam[] = rosters
		.filter((r) => r.roster_id !== me)
		.map((r) => ({
			roster_id: r.roster_id,
			name: teamName(r),
			owner: ownerName(r),
			record: { wins: r.settings.wins, losses: r.settings.losses, ties: r.settings.ties },
			roster: rosterByPosition(lines.get(r.roster_id) ?? []),
			trades: tradesWith(lines.get(r.roster_id) ?? [])
		}))
		.map((team) => ({
			...team,
			note:
				team.trades.length > 0 && team.trades.every((t) => t.close_for_them)
					? 'Every trade we found with this team is a close call for them.'
					: null
		}));
	return {
		...head(
			`Trades where both lineups gain on our rest-of-season order. Each team's best trade, yours first, among those they gain at least 0.5 a week from, then the close calls for them. The other team decides. ${basisTail}`
		),
		check_basis: `What each lineup gains or loses on our rest-of-season order. The other team decides. ${basisTail}`,
		teams,
		roster: rosterByPosition(myLines),
		host_trades_url: `https://sleeper.com/leagues/${league.league_id}/team`,
		host_note: null,
		// No platform takes a proposal from here (inseason hosturls.go TradeMoves); project.ts stamps the
		// projection's read.
		moves: {
			propose: 'unavailable',
			reason:
				'Sleeper does not take trade proposals from here, so we copy the trade for you to propose there.'
		},
		projection_read_at: null,
		projection_scoring: { format: 'ppr', league_own: false },
		player_points: true
	};
}

// The league as the API's sync answers it.
function sync(): LeagueSync {
	const heldBy: Record<string, number> = {};
	for (const r of rosters) {
		for (const id of r.players) {
			const row = placed(id);
			if (row) heldBy[row.id] = r.roster_id;
		}
	}
	const points = (r: SleeperRoster): number =>
		r.settings.fpts + (r.settings.fpts_decimal ?? 0) / DECIMALS;
	const standings = [...rosters].sort(
		(a, b) => b.settings.wins - a.settings.wins || points(b) - points(a)
	);
	const side = (m: SleeperMatchup): MatchupSide => ({
		roster_id: m.roster_id,
		points: m.points,
		points_read: true,
		starters: m.starters.map((id, i) => ({
			player: leaguePlayer(id, m.roster_id),
			points: m.starters_points[i] ?? 0
		}))
	});
	const myMatchup = matchups.find((m) => m.roster_id === me);
	const opponent = matchups.find(
		(m) => m.matchup_id === myMatchup?.matchup_id && m.roster_id !== me
	);
	const reserve = new Set(mine.reserve ?? []);
	const taxi = new Set(mine.taxi ?? []);
	const starters = new Set(mine.starters);
	const spot = (id: string): LeagueSync['roster'][number]['slot'] =>
		reserve.has(id) ? 'reserve' : taxi.has(id) ? 'taxi' : starters.has(id) ? 'starter' : 'bench';
	const order = [...mine.starters, ...mine.players.filter((id) => !starters.has(id))];
	const unplaced = rosters
		.flatMap((r) => r.players)
		.filter((id) => placed(id) === null && sleeperPlayers[id]?.position !== 'DEF').length;
	return {
		id: FIXTURE_IDS.league,
		host: 'sleeper',
		host_league_id: league.league_id,
		season: Number(league.season),
		name: league.name,
		status: 'in_season',
		week,
		week_all_play: false,
		me,
		settings_league_id: null,
		settings_note: null,
		scoring_like: 'ppr',
		scoring_dropped: [],
		scoring_defaulted: [],
		teams: standings.map((r) => ({
			roster_id: r.roster_id,
			name: teamName(r),
			owner: ownerName(r),
			wins: r.settings.wins,
			losses: r.settings.losses,
			ties: r.settings.ties,
			points_for: round(points(r))
		})),
		roster: order.map((id) => ({ player: leaguePlayer(id, me), slot: spot(id) })),
		matchup: myMatchup
			? { week, mine: side(myMatchup), opponent: opponent ? side(opponent) : null }
			: null,
		moves: moves
			.filter((m) => m.status === 'complete')
			.sort((a, b) => b.created - a.created)
			.map((m) => ({
				kind: m.type === 'free_agent' ? 'add' : m.type,
				at: new Date(m.created).toISOString(),
				roster_ids: m.roster_ids,
				adds: Object.entries(m.adds ?? {}).map(([id, rid]) => ({
					player: leaguePlayer(id, null),
					roster_id: rid
				})),
				drops: Object.entries(m.drops ?? {}).map(([id, rid]) => ({
					player: leaguePlayer(id, null),
					roster_id: rid
				}))
			})),
		held_by: heldBy,
		rostered: Object.keys(heldBy).sort(),
		board_format: 'ppr',
		byes,
		placement: { by_espn_id: 0, by_defense: 0, by_name: Object.keys(heldBy).length, unplaced },
		read_at: manifest.runAt,
		host_stale_seconds: 0,
		host_failed: false,
		host_signed_out: false
	};
}

const synced = sync();
const answers = {
	sync: synced,
	lineup: await lineup(),
	waivers: await waivers(new Set(Object.keys(synced.held_by))),
	trades: trades()
};
// Written as the repo's Prettier writes JSON, so the lint holds on a rebuilt fixture.
const style = await resolveConfig(fileURLToPath(OUT));
await Promise.all(
	Object.entries(answers).map(async ([name, body]) =>
		writeFile(
			new URL(`${name}.json`, OUT),
			await prettierFormat(JSON.stringify(body), { ...style, parser: 'json' })
		)
	)
);
process.stdout.write(
	`Run ${runId}, roster ${String(me)} (${teamName(mine)}): ${String(answers.lineup.slots.filter((s) => s.changed).length)} lineup changes, ${String(answers.waivers.rows.filter((r) => r.gain > 0).length)} adds that gain, ${String(answers.trades.teams.reduce((n, t) => n + t.trades.length, 0))} trades.\n`
);
