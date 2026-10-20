// The order's week column (Lane 92, B36, B50): Pts once a game is final, Proj before, keyed once in the
// basis. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayerLine, WeekFacts } from '../league/inseason/api.ts';
import { weekColumnPart, weekFigure } from './order.ts';

/** Monday night of week 6, Central: Sunday's 1:00 pm games are final, Monday's still to come. */
const MONDAY_NIGHT = Date.parse('2026-10-20T00:30:00.000Z');

const facts = (over: Partial<WeekFacts>): WeekFacts => ({
	week: 6,
	opponent: 'LAC',
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
	weather: null,
	...over
});

const line = (over: Partial<WeekFacts>, proj: number | null = 21.2): PlayerLine => ({
	player: {
		host_id: 'h',
		board_id: 'b',
		name: 'Kenneth Walker III',
		position: 'RB',
		team: 'KC',
		injured_reserve: false
	},
	headshot: null,
	slug: null,
	position_rank: 3,
	points_over_replacement: null,
	rest_of_season_per_game: 19.6,
	week_projection: proj,
	projection_delta: null,
	opp_rank: 19,
	season_avg: 27.5,
	last_points: 30.9,
	held: false,
	facts: facts(over)
});

void test('a final game shows his Pts, the platform’s first, else our stats once they land', () => {
	const final = { game_state: 'final' as const, played: true };
	assert.equal(weekFigure(line({ ...final, points_this_week: 27.9 }), MONDAY_NIGHT), 27.9);
	assert.equal(
		weekFigure(line({ ...final, last_games: [{ week: 6, points: 26.4 }] }), MONDAY_NIGHT),
		26.4
	);
	// Final with no points held yet: never his Proj beside a played game.
	assert.equal(
		weekFigure(line({ ...final, last_games: [{ week: 5, points: 30.9 }] }), MONDAY_NIGHT),
		null
	);
});

void test('before the final the week column is his Proj, in play or still to come', () => {
	assert.equal(weekFigure(line({ game_state: 'kicked_off' }), MONDAY_NIGHT), 21.2);
	const monday = { kickoff: '2026-10-20T00:15:00.000Z', game_state: 'kicked_off' as const };
	assert.equal(weekFigure(line(monday, 15.0), MONDAY_NIGHT), 15);
	const thursday = { kickoff: '2026-10-23T00:15:00.000Z', game_state: 'upcoming' as const };
	assert.equal(weekFigure(line(thursday, 18.4), MONDAY_NIGHT), 18.4);
	assert.equal(
		weekFigure(line({ bye: true, opponent: null, kickoff: null }, null), MONDAY_NIGHT),
		null
	);
});

void test('the week column is keyed once by its week, never called Proj', () => {
	assert.equal(weekColumnPart(6), 'Wk 6 is Pts once final, Proj before.');
});
