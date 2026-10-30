// The Waivers screen's position cards as its navigation (Lane 305): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import type { components } from '#lib/api/types.ts';
import type { PlayerLine, WaiverAdvice, WaiverRow, WeekFacts } from '../inseason/api.ts';
import {
	ALL,
	atPosition,
	NAV,
	navCards,
	navCounts,
	navLead,
	navSort,
	navStanding,
	openingKey,
	yoursRows
} from './position-nav.ts';
import { DEFAULT_SORT } from './waivers.ts';

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
	rest_of_season_per_game: 6.1,
	week_projection: proj,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts
});

const otton = line('Cade Otton', 'TE', 7.4);
const kittle = line('George Kittle', 'TE', 9.1);
const row = (add: PlayerLine): WaiverRow => ({
	add,
	drop: otton,
	gain: 1,
	week_gain: 1,
	starts: true,
	pickup: false,
	beats: null,
	drops: [],
	clears: null,
	sentence: ''
});
const taylor = row(line('Mason Taylor', 'TE', 4.8));
const jones = row(line('Daniel Jones', 'QB', 15.2));

const card = (over: Partial<Card> & Pick<Card, 'position'>): Card => ({
	teams: 12,
	need: false,
	rest_of_season: { rank: 6, points: 200, median: 200 },
	week: { rank: 6, points: 10, median: 10 },
	mine: [],
	available: [],
	...over
});

const te = card({
	position: 'TE',
	need: true,
	rest_of_season: { rank: 9, points: 141, median: 155.6 },
	week: { rank: 12, points: 7.8, median: 11.4 },
	mine: [
		// Kittle is the bench on the season, the starter this week: the toggle reorders them.
		{ line: kittle, starter: false, starts_this_week: true, rest_of_season_points: 98.5 },
		{ line: otton, starter: true, starts_this_week: false, rest_of_season_points: 101.2 }
	]
});
const qb = card({
	position: 'QB',
	need: true,
	rest_of_season: { rank: 8, points: 248.2, median: 264 }
});
const def = card({
	position: 'DEF',
	rest_of_season: null,
	week: { rank: 3, points: 7.9, median: 6.2 }
});
const k = card({ position: 'K', rest_of_season: null, week: null });

const advice = {
	positions: [qb, te, def, k],
	pickups: [taylor],
	rows: [jones, taylor],
	stash: []
} satisfies Pick<WaiverAdvice, 'positions' | 'pickups' | 'rows' | 'stash'>;
const counts = navCounts([{ gains: true }, { gains: false }]);

void test('the screen opens on the Need with the weakest rank, All where none', () => {
	assert.equal(openingKey(advice), 'TE');
	assert.equal(openingKey({ positions: [qb, card({ position: 'TE', need: true })] }), 'QB');
	assert.equal(openingKey({ positions: [card({ position: 'WR' })] }), ALL);
	assert.equal(openingKey({}), ALL);
});

void test('All leads the row with its counts, then a card a position with rank, figure and Need', () => {
	const cards = navCards(advice, 'season', counts, new Map());
	assert.deepEqual(
		cards.map((c) => c.key),
		['ALL', 'QB', 'TE', 'DEF', 'K']
	);
	const [all, , tight] = cards;
	assert.ok(all && tight);
	assert.equal(all.place, '2 free agents');
	assert.equal(all.figure, '1');
	assert.equal(tight.word, 'TE');
	assert.equal(tight.place, 'rank 9 of 12');
	assert.equal(tight.figure, '141.0');
	assert.equal(tight.foot, '155.6 median');
	assert.equal(tight.need, true);
	assert.equal(tight.pickup, true);
	assert.deepEqual(tight.meter, { share: 141 / 155.6 / 2, under: true });
});

void test('K and D/ST never read "--" on Rest of season: this week, said so, or what they wait on', () => {
	const cards = navCards(advice, 'season', counts, new Map());
	const dst = cards.find((c) => c.key === 'DEF');
	assert.ok(dst);
	assert.equal(dst.word, 'D/ST');
	assert.equal(dst.place, 'rank 3 of 12');
	assert.equal(dst.figure, '7.9');
	assert.equal(dst.tag, NAV.weekTag);
	assert.equal(dst.need, false);
	const kicker = cards.find((c) => c.key === 'K');
	assert.ok(kicker);
	assert.equal(kicker.waits, NAV.waits);
	assert.deepEqual(navStanding(def, 'week'), { standing: def.week, swapped: false });
	assert.equal(navLead(advice, 'DEF', 'season').words.includes(NAV.swapped('D/ST')), true);
});

void test('This week reads every card on the week and marks no Need', () => {
	const tight = navCards(advice, 'week', counts, new Map()).find((c) => c.key === 'TE');
	assert.ok(tight);
	assert.equal(tight.place, 'rank 12 of 12');
	assert.equal(tight.figure, '7.8');
	assert.equal(tight.need, false);
	assert.deepEqual(navSort('week'), { key: 'proj', down: true });
	assert.deepEqual(navSort('season'), DEFAULT_SORT);
});

void test("the member's players at a position: starters first in the toggle's lineup", () => {
	const season = yoursRows(advice, 'TE', 'season', ZONE, NOW);
	assert.deepEqual(
		season.map((r) => [r.row.name, r.role]),
		[
			['Cade Otton', 'Starter'],
			['George Kittle', 'Bench']
		]
	);
	const week = yoursRows(advice, 'TE', 'week', ZONE, NOW);
	assert.deepEqual(
		week.map((r) => [r.row.name, r.role]),
		[
			['George Kittle', 'Starter'],
			['Cade Otton', 'Bench']
		]
	);
	assert.equal(season[0]?.rest, 6.1);
	assert.deepEqual(yoursRows(advice, ALL, 'season', ZONE, NOW), []);
});

void test('a position keeps its own free agents until its read lands', () => {
	assert.deepEqual(
		atPosition(advice, 'TE').rows.map((r) => r.add.player.name),
		['Mason Taylor']
	);
	assert.equal(atPosition(advice, ALL), advice);
});

void test('an answer without the panel still navigates by its rows', () => {
	const cards = navCards({ pickups: [taylor] }, 'season', counts, new Map([['TE', counts]]));
	assert.deepEqual(
		cards.map((c) => [c.key, c.place, c.pickup]),
		[
			['ALL', '2 free agents', false],
			['TE', '2 free agents', true]
		]
	);
	assert.deepEqual(navLead({}, ALL, 'season'), { head: NAV.allHead, words: NAV.allSays });
});

void test('the lead says the rank and the Need in words the guard passes', () => {
	const lead = navLead(advice, 'TE', 'season');
	assert.equal(lead.head, 'TE rank 9 of 12');
	assert.match(lead.words, /^141\.0 against a 155\.6 median\. Rank is your starters'/);
	const words = [
		lead.words,
		NAV.all,
		NAV.freeAgents,
		NAV.beat,
		NAV.every,
		NAV.pickup,
		NAV.weekTag,
		NAV.waits,
		NAV.allHead,
		NAV.allSays,
		NAV.yours('TE'),
		NAV.freeAt('TE'),
		NAV.swapped('K')
	];
	for (const w of words) assert.doesNotMatch(w, bannedPattern());
});
