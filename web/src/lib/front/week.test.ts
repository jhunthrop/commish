// The front door's week (Lane 66k): the lead league's bug, strip and chips, the other leagues, and
// the basis, each word from the API's answer alone. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { components } from '#lib/api/types.ts';
import {
	FRONT,
	chipsOf,
	frontLeague,
	leadOf,
	nudgeOf,
	readWords,
	weekBasis,
	type ScreenHref,
	type WeekLeague
} from './week.ts';

type Schemas = components['schemas'];
const ZONE = 'America/Chicago';
const NOW = new Date('2026-10-17T15:12:00.000Z');
const href: ScreenHref = (screen, id) => `/league/${id}/${screen}`;

const facts = (over: Partial<Schemas['WeekFacts']> = {}): Schemas['WeekFacts'] => ({
	week: 6,
	opponent: 'HOU',
	home: true,
	kickoff: '2026-10-18T13:30:00.000Z',
	bye: false,
	designation: null,
	played: false,
	points_this_week: null,
	last_games: [],
	allowed_to_position: null,
	game_total: null,
	spread: null,
	roof: null,
	weather: null,
	...over
});

const line = (
	name: string,
	position: string,
	team: string,
	over: Partial<Schemas['WeekFacts']> = {}
): Schemas['PlayerLine'] => ({
	player: { host_id: name, board_id: name, name, position, team, injured_reserve: false },
	headshot: null,
	slug: null,
	position_rank: 7,
	points_over_replacement: null,
	rest_of_season_per_game: null,
	week_projection: 9.65,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: facts(over)
});

const player = (name: string, position: string): Schemas['LeaguePlayer'] => ({
	host_id: name,
	board_id: null,
	name,
	position,
	team: 'NYG',
	injured_reserve: false
});

const team = (roster: number, name: string, wins: number): Schemas['LeagueTeam'] => ({
	roster_id: roster,
	name,
	owner: '',
	wins,
	losses: 5 - wins,
	ties: 0,
	points_for: 600,
	points_against: null,
	streak: null,
	waiver_order: null,
	waiver_budget_left: null,
	avatar: null
});

const side = (roster: number, projection: number): Schemas['ScoreboardSide'] => ({
	roster_id: roster,
	points: 0,
	points_read: true,
	projection,
	starters: 10,
	played: 0
});

const BYE: Schemas['RosterChip'] = {
	kind: 'bye',
	line: line('Sam LaPorta', 'TE', 'DET', { bye: true, opponent: null }),
	gain: null,
	idle: true
};

const LINEUP: Schemas['WeekLineup'] = {
	changes: 3,
	projection: 101.6,
	as_set: 74.7,
	gain: 26.9,
	swaps: [
		{ slot: 'QB', in: player('Jaxson Dart', 'QB'), out: player('Aaron Rodgers', 'QB') },
		{ slot: 'FLEX', in: player('Travis Etienne', 'RB'), out: player("Ja'Marr Chase", 'WR') },
		{ slot: 'DEF', in: player('Houston Texans', 'DEF'), out: null }
	],
	moves: {
		lineup: 'unavailable',
		note: null,
		takes_writes: false,
		writes_on: false,
		reason: 'Sleeper does not take lineups from here, so copy the lineup there.'
	}
};

const SUCK: WeekLeague = {
	id: 'suck',
	name: 'S.U.C.K.',
	host: 'sleeper',
	team_name: 'McConkey Kong Country',
	standing: { wins: 1, losses: 4, ties: 0, place: 12, teams: 12 },
	phase: 'in_season',
	week: 6,
	read_at: '2026-10-17T15:08:00.000Z',
	projection_read_at: '2026-10-17T02:00:00.000Z',
	projection_scoring: { format: 'ppr', league_own: false },
	bug: {
		game: {
			state: 'upcoming',
			next_kickoff: '2026-10-18T13:30:00.000Z',
			sides: [side(1, 74.7), side(7, 98.4)]
		},
		teams: [team(1, 'McConkey Kong Country', 1), team(7, 'thatmattkelley', 1)],
		first: [line('Jakobi Meyers', 'WR', 'JAX')]
	},
	lineup: {
		changes: 3,
		projection: 101.6,
		as_set: 74.7,
		gain: 26.9,
		swaps: [
			{ slot: 'QB', in: player('Jaxson Dart', 'QB'), out: player('Aaron Rodgers', 'QB') },
			{ slot: 'FLEX', in: player('Travis Etienne', 'RB'), out: player("Ja'Marr Chase", 'WR') },
			{ slot: 'DEF', in: player('Houston Texans', 'DEF'), out: null }
		],
		moves: {
			lineup: 'unavailable',
			note: null,
			takes_writes: false,
			writes_on: false,
			reason: 'Sleeper does not take lineups from here, so copy the lineup there.'
		}
	},
	chips: [
		{
			kind: 'status',
			line: line('Rome Odunze', 'WR', 'CHI', {
				designation: { status: 'questionable', as_of: '2026-10-16T21:00:00.000Z' }
			}),
			gain: null,
			idle: false
		},
		{
			kind: 'bye',
			line: line('Sam LaPorta', 'TE', 'DET', { bye: true, opponent: null }),
			gain: null,
			idle: true
		},
		{ kind: 'pickup', line: line('Xavier Hutchinson', 'WR', 'HOU'), gain: 1.8, idle: false }
	],
	problem: null
};

