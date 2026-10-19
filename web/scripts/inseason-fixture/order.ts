// Builds the order's fixture (Lane 66j), GET /leagues/attached/{id}/order's answer for the recorded
// Sleeper league in week 6, from the fixture's own answers, so the Rest of season and Players shots
// read the same players and figures the league's screens do:
//   - every player line the lineup, waivers, trades and matchup answers carry (the fullest copy of
//     each), as served: rest-of-season points a game, the week's facts, Proj, Avg, Last, Opp rank and
//     points over replacement a week;
//   - roster is the recorded league's holdings (sync.json held_by), and the move is the API's rule
//     over them: add for a free player, trade for a player the trade finder's best trade with his
//     team brings in (trades.json), none for the member's own; the claim's moves are the Waivers
//     answer's (waivers.json), Sleeper taking no claim from here;
//   - across positions the rows are in the order of their points over replacement, as the API ranks
//     (rank_by points_over_replacement), with no kicker or defense (Lane 66m).
// STAND-INS, named here and in the shots' caption: the fixture holds 85 of the order's players;
// rest_of_season_points is the line's points a game times his club's games left from week 6 through
// 17 (the byes in sync.json), the division the API makes the other way; points_over_replacement is
// the line's a week times the 12 weeks the order covers; at a position serve.ts ranks the players it
// holds 1 to n by those stand-in totals, as the API ranks by the real ones; and the published
// projection's read time is the fixture's.
//
//   node scripts/inseason-fixture/order.ts
import { readFile, writeFile } from 'node:fs/promises';
import { format as prettierFormat, resolveConfig } from 'prettier';
import type { components } from '../../src/lib/api/types.ts';
import { PER_GAME_BASIS, uncountedOf } from './week.ts';

type PlayerLine = components['schemas']['PlayerLine'];
type OrderAdvice = components['schemas']['OrderAdvice'];
type OrderRow = components['schemas']['OrderRow'];
type LeagueSync = components['schemas']['LeagueSync'];

const DATA = new URL('./data/', import.meta.url);
const ANSWERS = ['lineup', 'waivers', 'trades', 'matchup'] as const;
const WEEK = 6;
const LAST_WEEK = 17;
/** The weeks the rest-of-season order covers, week 6 through 17. */
const WEEKS_COVERED = LAST_WEEK - WEEK + 1;
const TENTH = 10;
/** The positions the order ranks: no kickers or defenses (Lane 66m). */
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

const read = async <T>(name: string): Promise<T> =>
	JSON.parse(await readFile(new URL(`${name}.json`, DATA), 'utf8')) as T;

function isLine(value: unknown): value is PlayerLine {
	return (
		typeof value === 'object' &&
		value !== null &&
		'player' in value &&
		'rest_of_season_per_game' in value &&
		'facts' in value
	);
}

/** Every line in an answer, the fullest copy of each board id. */
function harvest(value: unknown, into: Map<string, PlayerLine>): void {
	if (Array.isArray(value)) {
		for (const item of value) harvest(item, into);
		return;
	}
	if (typeof value !== 'object' || value === null) return;
	if (isLine(value) && value.player.board_id !== null) {
		const held = into.get(value.player.board_id);
		const filled = (l: PlayerLine): number => Object.values(l).filter((v) => v !== null).length;
		if (held === undefined || filled(value) > filled(held)) into.set(value.player.board_id, value);
	}
	for (const child of Object.values(value)) harvest(child, into);
}

/** Who the trade finder brings in: the players its best trade with each team gets (the API's rule). */
function tradeTargets(trades: components['schemas']['TradeAdvice']): Set<string> {
	return new Set(
		trades.teams.flatMap((team) =>
			(team.trades[0]?.get ?? []).map((line) => line.player.board_id ?? '')
		)
	);
}

