// The Rest of season and Players screens' words and rows (Lane 66j and its fix round 1): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { PlayerLine, WeekFacts } from '../league/inseason/api.ts';
import type { OrderAdvice, OrderRow } from './api.ts';
import { orderPath } from './path.ts';
import {
	FIGURE_HEADS,
	ORDER,
	evidenceBasis,
	figureColumns,
	moveHref,
	moveWords,
	orderBasis,
	orderView,
	rosterBasis,
	rosterFilter,
	rosterWords
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
	points_over_replacement: 41.3,
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
	rank_by: 'rest_of_season_points',
	moves: null,
	total: rows.length,
	rows,
	...over
});

const screenHref = (screen: 'waivers' | 'trades', league: string): string =>
	`/league/${league}/${screen}`;

void test('a row prints the API figures as they come', () => {
	const view = orderView(row('Swift'), ZONE);
	assert.equal(view.key, 'b-Swift');
	assert.equal(view.box.key, 'b-Swift');
	assert.equal(view.rank, 4);
	assert.deepEqual(view.figures, { por: 41.3, total: 156.2, perGame: 14.2 });
	assert.equal(view.box.proj, 16.4);
	assert.equal(view.roster, null);
});

void test('the big figure is the key the rank sorts on (review 66j H2)', () => {
	assert.deepEqual(figureColumns('points_over_replacement'), ['por', 'total', 'perGame']);
	assert.deepEqual(figureColumns('rest_of_season_points'), ['total', 'perGame']);
	assert.equal(FIGURE_HEADS.por, 'Over repl.');
	assert.equal(FIGURE_HEADS.total, 'Points');
});

void test('a roster mark reads Yours, Free or the holding team, never the platform word', () => {
	assert.equal(rosterWords({ kind: 'yours', team: null }), ORDER.yours);
	assert.equal(rosterWords({ kind: 'free', team: null }), ORDER.free);
	assert.equal(rosterWords({ kind: 'team', team: 'Muttdogs' }), 'Muttdogs');
	assert.equal(rosterFilter('everyone'), null);
	assert.equal(rosterFilter('free'), 'free');
});

void test('a verb lands on him through the link the player card builds (review 66j H6, N2)', () => {
	const add = orderView(row('B', { move: 'add' }), ZONE);
	const trade = orderView(row('C', { move: 'trade' }), ZONE);
	// Waivers reads him by name and narrows to his position, as from the player card.
	assert.equal(moveHref(add, 'L1', screenHref), '/league/L1/waivers?player=b-B&position=RB');
	assert.equal(moveHref(trade, 'L1', screenHref), '/league/L1/trades?player=b-C');
	assert.equal(moveHref(trade, null, screenHref), null);
	assert.equal(moveHref(orderView(row('D'), ZONE), 'L1', screenHref), null);
});

void test("the add verb is the Waivers screen's own rule: claims open and the platform names him (review 66j N3)", () => {
	const closed = {
		claim: 'unavailable' as const,
		note: null,
		takes_writes: false,
		writes_on: false,
		reason: 'x'
	};
	const open = { ...closed, claim: 'available' as const };
	const base = line('B', 'RB');
	const named = orderView(
		row('B', { move: 'add', line: { ...base, player: { ...base.player, host_id: '4262921' } } }),
		ZONE
	);
	const unnamed = orderView(row('E', { move: 'add' }), ZONE);
	const trade = orderView(row('C', { move: 'trade' }), ZONE);
	assert.equal(moveWords(named, closed, 'sleeper'), 'Open Sleeper waivers');
	assert.equal(moveWords(named, open, 'espn'), 'Add on ESPN');
	// No ESPN id for him: Waivers keeps the platform's page, and so does the order.
	assert.equal(moveWords(unnamed, open, 'espn'), 'Open ESPN waivers');
	assert.equal(moveWords(named, null, 'espn'), 'Open ESPN waivers');
	assert.equal(moveWords(trade, open, 'espn'), 'Trade for him');
});

void test('the basis names the league shape and says every number once, the platform named', () => {
	const signedOut = orderBasis(advice([row('A')]), null, ZONE);
	assert.ok(signedOut.startsWith('Our rest-of-season order from week 7.'));
	assert.match(signedOut, /Points over replacement are for a 12-team league/);
	assert.match(signedOut, /Proj is this week's published projection in PPR/);
	assert.doesNotMatch(signedOut, /Roster is/);
	const inLeague = orderBasis(advice([row('A')], { read_at: READ }), { host: 'sleeper' }, ZONE);
	assert.match(inLeague, /Roster is Sleeper's, read /);
	assert.match(evidenceBasis(true), /in this league's scoring\.$/);
	assert.match(rosterBasis('espn', READ, ZONE), /^Roster is ESPN's, read /);
	for (const said of [inLeague, ...Object.values(ORDER), ...Object.values(FIGURE_HEADS)]) {
		assert.doesNotMatch(said, bannedPattern(), said);
	}
});

void test('the path asks the league route with a league and the public one without', () => {
	assert.equal(
		orderPath(null, { position: 'RB', q: null, roster: null, limit: 100 }),
		'/order?limit=100&position=RB'
	);
	assert.equal(
		orderPath('7f', { position: null, q: ' hou ', roster: 'free', limit: 100 }),
		'/leagues/attached/7f/order?limit=100&q=hou&roster=free'
	);
	assert.equal(
		orderPath(null, { position: null, q: 'h', roster: 'free', limit: 50 }),
		'/order?limit=50'
	);
});
