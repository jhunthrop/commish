// The Rest of season and Players screens' words and rows (Lane 66j and its fix round 1): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIXTURE_WEEK_CLOCK } from '../../../scripts/inseason-fixture/clock.ts';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { PlayerLine, WeekFacts } from '../league/inseason/api.ts';
import type { OrderAdvice, OrderRow } from './api.ts';
import { orderPath } from './path.ts';
import { basisText, KICKED_OFF_PART } from '#lib/league/box/basis.ts';
import { BOX } from '#lib/league/box/box.ts';
import {
	FIGURE_HEADS,
	ORDER,
	figureColumns,
	sortedFigure,
	moveHref,
	moveWords,
	orderBasis,
	orderView,
	stripCells,
	rosterBasis,
	rosterFilter,
	rosterWords
} from './order.ts';

const ZONE = 'America/Chicago';
const READ = '2026-10-17T02:00:00.000Z';
/** The fixture week's clock, Saturday noon Central: every Sunday game is still to be played. */
const NOW = Date.parse(FIXTURE_WEEK_CLOCK);

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
	overall_rank: 4,
	rest_of_season_points: 156.2,
	points_over_replacement: 41.3,
	roster: null,
	move: null,
	...over
});

void test('a free agent on IR with no move says why in the verb cell, his week not his (Lane 128)', () => {
	const ir = { status: 'injured_reserve', as_of: READ } as const;
	const listed = line('Achane', 'RB', { facts: { ...facts, designation: ir } });
	const free = { kind: 'free', team: null } as const;
	const undated = orderView(
		row('Achane', { line: listed, roster: free, move: null }),
		ZONE,
		true,
		NOW
	);
	assert.equal(undated.held, 'On IR, no return date');
	assert.equal(undated.week, null, 'no week figure for a player on a list');
	assert.equal(undated.box.proj, null);
	// Due back (the API keeps his add): the verb, no words.
	const dated = orderView(
		row('Achane', { line: listed, roster: free, move: 'add' }),
		ZONE,
		true,
		NOW
	);
	assert.equal(dated.held, null);
	// A free agent on no list, and a rostered player on one, carry none either.
	assert.equal(orderView(row('Hall', { roster: free, move: 'add' }), ZONE, true, NOW).held, null);
	const yours = { kind: 'yours', team: null } as const;
	assert.equal(orderView(row('Dart', { line: listed, roster: yours }), ZONE, true, NOW).held, null);
	assert.doesNotMatch(undated.held, bannedPattern());
	// The # cell reads the list's short form for him, his place for anyone else (fix round 1).
	assert.equal(undated.place, 'IR');
	assert.equal(orderView(row('Hall', { roster: free, move: 'add' }), ZONE, true, NOW).place, '4');
});

void test('every case the API holds an add back says why in the verb cell (Lane 128 fix round 1)', () => {
	const free = { kind: 'free', team: null } as const;
	const said = (designation: PlayerLine['facts']['designation']): string | null =>
		orderView(
			row('X', { line: line('X', 'RB', { facts: { ...facts, designation } }), roster: free }),
			ZONE,
			true,
			NOW
		).held;
	// A week's out with no return week: no list, his status and no return date.
	assert.equal(said({ status: 'out', as_of: READ }), 'Out, no return date');
	// Suspended: his list.
	assert.equal(said({ status: 'suspended', as_of: READ }), 'On Susp, no return date');
	// On IR due back after the regular season (the API withholds the add): never "no return date".
	assert.equal(
		said({ status: 'injured_reserve', as_of: READ, return_week: 16 }),
		'On IR, back after the regular season'
	);
	// A week's questionable plays: no words.
	assert.equal(said({ status: 'questionable', as_of: READ }), null);
});