const [sync, trades, ...answers] = await Promise.all([
	read<LeagueSync>('sync'),
	read<components['schemas']['TradeAdvice']>('trades'),
	...ANSWERS.map((name) => read<unknown>(name))
]);
const lines = new Map<string, PlayerLine>();
for (const answer of answers) harvest(answer, lines);
const targets = tradeTargets(trades);
const teams = new Map(sync.teams.map((t) => [t.roster_id, t.name] as const));
const heldBy = sync.held_by;
const byes = sync.byes;

const gamesLeft = (club: string): number => {
	const bye = byes[club];
	return LAST_WEEK - WEEK + 1 - (bye !== undefined && bye >= WEEK && bye <= LAST_WEEK ? 1 : 0);
};

/** A figure to the tenth the API prints, half away from zero on its decimal value (Lane 66k's ruling). */
const tenth = (v: number | null): number | null =>
	v === null
		? null
		: Number(`${String(Math.sign(v) * Math.round(Number(`${String(Math.abs(v))}e1`)))}e-1`);

/** The line's figures as the order's route returns them, each a tenth. */
function tenths(line: PlayerLine): PlayerLine {
	return {
		...line,
		week_projection: tenth(line.week_projection),
		projection_delta: tenth(line.projection_delta),
		season_avg: tenth(line.season_avg),
		last_points: tenth(line.last_points)
	};
}

function rowOf(line: PlayerLine): Omit<OrderRow, 'rank'> {
	const id = line.player.board_id ?? '';
	const holder = heldBy[id];
	const roster: OrderRow['roster'] =
		holder === undefined
			? { kind: 'free', team: null }
			: holder === sync.me
				? { kind: 'yours', team: null }
				: { kind: 'team', team: teams.get(holder) ?? null };
	const move: OrderRow['move'] =
		roster.kind === 'free' ? 'add' : roster.kind === 'team' && targets.has(id) ? 'trade' : null;
	const perGame = line.rest_of_season_per_game;
	const perWeek = line.points_over_replacement;
	return {
		line: tenths(line),
		rest_of_season_points:
			perGame === null ? null : Math.round(perGame * gamesLeft(line.player.team) * TENTH) / TENTH,
		points_over_replacement:
			perWeek === null ? null : Math.round(perWeek * WEEKS_COVERED * TENTH) / TENTH,
		roster,
		move
	};
}

const ranked = [...lines.values()]
	.filter((line) => POSITIONS.has(line.player.position))
	.sort((a, b) => {
		const va = a.points_over_replacement;
		const vb = b.points_over_replacement;
		if ((va === null) !== (vb === null)) return va === null ? 1 : -1;
		return (vb ?? 0) - (va ?? 0);
	});
const lineup = await read<components['schemas']['LineupAdvice']>('lineup');
const waivers = await read<components['schemas']['WaiverAdvice']>('waivers');
const out: OrderAdvice = {
	week: WEEK,
	// The order, the league its points over replacement are for and the figure a game, then the rules
	// Avg and Last leave out, as the API says them (OrderScreenBasis, withPerGame, UncountedOf; Lane 66t).
	basis: `Our rest-of-season order from week ${String(WEEK)}. A position ranks by Projected through week ${String(LAST_WEEK)}, byes out, All by Over repl., his points less a free pickup's in your league. ${PER_GAME_BASIS}`,
	...uncountedOf(lineup.uncounted_rules),
	rank_by: 'points_over_replacement',
	moves: waivers.moves,
	order_basis: 'rest_of_season',
	refreshed: lineup.refreshed,
	from_week: WEEK,
	read_at: lineup.read_at,
	projection_read_at: lineup.projection_read_at,
	projection_scoring: lineup.projection_scoring,
	total: ranked.length,
	rows: ranked.map((line, i) => ({ rank: i + 1, ...rowOf(line) }))
};
const file = new URL('order.json', DATA);
const text = await prettierFormat(JSON.stringify(out), {
	...(await resolveConfig(file.pathname)),
	parser: 'json'
});
await writeFile(file, text);
process.stdout.write(`order.json: ${String(out.rows.length)} rows\n`);
