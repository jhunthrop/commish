// The trade builder's behaviour and words: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { PlayerLine, TradeCheck, TradeRow, TradeTeam } from './api.ts';
import {
	BUILDER_LINES,
	MAX_A_SIDE,
	builtFrom,
	checkInput,
	checkWords,
	pickPrompt,
	pickable,
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
	basis_note_link: '',
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

void test('copy guard: the builder says no trading words, dashes or semicolons', () => {
	const said = [
		...Object.values(BUILDER_LINES),
		checkWords(check()),
		checkWords(check({ my_gain: 1, their_gain: 1, close_for_them: false })),
		checkWords(check({}, { yours: false, yours_open: 'Flex' }))
	];
	for (const text of said) {
		assert.doesNotMatch(text, bannedPattern(/\b(value|win|wins|lose a trade|fair|grade)\b/), text);
	}
});