const advice = (rows: OrderRow[], over: Partial<OrderAdvice> = {}): OrderAdvice => ({
	week: 6,
	basis: 'Our rest-of-season order from week 7.',
	basis_note: '',
	order_basis: 'rest_of_season',
	refreshed: READ,
	from_week: 7,
	read_at: null,
	projection_read_at: READ,
	projection_scoring: { format: 'ppr', league_own: false },
	rank_by: 'rest_of_season_points',
	moves: null,
	total: rows.length,
	rows,
	...over
});

const screenHref = (screen: 'waivers' | 'trades', league: string): string =>
	`/league/${league}/${screen}`;

void test("a Thursday game the API's facts count as played reads Final with its points as Last (the sweep's X3)", () => {
	// SEA at DEN, Thursday of week 6, as the API answers once its lines are in (playedFromLines).
	const thursday: WeekFacts = {
		...facts,
		opponent: 'DEN',
		kickoff: '2026-10-16T00:15:00.000Z',
		played: true,
		last_games: [
			{ week: 6, points: 25.4 },
			{ week: 5, points: 22.8 }
		]
	};
	const view = orderView(
		row('Smith-Njigba', {
			line: line('Smith-Njigba', 'WR', { facts: thursday, season_avg: 27.5, last_points: 25.4 })
		}),
		ZONE,
		true,
		NOW
	);
	assert.deepEqual(view.box.game, { where: 'at DEN', when: 'Final' });
	assert.equal(view.box.evidence.avg, 27.5);
	assert.equal(view.box.evidence.last, 25.4);
});

void test('a row prints the API figures as they come', () => {
	const view = orderView(row('Swift'), ZONE, true, NOW);
	assert.equal(view.key, 'b-Swift');
	assert.equal(view.box.key, 'b-Swift');
	assert.equal(view.place, '4');
	assert.deepEqual(view.figures, { por: 41.3, total: 156.2, perGame: 14.2 });
	assert.equal(view.box.proj, 16.4);
	assert.equal(view.roster, null);
});

void test('a free agent on the Players list reads FA in the club cell and No club in the game cell (Lane 123)', () => {
	// The API's answer for a player the daily list names with no club: "FA", no game, no bye, no Proj.
	const noGame: WeekFacts = { ...facts, opponent: null, home: null, kickoff: null };
	const freeAgent = line('Sharpe', 'WR', {
		player: {
			host_id: '',
			board_id: 'b-Sharpe',
			name: 'Sharpe',
			position: 'WR',
			team: 'FA',
			injured_reserve: false
		},
		facts: noGame,
		week_projection: null,
		opp_rank: null,
		rest_of_season_per_game: null
	});
	const view = orderView(row('Sharpe', { line: freeAgent }), ZONE, true, NOW);
	assert.equal(view.box.club, 'FA');
	assert.equal(view.box.game, 'no-club');
	assert.equal(BOX.noClub, 'No club');
	assert.equal(view.box.proj, null);
	assert.equal(view.box.expected, null);
	// Every other row keeps its club and its game.
	const swift = orderView(row('Swift'), ZONE, true, NOW);
	assert.equal(swift.box.club, 'CHI');
	// A kickoff still to come says its zone (Lane 139, C11).
	assert.deepEqual(swift.box.game, { where: 'at ATL', when: 'Sun 12:00 pm CT' });
});

void test('the Game cell labels its expected score with both clubs, never a final (Lane 139, C07)', () => {
	const total = { points: 49.5, team_points: 26.5, read_at: READ };
	const withTotal = line('Swift', 'RB', { facts: { ...facts, game_total: total } });
	const view = orderView(row('Swift', { line: withTotal }), ZONE, true, NOW);
	assert.equal(view.box.expected, 'Expected score CHI 26.5, ATL 23');
	// Once his game kicks off the cell draws no expected score, as every box score's.
	const kicked = Date.parse(facts.kickoff ?? '');
	const after = orderView(row('Swift', { line: withTotal }), ZONE, true, kicked);
	assert.equal(after.box.expected, null);
	assert.equal(typeof after.box.game === 'object' ? after.box.game?.when : null, BOX.kickedOff);
});

