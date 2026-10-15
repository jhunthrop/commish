// Builds the in-season screens' fixture until the API's three routes land (Lane 25): the recorded
// Sleeper league (api/internal/leaguesync/replay/sleeper, a real 12-team league read in week 6) read
// as a LeagueSync, and the three answers of spec §7 for one of its teams, every figure taken from the
// run's own board and game logs:
//   - position_rank and points_over_replacement are the run's PPR board row, as served;
//   - last_games are the run's game logs scored with the league's own rules (its scoring settings);
//   - opponent, home, kickoff and bye are the run's schedule;
//   - designation, points_this_week and allowed_to_position are not held by the run: absent (null).
// The lineups, the drops and the trades come from a plain stand-in for the API's engine (§4.2 on the
// run's rest-of-season order, flex by points over replacement), and a gain a week is the change in a
// lineup's summed points over replacement divided by the weeks the rest-of-season order covers. The
// API's own engine replaces all of it; only the shapes and the figures' sources are meant to hold.
//
//   node scripts/inseason-fixture/build.ts [roster id]   (reads .runs/runs/<PUBLIC_RUN_ID or latest>)
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format as prettierFormat, resolveConfig } from 'prettier';
import { listWords } from '../../src/lib/format/list.ts';
import { FIXTURE_IDS } from './ids.ts';
import { slotChanges } from '../../src/lib/league/inseason/words.ts';
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
} from '../../src/lib/league/inseason/types.ts';

const REPLAY = new URL('../../../api/internal/leaguesync/replay/sleeper/', import.meta.url);
const RUNS = new URL('../../.runs/runs/', import.meta.url);
const OUT = new URL('./data/', import.meta.url);
const FORMAT = 'ppr-12';
const LAST_WEEK = 18;
const LAST_GAMES = 3;
const POOL_CANDIDATES = 60;
const WAIVER_ROWS_UNDER_RULE = 8;
const TRADES_PER_TEAM = 4;
const CLOSE_FOR_THEM = 0.5;
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
const FLEX = new Set(['RB', 'WR', 'TE']);
const SUPER_FLEX = new Set(['QB', 'RB', 'WR', 'TE']);
const DECIMALS = 100;

const round = (n: number): number => Math.round(n * DECIMALS) / DECIMALS;

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
	name: string;
	position: string;
	team: string;
	positionRank: number;
	vor: number;
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
const rosFrom = format.rosFromWeek;
const refreshed = format.refreshedAt;
const weeksLeft = LAST_WEEK - rosFrom + 1;
const week = state.week;

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
		.map((g) => ({ week: g.week, points: leaguePoints(g) }));
}

async function factsFor(team: string, boardId: string | null): Promise<WeekFacts> {
	const game = games.get(team)?.find((g) => g.week === week) ?? null;
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
		allowed_to_position: null
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
		position_rank: row?.positionRank ?? null,
		points_over_replacement: row === null ? null : round(row.vor),
		facts: await factsFor(row?.team ?? player.team, player.board_id)
	};
}

