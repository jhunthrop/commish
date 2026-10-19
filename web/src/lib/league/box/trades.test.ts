// The Trades screen as a trade table (Lane 66g): its rows, its order, its strip, its builder's
// scoreboard and every word it prints. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayerLine, TradeAdvice, TradeCheck, TradeRow, TradeTeam } from '../inseason/api.ts';
import {
	bugFigures,
	checkRoom,
	copiedTrade,
	finderRows,
	fromWords,
	gainWord,
	offerText,
	phoneWith,
	proposeVerb,
	rosterOrder,
	shortSide,
	sideRows,
	weekLine,
	sortRows,
	toneOf,
	tradeBasis,
	TRADES,
	weekWord,
	worthProposing,
	worthTitle
} from './trades.ts';

const line = (name: string, position = 'RB', proj: number | null = null): PlayerLine => ({
	player: {
		host_id: `h-${name}`,
		board_id: `b-${name}`,
		name,
		position,
		team: 'NYG',
		injured_reserve: false
	},
	headshot: null,
	slug: null,
	position_rank: 14,
	points_over_replacement: 1.2,
	rest_of_season_per_game: 9.3,
	week_projection: proj,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: {
		week: 6,
		opponent: 'NO',
		home: true,
		kickoff: null,
		bye: false,
		designation: null,
		played: false,
		points_this_week: null,
		last_games: [],
		allowed_to_position: null,
		game_total: null,
		spread: null,
		roof: null,
		weather: null
	}
});

const row = (mine: number, theirs: number, over: Partial<TradeRow> = {}): TradeRow => ({
	give: [line('Aaron Rodgers', 'QB')],
	get: [line('Cam Skattebo'), line('Pierre Strong')],
	drop: line('Jaxson Dart', 'QB'),
	drop_reason: null,
	my_gain: mine,
	their_gain: theirs,
	close_for_them: theirs < 0.5,
	my_proj_change: 7.3,
	their_proj_change: 2.5,
	...over
});

const team = (id: number, name: string, trades: TradeRow[]): TradeTeam => ({
	roster_id: id,
	name,
	owner: name,
	record: { wins: 1, losses: 4, ties: 0 },
	roster: [],
	trades,
	note: null
});

const teams = [
	team(7, 'thatmattkelley', [row(4.6, 0.5, { my_proj_change: 10.9, their_proj_change: -5.6 })]),
	team(8, 'Max_Jensen10', [row(5.7, 0.7), row(5.6, 0.8)]),
	team(9, 'Aaron Donald Dependent', [row(0.7, 0.2)]),
	team(10, 'Muttdogs', [])
];

void test("the finder lists each team's best, or every trade, in the API's order across teams", () => {
	assert.deepEqual(
		finderRows(teams, false).map((r) => r.team.name),
		['Max_Jensen10', 'thatmattkelley', 'Aaron Donald Dependent']
	);
	assert.equal(finderRows(teams, true).length, 4);
	const keys = finderRows(teams, true).map((r) => r.key);
	assert.equal(new Set(keys).size, keys.length - 1, 'two alike trades with one team share a key');
});

void test('a column sorts best first, a row without the figure last, ties in the API order', () => {
	const rows = finderRows(teams, false);
	assert.deepEqual(
		sortRows(rows, 'weekMine').map((r) => r.team.name),
		['thatmattkelley', 'Max_Jensen10', 'Aaron Donald Dependent']
	);
	assert.deepEqual(
		sortRows(rows, 'weekTheirs').map((r) => r.team.name),
		['Max_Jensen10', 'Aaron Donald Dependent', 'thatmattkelley']
	);
	const missing = finderRows(
		[team(3, 'Late', [row(9, 0.9, { my_proj_change: null })]), ...teams],
		false
	);
	assert.equal(sortRows(missing, 'weekMine').at(-1)?.team.name, 'Late');
	assert.equal(sortRows(missing, 'mine')[0]?.team.name, 'Late');
});

void test('the strip names at most two trades the other team gains from, never a close call', () => {
	const worth = worthProposing(teams);
	assert.deepEqual(
		worth.map((r) => r.team.name),
		['Max_Jensen10', 'thatmattkelley']
	);
	assert.equal(worthTitle(worth.length), 'Two trades worth proposing');
	assert.equal(worthTitle(1), 'One trade worth proposing');
	assert.deepEqual(worthProposing([team(9, 'Close', [row(0.7, 0.2)])]), []);
});

