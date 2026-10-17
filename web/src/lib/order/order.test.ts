// The Rest of season and Players screens' words and rows (Lane 66j): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayerLine, WeekFacts } from '../league/inseason/api.ts';
import type { OrderAdvice, OrderRow } from './api.ts';
import { orderPath } from './path.ts';
import {
	ORDER,
	evidenceBasis,
	moveHref,
	moveWords,
	orderBasis,
	orderView,
	rosterBasis,
	rosterWords,
	rowsFor
} from './order.ts';

const ZONE = 'America/Chicago';
const READ = '2026-10-17T02:00:00.000Z';

const facts: WeekFacts = {
	week: 6,
	opponent: 'ATL',
	home: false,
	kickoff: '2026-10-18T17:00:00.000Z',
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
};

const line = (name: string, position: string, over: Partial<PlayerLine> = {}): PlayerLine => ({
	player: {
		host_id: '',
		board_id: `b-${name}`,
		name,
		position,
		team: 'CHI',
		injured_reserve: false
	},
	headshot: null,
	slug: null,
	position_rank: 4,
	points_over_replacement: null,
	rest_of_season_per_game: 14.2,
	week_projection: 16.4,
	projection_delta: null,
	opp_rank: 9,
	season_avg: 15.1,
	last_points: 22.4,
	held: false,
	facts,
	...over
});

const row = (name: string, over: Partial<OrderRow> = {}): OrderRow => ({
	line: line(name, 'RB'),
	rank: 4,
	rest_of_season_points: 156.2,
	roster: null,
	move: null,
	...over
});

const advice = (rows: OrderRow[], over: Partial<OrderAdvice> = {}): OrderAdvice => ({
	week: 6,
	basis: 'Our rest-of-season order from week 7.',
	basis_note:
		'Points over replacement are for a 12-team league with 1 QB, 2 RB, 3 WR, 1 TE and a flex.',
	order_basis: 'rest_of_season',
	refreshed: READ,
	from_week: 7,
	read_at: null,
	projection_read_at: READ,
	projection_scoring: { format: 'ppr', league_own: true },
	total: rows.length,
	rows,
	...over
});

const screenHref = (screen: 'waivers' | 'trades', league: string): string =>
	`/league/${league}/${screen}`;

void test('a row prints the API figures as they come: the place, the total and a game', () => {
	const view = orderView(row('Swift'), ZONE);
	assert.equal(view.key, 'b-Swift');
	assert.equal(view.box.key, 'b-Swift');
	assert.equal(view.rank, 4);
	assert.equal(view.total, 156.2);
	assert.equal(view.perGame, 14.2);
	assert.equal(view.box.proj, 16.4);
	assert.equal(view.roster, null);
});

void test('a roster mark reads Yours, Free or the holding team, never the platform word', () => {
	assert.equal(rosterWords({ kind: 'yours', team: null }), ORDER.yours);
	assert.equal(rosterWords({ kind: 'free', team: null }), ORDER.free);
	assert.equal(rosterWords({ kind: 'team', team: 'Muttdogs' }), 'Muttdogs');
});

void test('the roster chips select the API rows, never a figure', () => {
	const views = [
		orderView(row('A', { roster: { kind: 'yours', team: null } }), ZONE),
		orderView(row('B', { roster: { kind: 'free', team: null }, move: 'add' }), ZONE),
		orderView(row('C', { roster: { kind: 'team', team: 'Muttdogs' }, move: 'trade' }), ZONE)
	];
	assert.deepEqual(
		rowsFor(views, 'free').map((v) => v.key),
		['b-B']
	);
	assert.deepEqual(
		rowsFor(views, 'yours').map((v) => v.key),
		['b-A']
	);
	assert.equal(rowsFor(views, 'everyone').length, 3);
});

void test('a verb goes to the league screen it names, with him or his position chosen', () => {
	const add = orderView(row('B', { move: 'add' }), ZONE);
	const trade = orderView(row('C', { move: 'trade' }), ZONE);
	const defense = orderView(
		row('Texans', { line: line('Texans', 'DEF'), move: 'add', rest_of_season_points: null }),
		ZONE
	);
	assert.equal(moveHref(add, 'L1', screenHref), '/league/L1/waivers?position=RB');
	assert.equal(moveHref(defense, 'L1', screenHref), '/league/L1/waivers?position=DEF');
	assert.equal(moveHref(trade, 'L1', screenHref), '/league/L1/trades?player=b-C');
	assert.equal(moveHref(trade, null, screenHref), null);
	assert.equal(moveHref(orderView(row('D'), ZONE), 'L1', screenHref), null);
	assert.equal(moveWords('add'), 'Add');
	assert.equal(moveWords('trade'), 'Trade for him');
});

void test('the basis says every number once in one paragraph, the platform named', () => {
	const signedOut = orderBasis(advice([row('A')]), null, ZONE);
	assert.ok(signedOut.startsWith('Our rest-of-season order from week 7.'));
	assert.match(signedOut, /Proj is this week's published projection in PPR/);
	assert.match(signedOut, /in PPR\.$/);
	assert.doesNotMatch(signedOut, /Roster is/);
	const inLeague = orderBasis(
		advice([row('A')], { read_at: READ, basis_note: 'Points so far leave out safeties.' }),
		{ host: 'sleeper' },
		ZONE
	);
	assert.match(inLeague, /Roster is Sleeper's, read /);
	assert.ok(inLeague.endsWith('Points so far leave out safeties.'));
	assert.match(evidenceBasis(true), /in this league's scoring\.$/);
	assert.match(rosterBasis('espn', READ, ZONE), /^Roster is ESPN's, read /);
	for (const said of [inLeague, ...Object.values(ORDER)]) {
		assert.doesNotMatch(
			said,
			/\bhost\b|\u2014|;|\b(odds|line|spread|bet|market|buy|sell|price)\b/i
		);
	}
});

void test('the path asks the league route with a league and the public one without', () => {
	assert.equal(
		orderPath(null, { position: 'RB', q: null, limit: 100 }),
		'/order?limit=100&position=RB'
	);
	assert.equal(
		orderPath('7f', { position: null, q: ' hou ', limit: 100 }),
		'/leagues/attached/7f/order?limit=100&q=hou'
	);
	assert.equal(orderPath(null, { position: null, q: 'h', limit: 50 }), '/order?limit=50');
});
