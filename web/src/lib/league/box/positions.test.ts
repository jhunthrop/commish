// The Waivers screen's position panel (Lane 291): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { components } from '#lib/api/types.ts';
import type { PlayerLine, WaiverAdvice, WaiverRow, WeekFacts } from '../inseason/api.ts';
import {
	beatsWords,
	PANEL,
	panelCards,
	panelExplain,
	panelHasWeek,
	placeWords,
	rankWords
} from './positions.ts';
import { poolRows } from './waivers.ts';

type Card = components['schemas']['WaiverPositionCard'];

const ZONE = 'America/Chicago';
const NOW = Date.parse('2026-10-17T02:00:00.000Z');

const facts: WeekFacts = {
	week: 6,
	opponent: 'PIT',
	home: true,
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

const line = (name: string, position: string, proj: number | null): PlayerLine => ({
	player: { host_id: name, board_id: name, name, position, team: 'TB', injured_reserve: false },
	headshot: null,
	slug: null,
	position_rank: null,
	points_over_replacement: null,
	rest_of_season_per_game: null,
	week_projection: proj,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts
});

const kittle = line('George Kittle', 'TE', 9.1);
const otton = line('Cade Otton', 'TE', 7.4);

const row = (add: PlayerLine, gain: number, beats: WaiverRow['beats']): WaiverRow => ({
	add,
	drop: otton,
	gain,
	week_gain: 1,
	starts: true,
	pickup: false,
	beats,
	drops: [{ host_id: otton.player.host_id, gain, week_gain: 1, starts_this_week: true }],
	clears: null,
	sentence: ''
});

const taylor = row(line('Mason Taylor', 'TE', 4.8), 0.8, {
	host_id: otton.player.host_id,
	name: otton.player.name,
	starter: true,
	gain: 1,
	open_spot: false
});
const higbee = row(line('Tyler Higbee', 'TE', 6.2), -0.4, null);

const te: Card = {
	position: 'TE',
	teams: 12,
	need: true,
	rest_of_season: { rank: 12, points: 101.2, median: 140.6 },
	week: { rank: 9, points: 7.4, median: 9.0 },
	mine: [
		{ line: otton, starter: true, starts_this_week: true, rest_of_season_points: 101.2 },
		{ line: kittle, starter: false, starts_this_week: false, rest_of_season_points: 98.5 }
	],
	available: [
		{ row: taylor, rest_of_season_points: 120.4 },
		{ row: higbee, rest_of_season_points: 88 }
	]
};
const k: Card = {
	position: 'K',
	teams: 12,
	need: false,
	rest_of_season: null,
	week: null,
	mine: [],
	available: []
};

const advice: Pick<WaiverAdvice, 'positions' | 'pickups' | 'roster'> = {
	positions: [te, k],
	pickups: [],
	roster: [otton, kittle]
};

void test('a card says its rank out of the league, its figure against the median and its need', () => {
	const [card, kicker] = panelCards(advice, 'season', ZONE, NOW);
	assert.ok(card && kicker);
	assert.equal(card.rank, 'TE rank 12 of 12');
	assert.equal(card.place, 'rank 12 of 12');
	assert.equal(card.figure, '101.2');
	assert.equal(card.median, '140.6');
	assert.equal(card.need, true);
	// No figure read at a position: no rank to say, never a made-up one.
	assert.equal(kicker.rank, 'K --');
	assert.equal(kicker.figure, '--');
	assert.equal(kicker.standing, null);
	assert.equal(rankWords('D/ST', null, 12), 'D/ST --');
	assert.equal(placeWords({ rank: 2, points: 1, median: 1 }, 10), 'rank 2 of 10');
});

void test("a card opens on the member's players first, then the free agents, each by the figure", () => {
	const [card] = panelCards(advice, 'season', ZONE, NOW);
	assert.ok(card);
	assert.deepEqual(
		card.mine.map((e) => [e.name, e.mark, e.figure]),
		[
			['Otton', 'Starter', '101.2'],
			['Kittle', 'Bench', '98.5']
		]
	);
	assert.deepEqual(
		card.free.map((e) => [e.name, e.mark, e.figure]),
		[
			['Taylor', PANEL.free, '120.4'],
			['Higbee', PANEL.free, '88.0']
		]
	);
	assert.ok(card.mine.every((e) => e.pool === null && e.beats === null));
});

void test('This week reads the Proj, ranks and orders by it, and marks who starts this week', () => {
	const [card] = panelCards(advice, 'week', ZONE, NOW);
	assert.ok(card);
	assert.equal(card.rank, 'TE rank 9 of 12');
	assert.equal(card.figure, '7.4');
	assert.equal(card.median, '9.0');
	// The need is the rest of the season's: this week's figures draw none.
	assert.equal(card.need, false);
	assert.deepEqual(
		card.mine.map((e) => [e.name, e.figure]),
		[
			['Kittle', '9.1'],
			['Otton', '7.4']
		]
	);
	assert.deepEqual(
		card.free.map((e) => e.name),
		['Higbee', 'Taylor']
	);
	assert.equal(panelHasWeek(advice), true);
	assert.equal(panelHasWeek({ positions: [k] }), false);
});

void test("a free agent carries the table's own row: its Beats words and the verb's input", () => {
	const [card] = panelCards(advice, 'season', ZONE, NOW);
	assert.ok(card);
	const table = poolRows({ rows: [taylor, higbee], pickups: [], roster: advice.roster }, ZONE, NOW);
	const [first, second] = card.free;
	assert.ok(first?.pool && second?.pool);
	assert.equal(first.pool.source, taylor);
	assert.deepEqual(first.pool.beats, table[0]?.beats);
	assert.equal(first.beats, 'Otton, Starter, +0.8 Gain');
	// A row that gains nothing names no one, as the table's cell.
	assert.equal(second.beats, '\u22120.4');
	assert.ok(table[1] && beatsWords(table[1]) === second.beats);
});

void test("This week lists the week's own best free agents, not the rest-of-season five (review M1)", () => {
	const streamer = row(line('Jake Ferguson', 'TE', 11.3), 0.2, null);
	const withWeek: Card = {
		...te,
		available_week: [
			{ row: streamer, rest_of_season_points: 60 },
			{ row: higbee, rest_of_season_points: 88 }
		]
	};
	const [card] = panelCards({ ...advice, positions: [withWeek] }, 'week', ZONE, NOW);
	assert.deepEqual(
		card?.free.map((e) => [e.name, e.figure]),
		[
			['Ferguson', '11.3'],
			['Higbee', '6.2']
		]
	);
	// Rest of season keeps its own five.
	const [season] = panelCards({ ...advice, positions: [withWeek] }, 'season', ZONE, NOW);
	assert.deepEqual(
		season?.free.map((e) => e.name),
		['Taylor', 'Higbee']
	);
});

void test('a position with no week figure draws no rank and no median this week (review M4)', () => {
	const [, kicker] = panelCards(advice, 'week', ZONE, NOW);
	assert.ok(kicker);
	assert.equal(kicker.rank, 'K --');
	assert.equal(kicker.figure, '--');
	assert.equal(kicker.standing, null);
	assert.doesNotMatch(kicker.rank, /rank 1 of/);
});

void test('an answer without the panel draws none', () => {
	assert.deepEqual(panelCards({ pickups: [], roster: [] }, 'season', ZONE, NOW), []);
});

void test("the panel's words say what the rank is and pass the copy guard", () => {
	assert.equal(
		panelExplain('season', [{ need: false }]),
		"Rank is your starters' rest of season at the position against the league's."
	);
	assert.match(panelExplain('week', [{ need: true }]), /Proj this week.*Need marks/);
	const words = [
		...Object.values(PANEL).flatMap((v) => (typeof v === 'string' ? [v] : Object.values(v))),
		...panelCards(advice, 'season', ZONE, NOW).flatMap((c) => [c.rank, c.figure, c.median])
	];
	for (const w of words) assert.doesNotMatch(w, bannedPattern(), w);
});