void test('a trade reads by last names, its gains and week signed, its room by name', () => {
	const best = row(5.7, 0.7);
	assert.equal(
		`${shortSide(best.give)} for ${shortSide(best.get)}`,
		'Rodgers for Skattebo and Strong'
	);
	assert.equal(gainWord(5.7), '+5.7');
	assert.equal(gainWord(-0.34), '−0.3');
	assert.equal(weekWord(-5.6), '−5.6');
	assert.equal(weekWord(0.04), '0.0');
	assert.equal(weekWord(null), '--');
	assert.equal(toneOf(-5.6), 'loss');
	assert.equal(toneOf(0.01), 'even');
	assert.equal(phoneWith({ name: 'Max_Jensen10' }, best), 'with Max_Jensen10, you drop Dart');
	assert.equal(phoneWith({ name: 'Muttdogs' }, { drop: null }), 'with Muttdogs');
	assert.equal(fromWords('McConkey Kong Country', true), 'From McConkey Kong Country, you');
	assert.equal(fromWords('Max_Jensen10', false), 'From Max_Jensen10');
});

void test("a trade's week reads from the API's two changes, on the card and atop an opened trade", () => {
	assert.equal(weekLine(row(5.7, 0.7)), '+7.3 Proj for you this week, +2.5 for them');
	assert.equal(
		weekLine(row(4.6, 0.5, { my_proj_change: 10.9, their_proj_change: -5.6 })),
		'+10.9 Proj for you this week, −5.6 for them'
	);
	assert.equal(
		weekLine(row(1, 1, { my_proj_change: 0.02, their_proj_change: 0 })),
		'0.0 Proj for you this week, 0.0 for them'
	);
	assert.equal(weekLine(row(1, 1, { my_proj_change: null, their_proj_change: null })), null);
});

void test('the opened trade lists your give and drop, then their get, each moving the right way', () => {
	const sides = sideRows(row(5.7, 0.7));
	assert.deepEqual(
		sides.yours.map((s) => [s.side, s.move, s.line.player.name]),
		[
			['Give', 'out', 'Aaron Rodgers'],
			['Drop', 'out', 'Jaxson Dart']
		]
	);
	assert.deepEqual(
		sides.theirs.map((s) => [s.side, s.move]),
		[
			['Get', 'in'],
			['Get', 'in']
		]
	);
});

void test('the verb follows the moves rule, the offer is copied in words, the confirm names the page', () => {
	assert.equal(proposeVerb({ propose: 'unavailable' }, 'sleeper'), 'Open Sleeper trades');
	assert.equal(proposeVerb({ propose: 'available' }, 'espn'), 'Propose on ESPN');
	assert.equal(
		offerText({ name: 'Max_Jensen10' }, row(5.7, 0.7)),
		'Trade with Max_Jensen10: Aaron Rodgers (QB NYG) for Cam Skattebo (RB NYG) and Pierre Strong (RB NYG).'
	);
	assert.deepEqual(copiedTrade('sleeper', true), { said: 'Copied.', page: "Sleeper's trade page" });
	assert.equal(copiedTrade('yahoo', false).said, 'This browser would not copy it.');
});

const check = (
	fills: Partial<TradeCheck['fills']> = {},
	drop: PlayerLine | null = null
): TradeCheck => ({
	week: 6,
	basis: '',
	basis_note: '',
	order_basis: 'rest_of_season',
	refreshed: '2026-10-14T19:05:37.917Z',
	read_at: '2026-10-15T19:05:37.917Z',
	trade: row(4.6, 0.5, { drop }),
	fills: {
		yours: true,
		theirs: true,
		yours_open: null,
		theirs_open: null,
		yours_room: true,
		theirs_room: true,
		...fills
	},
	totals: {
		yours: { proj_before: 109.4, proj_after: 120.3, season_before: 31.2, season_after: 35.8 },
		theirs: { proj_before: 104.7, proj_after: 99.1, season_before: 28.0, season_after: 28.5 }
	},
	host_trades_url: '',
	host_note: null
});

