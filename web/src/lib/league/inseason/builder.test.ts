// The trade builder's behaviour and words: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { PlayerLine, TradeCheck, TradeRow, TradeTeam } from './api.ts';
import {
	ANALYZER_LINES,
	BAR_FLOOR,
	BUILDER_LINES,
	MAX_A_SIDE,
	builtFrom,
	checkInput,
	checkWords,
	countWords,
	fillsBoth,
	gainBars,
	openingPicks,
	pickPrompt,
	pickable,
	presetsFrom,
	samePicks,
	shareText,
	teamChoice,
	toggle
} from './builder.ts';

const line = (
	name: string,
	position = 'RB',
	over: Partial<PlayerLine['player']> = {}
): PlayerLine => ({
	player: {
		host_id: `h-${name}`,
		board_id: `b-${name}`,
		name,
		position,
		team: 'TB',
		injured_reserve: false,
		...over
	},
	headshot: null,
	slug: null,
	position_rank: 14,
	points_over_replacement: 1.2,
	rest_of_season_per_game: null,
	week_projection: null,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: {
		week: 6,
		opponent: 'BUF',
		home: false,
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

const row = (over: Partial<TradeRow> = {}): TradeRow => ({
	give: [line('Kyren Williams')],
	get: [line('Nico Collins', 'WR')],
	drop: null,
	drop_reason: null,
	my_gain: 2.1,
	their_gain: -0.8,
	close_for_them: true,
	my_proj_change: 1.4,
	their_proj_change: -2.2,
	...over
});

const check = (
	over: Partial<TradeRow> = {},
	fills: Partial<TradeCheck['fills']> = {}
): TradeCheck => ({
	week: 6,
	basis: 'The scoreboard is each lineup before and after the trade.',
	basis_note: '',
	order_basis: 'rest_of_season',
	refreshed: '2026-10-14T19:05:37.917Z',
	read_at: '2026-10-15T19:05:37.917Z',
	trade: row(over),
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
		yours: { proj_before: 98.4, proj_after: 99.8, season_before: 41.2, season_after: 43.3 },
		theirs: { proj_before: 101.0, proj_after: 98.8, season_before: 38.0, season_after: 37.2 }
	},
	host_trades_url: 'https://sleeper.com/leagues/1/team',
	host_note: null
});

void test('a roster with no one to drop says so before any gain, and one with room names the drop', () => {
	assert.equal(
		checkWords(check({}, { yours_room: false })),
		'Your roster has no one to drop to make room.'
	);
	assert.equal(
		checkWords(check({}, { theirs_room: false })),
		'Their roster has no one to drop to make room.'
	);
	assert.match(
		checkWords(check({ drop: line('Jaxson Dart', 'QB') })),
		/You drop Jaxson Dart to make room\.$/
	);
	// A drop this week's lineup starts says who takes his spot, in the API's sentence (Lane 66u).
	const reason =
		'Dart starts at QB for you this week, and Mahomes takes that spot after the trade.';
	assert.match(
		checkWords(check({ drop: line('Jaxson Dart', 'QB'), drop_reason: reason })),
		/You drop Jaxson Dart to make room\. Dart starts at QB for you this week, and Mahomes takes that spot after the trade\.$/
	);
});

void test('the answer line asks for what is missing, and says it is checking once both sides hold a player', () => {
	assert.equal(pickPrompt({ team: 3, give: [], get: [] }), BUILDER_LINES.pickBoth);
	assert.equal(pickPrompt({ team: 3, give: [], get: ['b'] }), BUILDER_LINES.pickYours);
	assert.equal(pickPrompt({ team: 3, give: ['a'], get: [] }), BUILDER_LINES.pickTheirs);
	assert.equal(pickPrompt({ team: 3, give: ['a'], get: ['b'] }), BUILDER_LINES.checking);
	assert.equal(BUILDER_LINES.checking, 'Checking the trade');
	assert.equal(BUILDER_LINES.full, 'Two picked, tap one to put him back');
});

void test('the answer line says what each lineup gains or loses, in points over replacement a week', () => {
	assert.equal(
		checkWords(check()),
		'Your lineup gains 2.1 points over replacement a week, theirs loses 0.8.'
	);
	assert.equal(
		checkWords(check({ my_gain: 1.5, their_gain: 0.6, close_for_them: false })),
		'Both lineups gain: yours 1.5 points over replacement a week, theirs 0.6.'
	);
	assert.equal(
		checkWords(check({ my_gain: -3, their_gain: 4.2 })),
		'Your lineup loses 3.0 points over replacement a week, theirs gains 4.2.'
	);
	assert.equal(
		checkWords(check({ my_gain: 0, their_gain: 0 })),
		'Neither lineup changes on our order.'
	);
	assert.equal(
		checkWords(check({ my_gain: 0, their_gain: 1.1 })),
		'Your lineup does not change, theirs gains 1.1 points over replacement a week.'
	);
	assert.equal(
		checkWords(check({ drop: line('Jaxson Dart', 'QB') })),
		'Your lineup gains 2.1 points over replacement a week, theirs loses 0.8. You drop Jaxson Dart to make room.'
	);
});

/** A line with his rest-of-season points a game. */
const figured = (l: PlayerLine, perGame: number | null): PlayerLine => ({
	...l,
	rest_of_season_per_game: perGame
});

void test("the answer line names the trade's players with their rest-of-season points a game", () => {
	assert.equal(
		checkWords(
			check({
				give: [figured(line('Kyren Williams'), 14.2)],
				get: [figured(line('Nico Collins', 'WR'), 17.84)]
			})
		),
		'Your lineup gains 2.1 points over replacement a week, theirs loses 0.8. You give Kyren Williams (14.2 a game) for Nico Collins (17.8 a game).'
	);
	assert.equal(
		checkWords(
			check({
				give: [figured(line('Kyren Williams'), 14.2), figured(line('Jordan Mason'), 9)],
				get: [figured(line('Nico Collins', 'WR'), null)],
				drop: line('Jaxson Dart', 'QB')
			})
		),
		'Your lineup gains 2.1 points over replacement a week, theirs loses 0.8. You give Kyren Williams (14.2 a game) and Jordan Mason (9.0 a game) for Nico Collins. You drop Jaxson Dart to make room.'
	);
	assert.doesNotMatch(checkWords(check()), /You give/, 'no figure, no players named');
});

void test('a roster the trade leaves short says so before any gain', () => {
	assert.equal(
		checkWords(check({}, { yours: false, yours_open: 'RB2' })),
		'Your roster would not fill RB2.'
	);
	assert.equal(
		checkWords(check({}, { theirs: false, theirs_open: 'TE' })),
		'Their roster would not fill TE.'
	);
	assert.equal(
		checkWords(check({}, { yours: false, yours_open: 'Flex' })),
		'Your roster would not fill the flex.'
	);
	assert.equal(
		checkWords(check({}, { yours: false, yours_open: null })),
		'Your roster would not fill every slot.'
	);
});

void test('a player is picked only at QB, RB, WR and TE, named by the host and off injured reserve', () => {
	assert.ok(pickable(line('Kyren Williams')));
	assert.ok(!pickable(line('Brandon Aubrey', 'K')));
	assert.ok(!pickable(line('Houston Texans', 'DEF')));
	assert.ok(pickable(line('Not On Our Board', 'WR', { board_id: null })));
	assert.ok(!pickable(line('No Host Id', 'WR', { host_id: '' })));
	assert.ok(!pickable(line('Hurt', 'WR', { injured_reserve: true })));
	const listed = line('Listed', 'WR');
	assert.ok(
		!pickable({
			...listed,
			facts: {
				...listed.facts,
				designation: { status: 'injured_reserve', as_of: '2026-10-15T00:00:00Z' }
			}
		})
	);
});

void test('a tap picks up to two a side and a second tap puts him back', () => {
	assert.deepEqual(toggle([], 'a'), ['a']);
	assert.deepEqual(toggle(['a'], 'b'), ['a', 'b']);
	assert.deepEqual(toggle(['a', 'b'], 'c'), ['a', 'b'], 'a third waits for one put back');
	assert.deepEqual(toggle(['a', 'b'], 'a'), ['b']);
	assert.equal(MAX_A_SIDE, 2);
});

void test('the check is asked only once both sides hold a player', () => {
	assert.equal(checkInput({ team: 3, give: ['a'], get: [] }), null);
	assert.equal(checkInput({ team: null, give: ['a'], get: ['b'] }), null);
	assert.deepEqual(checkInput({ team: 3, give: ['a'], get: ['b', 'c'] }), {
		team: 3,
		give: ['a'],
		get: ['b', 'c']
	});
});

void test("a finder row's Build from this fills the builder with that trade", () => {
	const team = { roster_id: 7 } as TradeTeam;
	assert.deepEqual(builtFrom(team, row({ give: [line('A'), line('B')], get: [line('C', 'WR')] })), {
		team: 7,
		give: ['h-A', 'h-B'],
		get: ['h-C']
	});
	assert.equal(builtFrom(team, row({ give: [line('A', 'RB', { host_id: '' })] })), null);
});

void test("a team is chosen by its name and record, the standings' people", () => {
	assert.equal(
		teamChoice({ name: 'Muttdogs', owner: 'muttdog', record: { wins: 5, losses: 0, ties: 0 } }),
		'Muttdogs, muttdog, 5-0'
	);
});

/** A team with its roster and its trades, best first as the API sends them. */
const team = (id: number, name: string, trades: TradeRow[]): TradeTeam => ({
	roster_id: id,
	name,
	owner: name.toLowerCase(),
	record: { wins: 3, losses: 2, ties: 0 },
	roster: [],
	trades,
	note: null
});

void test('our ideas are the best trade with each team, best first, each loading its picks', () => {
	const muttdogs = team(4, 'Muttdogs', [
		row({ my_gain: 1.8, their_gain: 0.5, close_for_them: false }),
		row({ my_gain: 9, their_gain: 0.1, close_for_them: true })
	]);
	const rangers = team(9, 'Bower Rangers', [
		row({
			give: [line('Jeremiyah Love')],
			get: [line('Tre Tucker', 'WR'), line('MarShawn Lloyd')],
			my_gain: 2.7,
			their_gain: 0.6,
			close_for_them: false
		})
	]);
	const empty = team(2, 'Ball Snatchers', []);
	const presets = presetsFrom([muttdogs, rangers, empty]);
	assert.deepEqual(
		presets.map((p) => [p.team.name, p.deal, p.gains, p.mark]),
		[
			[
				'Bower Rangers',
				'Love for Tucker and Lloyd',
				'+2.7 a week for your lineup, +0.6 for theirs',
				'Best'
			],
			['Muttdogs', 'Williams for Collins', '+1.8 a week for your lineup, +0.5 for theirs', null]
		]
	);
	assert.deepEqual(presets[0]?.picks, {
		team: 9,
		give: ['h-Jeremiyah Love'],
		get: ['h-Tre Tucker', 'h-MarShawn Lloyd']
	});
	// A lone idea is not called Best: there is nothing to be best among.
	assert.equal(presetsFrom([muttdogs])[0]?.mark, null);
	// A trade holding a player the host names no id for cannot be ticked: no preset.
	const unnamed = team(5, 'Nameless', [row({ get: [line('X', 'WR', { host_id: '' })] })]);
	assert.deepEqual(presetsFrom([unnamed]), []);
});

void test('the screen opens on the team our best idea names with nothing ticked, or no team', () => {
	const presets = presetsFrom([team(9, 'Bower Rangers', [row({ close_for_them: false })])]);
	assert.deepEqual(openingPicks(presets), { team: 9, give: [], get: [] });
	assert.deepEqual(openingPicks([]), { team: null, give: [], get: [] });
	assert.equal(
		ANALYZER_LINES.noTeam,
		'Pick a team to trade with, then tick a player on each side.'
	);
});

void test("the roster switch counts each side's ticks after its name, nothing for none", () => {
	assert.equal(countWords([]), '');
	assert.equal(countWords(['a']), ', 1');
	assert.equal(countWords(['a', 'b']), ', 2');
});

void test('a preset is pressed while the ticks hold its trade, in any order', () => {
	const a = { team: 9, give: ['x'], get: ['y', 'z'] };
	assert.ok(samePicks(a, { team: 9, give: ['x'], get: ['z', 'y'] }));
	assert.ok(!samePicks(a, { team: 8, give: ['x'], get: ['y', 'z'] }));
	assert.ok(!samePicks(a, { team: 9, give: ['x'], get: ['y'] }));
	assert.ok(!samePicks(a, { team: 9, give: ['x', 'w'], get: ['y', 'z'] }));
});

void test('each side draws a bar as a share of the longer gain, small gains short', () => {
	assert.deepEqual(gainBars(4, -2), { yours: 1, theirs: 0.5 });
	assert.deepEqual(gainBars(0.5, 0.25), { yours: 0.5 / BAR_FLOOR, theirs: 0.25 / BAR_FLOOR });
	assert.deepEqual(gainBars(null, null), { yours: 0, theirs: 0 });
});

void test('Share copies the trade in our words, and only a trade both rosters can make is shared', () => {
	assert.equal(
		shareText({ name: 'Muttdogs' }, check({ drop: line('Jaxson Dart', 'QB') })),
		'Trade with Muttdogs: Kyren Williams (RB TB) for Nico Collins (WR TB). Your lineup gains 2.1 points over replacement a week, theirs loses 0.8. You drop Jaxson Dart to make room.'
	);
	assert.ok(fillsBoth(check()));
	assert.ok(!fillsBoth(check({}, { yours: false, yours_open: 'RB2' })));
	assert.ok(!fillsBoth(check({}, { theirs_room: false })));
});

void test('copy guard: the builder says no trading words, dashes or semicolons', () => {
	const said = [
		...Object.values(BUILDER_LINES),
		...Object.values(ANALYZER_LINES),
		shareText({ name: 'Muttdogs' }, check()),
		...presetsFrom([team(4, 'Muttdogs', [row()])]).flatMap((p) => [p.deal, p.gains]),
		checkWords(check()),
		checkWords(check({ my_gain: 1, their_gain: 1, close_for_them: false })),
		checkWords(check({}, { yours: false, yours_open: 'Flex' }))
	];
	for (const text of said) {
		assert.doesNotMatch(text, bannedPattern(/\b(value|win|wins|lose a trade|fair|grade)\b/), text);
	}
});