void test('the big figure is his projected points, the sort key beside it (Lane 139, C20)', () => {
	assert.deepEqual(figureColumns('points_over_replacement'), ['total', 'por', 'perGame']);
	assert.deepEqual(figureColumns('rest_of_season_points'), ['total', 'perGame']);
	// The head of the column # sorts on is marked (fix round 1, MEDIUM-3).
	assert.equal(sortedFigure('points_over_replacement'), 'por');
	assert.equal(sortedFigure('rest_of_season_points'), 'total');
	assert.equal(FIGURE_HEADS.por, 'Over repl.');
	assert.equal(FIGURE_HEADS.total, 'Projected');
});

void test('below a wide screen the figures are labelled cells, never a sentence (Lane 209)', () => {
	const view = orderView(row('Swift'), ZONE, true, NOW);
	const heads = (rankBy: OrderAdvice['rank_by']): string[] =>
		stripCells(view, rankBy, 6).map((c) => c.head);
	// Across positions: the week, Over repl. (the key # sorts on), A game, Opp rank, Last.
	assert.deepEqual(heads('points_over_replacement'), [
		'Wk 6',
		'Over repl.',
		'A game',
		'Opp rank',
		'Last'
	]);
	// At one position Projected is the key, drawn big; Avg takes Over repl.'s place.
	assert.deepEqual(heads('rest_of_season_points'), ['Wk 6', 'A game', 'Opp rank', 'Avg', 'Last']);
	const cells = stripCells(view, 'points_over_replacement', 6);
	assert.deepEqual(
		cells.filter((c) => c.key === true).map((c) => c.head),
		['Over repl.']
	);
	// The week's short figure takes a narrower share, so the longer heads keep their room.
	assert.deepEqual(
		cells.filter((c) => c.narrow === true).map((c) => c.head),
		['Wk 6']
	);
	for (const cell of cells) assert.doesNotMatch(cell.value, /,/u, cell.value);
});

void test('a roster mark reads Yours, Free or the holding team, never the platform word', () => {
	assert.equal(rosterWords({ kind: 'yours', team: null }), ORDER.yours);
	assert.equal(rosterWords({ kind: 'free', team: null }), ORDER.free);
	assert.equal(rosterWords({ kind: 'team', team: 'Muttdogs' }), 'Muttdogs');
	assert.equal(rosterFilter('everyone'), null);
	assert.equal(rosterFilter('free'), 'free');
});

void test('a verb lands on him through the link the player card builds (review 66j H6, N2)', () => {
	const add = orderView(row('B', { move: 'add' }), ZONE, true, NOW);
	const trade = orderView(row('C', { move: 'trade' }), ZONE, true, NOW);
	// Waivers reads him by name and narrows to his position, as from the player card.
	assert.equal(moveHref(add, 'L1', screenHref), '/league/L1/waivers?player=b-B&position=RB');
	assert.equal(moveHref(trade, 'L1', screenHref), '/league/L1/trades?player=b-C');
	assert.equal(moveHref(trade, null, screenHref), null);
	assert.equal(moveHref(orderView(row('D'), ZONE, true, NOW), 'L1', screenHref), null);
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
		ZONE,
		true,
		NOW
	);
	const unnamed = orderView(row('E', { move: 'add' }), ZONE, true, NOW);
	const trade = orderView(row('C', { move: 'trade' }), ZONE, true, NOW);
	assert.equal(moveWords(named, closed, 'sleeper'), 'Open Sleeper waivers');
	assert.equal(moveWords(named, open, 'espn'), 'Add on ESPN');
	// No ESPN id for him: Waivers keeps the platform's page, and so does the order.
	assert.equal(moveWords(unnamed, open, 'espn'), 'Open ESPN waivers');
	assert.equal(moveWords(named, null, 'espn'), 'Open ESPN waivers');
	assert.equal(moveWords(trade, open, 'espn'), 'Trade for him');
});