void test("the builder's room and scoreboard come from the check, '--' before one", () => {
	assert.deepEqual(checkRoom(check({}, line('Jaxson Dart', 'QB'))), {
		yours: 'Drop Dart',
		theirs: 'Has room'
	});
	assert.deepEqual(checkRoom(check({ yours_room: false, theirs_room: false })), {
		yours: 'No one to drop',
		theirs: 'No one to drop'
	});
	const answer = check();
	assert.deepEqual(bugFigures(answer.totals.theirs, answer.trade.their_gain, -5.6), {
		projBefore: '104.7',
		projAfter: '99.1',
		projChange: '−5.6',
		projTone: 'loss',
		seasonBefore: '28.0',
		seasonAfter: '28.5',
		seasonChange: '+0.5',
		seasonTone: 'gain'
	});
	const below = bugFigures(
		{ proj_before: 50, proj_after: 41.1, season_before: -1.3, season_after: -0.5 },
		0.8,
		-8.9
	);
	assert.equal(below.projChange, '−8.9');
	// The week's change is the API's own, never the totals subtracted here (review M1).
	assert.equal(bugFigures(answer.totals.yours, 4.6, 7.3).projChange, '+7.3');
	assert.equal(below.seasonBefore, '−1.3');
	assert.equal(below.seasonAfter, '−0.5');
	const before = bugFigures(null, null, null);
	assert.equal(before.projAfter, '--');
	assert.equal(before.seasonChange, '--');
	assert.equal(
		bugFigures({ proj_before: null, proj_after: null, season_before: 1, season_after: 2 }, 1, null)
			.projChange,
		'--'
	);
});

void test("the builder's box lists by position, each by this week's Proj, injured reserve last", () => {
	const ir = {
		...line('Tank Bigsby', 'RB', 4.4),
		player: { ...line('Tank Bigsby').player, injured_reserve: true }
	};
	const ordered = rosterOrder([
		line('Kenny Gainwell', 'RB', 9.5),
		ir,
		line('Travis Etienne', 'RB', 14.2),
		line('Zach Charbonnet', 'RB', null),
		line('Patrick Mahomes', 'QB', 17.9)
	]);
	assert.deepEqual(
		ordered.map((l) => l.player.name),
		['Patrick Mahomes', 'Travis Etienne', 'Kenny Gainwell', 'Zach Charbonnet', 'Tank Bigsby']
	);
});

const advice: Pick<
	TradeAdvice,
	'basis' | 'basis_note' | 'projection_read_at' | 'projection_scoring' | 'player_points'
> = {
	basis:
		"Trades where both lineups gain on our rest-of-season order. Each team's best trade, yours first, among those they gain at least 0.5 a week from, then the close calls for them. The other team decides.",
	basis_note: 'Points over replacement are for a 12-team league.',
	projection_read_at: '2026-10-17T02:00:00.000Z',
	projection_scoring: { format: 'ppr', league_own: false },
	player_points: true
};

void test('the basis is five lines at most, the first saying which trades are listed', () => {
	const lines = tradeBasis(advice, 'sleeper', [line('Cam Skattebo')], 'America/Chicago');
	assert.ok(lines.length <= 5, String(lines.length));
	assert.match(
		lines[0] ?? '',
		/^Trades where both lineups gain on our rest-of-season order\. .*then the close calls for them\. The other team decides\./
	);
	assert.match(
		lines[1] ?? '',
		/This week, Proj is each lineup's Proj total with the trade less without it/
	);
	assert.match(lines[2] ?? '', /Opp rank is where/);
	assert.match(lines[3] ?? '', /^Room says who a roster drops/);
});

/** The brief's words a fantasy screen never prints, a dash between clauses, a semicolon, and the
 * platform called anything but its name. */
const NEVER =
	/\b(market|prices?|buy|buys|sell|sells|values?|odds|spread|favou?red|underdog|bets?|betting|line|host)\b/i;

void test('copy guard: every word the trade table prints is fantasy words, the platform named', () => {
	const copied = copiedTrade('sleeper', true);
	const room = checkRoom(check({}, line('Jaxson Dart', 'QB')));
	const said: string[] = [
		...Object.values(TRADES),
		worthTitle(2),
		worthTitle(1),
		phoneWith({ name: 'Max_Jensen10' }, row(5.7, 0.7)),
		weekLine(row(5.7, 0.7)) ?? '',
		offerText({ name: 'Max_Jensen10' }, row(5.7, 0.7)),
		proposeVerb({ propose: 'unavailable' }, 'sleeper'),
		copied.said,
		copied.page,
		room.yours,
		room.theirs,
		...tradeBasis(advice, 'sleeper', [line('Cam Skattebo')], 'America/Chicago')
	];
	for (const text of said) {
		assert.doesNotMatch(text, NEVER, text);
		assert.doesNotMatch(text, /[–—;]/, text);
	}
});