async function boardLine(row: BoardRow): Promise<PlayerLine> {
	return lineOf({
		host_id: `board-${row.id}`,
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
	const diffed: LineupSlot[] = slots.flatMap((slot, i) => {
		const o = ours[i];
		if (!o) return [];
		const h = hostStarters[i] ?? null;
		return [
			{ slot, ours: o, host: h, changed: h?.player.host_id !== o.player.host_id, sentence: null }
		];
	});
	// A start's sentence names the player it sits, at the end of any chain of moves.
	const changes = slotChanges(diffed);
	const out = diffed.map((s, i) => {
		const change = changes[i];
		return change?.kind === 'start'
			? { ...s, sentence: changeSentence(change.start, change.sit) }
			: s;
	});
	const bench = myLines
		.filter((l) => !started.has(l.player.host_id))
		.sort((a, b) => vorOf(b) - vorOf(a));
	return {
		...head(
			`Ranked by our rest-of-season order from week ${String(rosFrom)} and this week's designations. We do not project a week's points.`
		),
		set: out.every((s) => !s.changed),
		slots: out,
		bench,
		host_lineup_url: `https://sleeper.com/leagues/${league.league_id}/team`
	};
}

function changeSentence(ours: PlayerLine, host: PlayerLine | null): string {
	if (host === null) return `${ours.player.name} fills a slot left empty.`;
	if (host.facts.bye) return `${host.player.name} is on bye this week.`;
	const a = `${ours.player.position}${String(ours.position_rank ?? '')}`;
	const b = `${host.player.position}${String(host.position_rank ?? '')}`;
	const last = ours.facts.last_games.at(-1);
	const support =
		last === undefined ? '' : ` He scored ${last.points.toFixed(1)} in his last game.`;
	return `${ours.player.name} is ${a} in our rest-of-season order, ${host.player.name} ${b}.${support}`;
}

function head(basis: string): AdviceHead {
	return { week, basis, order_basis: 'rest_of_season', refreshed, read_at: manifest.runAt };
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
		const gain = best ? round((best.after - base) / weeksLeft) : 0;
		return {
			add,
			drop: best?.drop ?? null,
			gain,
			starts: at >= 0,
			sentence: waiverSentence(add, at, thisWeek)
		};
	});
	const gaining = rows.filter((r) => r.gain > 0).sort((a, b) => b.gain - a.gain);
	const rest = rows.filter((r) => r.gain <= 0).slice(0, WAIVER_ROWS_UNDER_RULE);
	return {
		...head(
			'Ranked by the gain to your lineup on our rest-of-season order. A drop is the player it costs you least to lose.'
		),
		best: gaining[0] ?? null,
		rows: [...gaining, ...rest],
		host_waivers_url: `https://sleeper.com/leagues/${league.league_id}/players`
	};
}

function waiverSentence(
	add: PlayerLine,
	at: number,
	thisWeek: readonly (PlayerLine | null)[]
): string {
	if (at >= 0) {
		const over = thisWeek[at];
		const slot = slots[at] ?? '';
		const where = slot.includes('FLEX') ? 'in the flex' : `at ${slot}`;
		return over ? `He starts ${where} over ${over.player.name}.` : `He starts ${where}.`;
	}
	const ahead = thisWeek
		.filter((l): l is PlayerLine => l?.player.position === add.player.position)
		.map((l) => l.player.name);
	if (ahead.length === 0) return 'He sits behind your starters this week.';
	const verb = ahead.length === 1 ? 'starts' : 'start';
	return `${listWords(ahead)} ${verb} ahead of him at ${add.player.position} this week.`;
}

// The trades.
function pairs<T>(items: readonly T[]): T[][] {
	return items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b]));
}

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
	return shapes
		.flatMap(([give, get]): TradeRow[] => {
			const myAfter = fill([...myLines.filter((l) => !give.includes(l)), ...get], false);
			const theirAfter = fill([...theirs.filter((l) => !get.includes(l)), ...give], false);
			if (!fillsEvery(myAfter) || !fillsEvery(theirAfter)) return [];
			const myGain = round((strength(myAfter) - myBase) / weeksLeft);
			const theirGain = round((strength(theirAfter) - theirBase) / weeksLeft);
			if (myGain <= 0 || theirGain <= 0) return [];
			return [
				{
					give,
					get,
					my_gain: myGain,
					their_gain: theirGain,
					close_for_them: theirGain < CLOSE_FOR_THEM
				}
			];
		})
		.sort((a, b) => b.my_gain - a.my_gain)
		.slice(0, TRADES_PER_TEAM);
}

function trades(): TradeAdvice {
	const teams: TradeTeam[] = rosters
		.filter((r) => r.roster_id !== me)
		.map((r) => ({
			roster_id: r.roster_id,
			name: teamName(r),
			owner: ownerName(r),
			record: { wins: r.settings.wins, losses: r.settings.losses, ties: r.settings.ties },
			trades: tradesWith(lines.get(r.roster_id) ?? [])
		}));
	return {
		...head('Trades where both lineups gain on our rest-of-season order. The other team decides.'),
		teams,
		host_trades_url: `https://sleeper.com/leagues/${league.league_id}/trade`
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