void test('the basis says each column once: the order, Wk 6, Opp rank, the rules our stats lack, then Game and Roster at a desk (Lane 66t)', () => {
	const LEAGUE = { host: 'sleeper' as const };
	const signedOut = basisText(orderBasis(advice([row('A')], { basis_note: '' }), null, ZONE, NOW));
	assert.ok(signedOut.startsWith('Our rest-of-season order from week 7.'));
	// The week column is headed by the API's week and keyed once as Pts once final, Proj before (Lane
	// 92, B36, B50); the Proj it shows before then is the week's published projection.
	assert.match(
		signedOut,
		/Wk 6 is Pts once final, -- until his stats land, Proj before\. Proj is this week's published projection in PPR, read Fri 9:00 pm Central\./
	);
	assert.doesNotMatch(signedOut, /your rules|Roster is|leave out/);
	const parts = orderBasis(
		advice([row('A')], {
			read_at: READ,
			basis_note: 'Our stats omit two-point, missed kick, fumble recovery and safety.'
		}),
		LEAGUE,
		ZONE,
		NOW
	);
	const inLeague = basisText(parts);
	assert.match(inLeague, /, PPR nearest your rules, read /);
	assert.match(inLeague, /Opp rank is points allowed to his position, 1st fewest\./);
	assert.ok(
		inLeague.includes('Our stats omit two-point, missed kick, fumble recovery and safety.'),
		inLeague
	);
	assert.match(inLeague, /Roster is Sleeper's, read /);
	// The rules are named inline, with no link to follow (Lane 111, B33).
	assert.equal(
		parts.find((p) => p.href !== undefined),
		undefined
	);
	const phone = parts.filter((p) => p.phone).map((p) => p.text);
	assert.ok(phone.every((t) => !t.startsWith('Roster is') && !t.startsWith('Game ')));
	assert.ok(parts.some((p) => !p.phone && p.text.startsWith('Roster is')));
	assert.match(rosterBasis('espn', READ, ZONE), /^Roster is ESPN's, read /);
	for (const said of [inLeague, ...Object.values(ORDER), ...Object.values(FIGURE_HEADS)]) {
		assert.doesNotMatch(said, bannedPattern(), said);
	}
});

void test("the Monday after Sunday's games: Kicked off in the Game cell, and the basis says when Final lands (Lane 80)", () => {
	const monday = Date.parse('2026-10-19T11:00:00.000Z');
	const kicked = row('A', {
		line: line('A', 'RB', { facts: { ...facts, game_state: 'kicked_off' } })
	});
	const view = orderView(kicked, ZONE, true, monday);
	assert.deepEqual(view.box.game, { where: 'at ATL', when: 'Kicked off' });
	const said = orderBasis(advice([kicked]), null, ZONE, monday);
	const part = said.find((p) => p.text === KICKED_OFF_PART);
	assert.ok(part, basisText(said));
	assert.equal(part.phone, true);
	// Before kickoff, or with every game final, the sentence is not said.
	const before = row('B', {
		line: line('B', 'RB', { facts: { ...facts, game_state: 'upcoming' } })
	});
	const kickoff = Date.parse(facts.kickoff ?? '');
	assert.ok(
		!basisText(orderBasis(advice([before]), null, ZONE, kickoff - 1)).includes(KICKED_OFF_PART)
	);
	// A lagging read (the API still upcoming, the clock past kickoff) reads kicked off (H-A): its Game
	// cell and its sentence.
	assert.deepEqual(orderView(before, ZONE, true, monday).box.game, {
		where: 'at ATL',
		when: 'Kicked off'
	});
	assert.ok(basisText(orderBasis(advice([before]), null, ZONE, monday)).includes(KICKED_OFF_PART));
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
