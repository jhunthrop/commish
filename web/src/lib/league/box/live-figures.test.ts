// The live score's figures (Lane 92, B22, B27): the Pts big from the first kickoff with the API's
// projected final small, the Proj big before it, one rule for the Matchup bug and every Team row, and
// the basis saying once what Proj final is and that a game past kickoff keeps its Proj. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MatchupSide } from '../api.ts';
import type { PlayerLine, WeekFacts } from '../inseason/api.ts';
import { AS_OF_KICKOFF, PROJ_FINAL_PART, basisText, boxBasisParts, projPart } from './basis.ts';
import { BOX } from './box.ts';
import { bugFigures, matchupStarted, sideBox } from './matchup.ts';

const ZONE = 'America/Chicago';
/** Monday night of week 6: Sunday's games final, the Monday game under way. */
const MONDAY_NIGHT = Date.parse('2026-10-20T00:40:00.000Z');
const SATURDAY = Date.parse('2026-10-17T17:00:00.000Z');

const facts = (over: Partial<WeekFacts> = {}): WeekFacts => ({
	week: 6,
	opponent: 'WSH',
	home: true,
	kickoff: '2026-10-20T00:15:00.000Z',
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

const line = (name: string, proj: number, over: Partial<WeekFacts> = {}): PlayerLine => ({
	player: {
		host_id: name,
		board_id: name,
		name,
		position: 'RB',
		team: 'SF',
		injured_reserve: false
	},
	headshot: null,
	slug: null,
	position_rank: null,
	points_over_replacement: null,
	rest_of_season_per_game: 12,
	week_projection: proj,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: facts(over)
});

const mccaffrey = line('Christian McCaffrey', 20.7, {
	game_state: 'kicked_off',
	points_this_week: 13.1
});
const walker = line('Kenneth Walker III', 21.2, {
	kickoff: '2026-10-18T17:00:00.000Z',
	opponent: 'LAC',
	game_state: 'final',
	played: true,
	points_this_week: 27.9
});

/** The same two on the Saturday before, both still to play. */
const ahead = [mccaffrey, walker].map((l) => ({
	...l,
	facts: { ...l.facts, game_state: 'upcoming' as const, played: false, points_this_week: null }
}));

const SIDE: MatchupSide = {
	roster_id: 2,
	points: 90.9,
	points_read: true,
	player_points: true,
	team_total: true,
	starters: []
};

void test('from the first kickoff the bug’s big figure is Pts, the projected final under it', () => {
	assert.deepEqual(bugFigures({ pts: 90.9, proj: 130.8, final: 98.5 }, true), {
		big: '90.9',
		bigLabel: BOX.pts,
		small: 'Proj final 98.5'
	});
	// A side none of whose starters has kicked off yet: its final is its Proj.
	assert.equal(bugFigures({ pts: null, proj: 96, final: null }, true).small, 'Proj final 96.0');
	// Before the first kickoff the Proj is the big figure, nothing under it.
	assert.deepEqual(bugFigures({ pts: null, proj: 96, final: null }, false), {
		big: '96.0',
		bigLabel: BOX.proj,
		small: ''
	});
});

void test('a game has started once any starter has kicked off, by the one rule', () => {
	assert.equal(matchupStarted([mccaffrey, walker], MONDAY_NIGHT), true);
	assert.equal(matchupStarted(ahead, SATURDAY), false);
	assert.equal(matchupStarted([], MONDAY_NIGHT), false);
});

void test('a side’s Team row takes the API’s projected final, its Proj in a started game', () => {
	const read = { hostTotal: 90.9, landed: true, week: 6, now: MONDAY_NIGHT, started: true };
	const starters = [
		{ slot: 'RB' as const, line: mccaffrey },
		{ slot: 'RB' as const, line: walker }
	];
	const box = { roster_id: 2, player_points: true, team_total: true, starters, bench: [] };
	const live = sideBox(SIDE, { ...box, projected_final: 98.5 }, read, ZONE);
	assert.equal(live.totals.final, 98.5);
	assert.equal(live.totals.pts, 90.9);
	// An older API answer with no projected final: the Proj stands in once the game has started.
	assert.equal(sideBox(SIDE, box, read, ZONE).totals.final, 41.9);
	assert.equal(sideBox(SIDE, box, { ...read, started: false }, ZONE).totals.final, null);
});

void test('the basis says once that a game past kickoff keeps its Proj, and what Proj final is', () => {
	const clock = { zone: ZONE, zoned: false };
	const facts = {
		projection: {
			readAt: '2026-10-19T23:00:00.000Z',
			scoring: { format: 'ppr' as const, league_own: false }
		},
		lines: [mccaffrey, walker],
		byPlayer: true,
		teamTotal: true,
		host: 'espn' as const,
		lineup: null
	};
	const live = basisText(boxBasisParts(facts, clock, MONDAY_NIGHT));
	assert.match(live, new RegExp(`read Mon 6:00 pm, ${AS_OF_KICKOFF}\\.`));
	assert.ok(live.includes(PROJ_FINAL_PART));
	assert.match(live, /Pts are ESPN's points by player so far/);
	assert.equal(live.split(AS_OF_KICKOFF).length, 2);
	const before = basisText(boxBasisParts({ ...facts, lines: ahead }, clock, SATURDAY));
	assert.ok(!before.includes(AS_OF_KICKOFF) && !before.includes(PROJ_FINAL_PART));
	assert.doesNotMatch(
		projPart(
			{ readAt: null, scoring: facts.projection.scoring, defense: false, league: true },
			clock
		),
		/kickoff/
	);
});