void test('the lead league is the chosen one, else the first with a week', () => {
	const off: WeekLeague = { ...SUCK, id: 'off', week: 0, bug: null, lineup: null, chips: [] };
	assert.equal(leadOf([off, SUCK], 'off')?.id, 'off');
	assert.equal(leadOf([off, SUCK], null)?.id, 'suck');
	assert.equal(leadOf([off], 'gone')?.id, 'off');
	assert.equal(leadOf([], null), null);
});

void test('the bug is the API game with both teams, mine first, and who plays first', () => {
	const view = frontLeague(SUCK, href, NOW, ZONE);
	assert.equal(view.line, 'McConkey Kong Country, 1-4, 12th of 12');
	assert.equal(view.platform, 'Sleeper');
	assert.ok(view.bug);
	assert.equal(view.bug.head, 'Sun 8:30 am');
	assert.deepEqual(
		view.bug.sides.map((s) => [s.name, s.record, s.proj, s.pts, s.me]),
		[
			['McConkey Kong Country', '1-4', '74.7', '--', true],
			['thatmattkelley', '1-4', '98.4', '--', false]
		]
	);
	assert.equal(view.first?.words, 'Meyers plays first, vs HOU');
	assert.equal(view.matchupHref, '/league/suck/matchup');
});

void test('the strip words the API summary: count, figures and the swaps by short name', () => {
	const nudge = nudgeOf(SUCK, href);
	assert.ok(nudge);
	assert.equal(nudge.title, 'Three changes');
	assert.deepEqual(nudge.sum, {
		figure: '101.6',
		words: 'Proj with them, 74.7 as set',
		gain: '+26.9'
	});
	assert.deepEqual(
		nudge.swaps.map((s) => [s.slot, s.in, s.out]),
		[
			['QB', 'Dart', 'Rodgers'],
			['Flex', 'Etienne', 'Chase'],
			['D/ST', 'Texans', null]
		]
	);
	assert.equal(nudge.verb, FRONT.setYourLineup);
	assert.ok(nudge.solid);
	assert.equal(nudge.href, '/league/suck/start');
	assert.equal(nudge.asSet, 'As set on Sleeper');
	const set = nudgeOf({ ...SUCK, lineup: { ...LINEUP, changes: 0, swaps: [], gain: 0 } }, href);
	assert.ok(set);
	assert.equal(set.title, 'Your lineup is set');
	assert.equal(set.verb, FRONT.openLineup);
	assert.equal(set.solid, false);
	assert.equal(nudgeOf({ ...SUCK, lineup: null }, href), null);
});

void test('each chip names the fact and opens the screen that acts on it', () => {
	const chips = chipsOf(SUCK, href, ZONE);
	assert.deepEqual(
		chips.map((c) => [c.label, c.row.name, c.line, c.go, c.href]),
		[
			[
				'Questionable',
				'Rome Odunze',
				'WR, CHI, a starter. Listed Fri 4:00 pm',
				'Lineup',
				'/league/suck/start'
			],
			[
				'Bye',
				'Sam LaPorta',
				'TE, DET. No TE of yours plays this week',
				'Waivers',
				'/league/suck/waivers'
			],
			[
				'Top pickup',
				'Xavier Hutchinson',
				'WR, HOU. +1.8 Proj this week',
				'Waivers',
				'/league/suck/waivers'
			]
		]
	);
	const starterBye = chipsOf({ ...SUCK, chips: [{ ...BYE, idle: false }] }, href, ZONE);
	assert.deepEqual(
		starterBye.map((c) => [c.line, c.go]),
		[['TE, DET, a starter on bye', 'Lineup']]
	);
});

void test('a league with no week names its phase, one whose read failed keeps its sentence', () => {
	const off = frontLeague(
		{ ...SUCK, phase: 'offseason', week: 0, bug: null, lineup: null, chips: [] },
		href,
		NOW,
		ZONE
	);
	assert.equal(off.phase, 'Season over');
	assert.equal(off.bug, null);
	const failed = frontLeague(
		{
			...SUCK,
			week: 0,
			bug: null,
			lineup: null,
			chips: [],
			problem: 'ESPN is not answering right now.'
		},
		href,
		NOW,
		ZONE
	);
	assert.equal(failed.problem, 'ESPN is not answering right now.');
	assert.equal(failed.phase, null);
	assert.equal(failed.line, 'McConkey Kong Country, 1-4, 12th of 12');
});

void test('the basis says whose figures, what Proj is and when it was read, once', () => {
	assert.equal(readWords(SUCK, NOW), 'Read from Sleeper 4 minutes ago.');
	assert.equal(readWords({ ...SUCK, read_at: null }, NOW), null);
	const basis = weekBasis(SUCK, ZONE);
	assert.equal(basis.length, 2);
	assert.match(basis[0] ?? '', /^Record, place and Pts are Sleeper's\. /);
	assert.match(
		basis[1] ?? '',
		/PPR scoring, the closest to this league's rules, read Fri 9:00 pm Central\./
	);
	assert.equal(weekBasis({ ...SUCK, projection_scoring: null }, ZONE).length, 1);
});

void test('the copy guard: no em-dash, semicolon, platform word or betting word in any line', () => {
	const view = frontLeague(SUCK, href, NOW, ZONE);
	const said = [
		...Object.values(FRONT),
		...weekBasis(SUCK, ZONE),
		...view.chips.flatMap((c) => [c.label, c.line]),
		view.first?.words ?? '',
		view.nudge?.asSet ?? ''
	];
	for (const s of said) {
		assert.doesNotMatch(s, /[—;]|\bhosts?\b|\b(bet|odds|price|market|buy|sell)\b/i, s);
	}
});
