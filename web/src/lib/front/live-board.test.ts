// One board for a signed-in member (Lane 96 fix round 1, B08): run with `npm test`. The case is the
// sense-check's: the run (8:50 am Central, Monday) counts Monday night's WAS at SF; at 7:25 pm the
// API's live board has taken that game out, so its 25th back is Woody Marks at 95.7 where the run's was
// Jacory Croskey-Merritt (WAS) at 97.8, and every back's Over repl. moves by 2.1 (api
// oneboard_test.go and restlive.go hold the engine's side).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { components } from '#lib/api/types.ts';
import type { BoardRowView } from '#lib/run/schema.ts';
import {
	STRIP_ROWS,
	liveBasis,
	liveLeadPart,
	liveStrip,
	runStampPart,
	shapeWords
} from './live-board.ts';

type OrderAdvice = components['schemas']['OrderAdvice'];
type OrderRow = components['schemas']['OrderRow'];

const ZONE = 'America/Chicago';
/** The run's refresh, Monday Oct 19 8:50 am Central. */
const RUN_AT = '2026-10-19T13:50:24.188Z';
/** The read, Monday 7:25 pm Central: WAS at SF under way. */
const READ_AT = Date.parse('2026-10-20T00:25:00.000Z');

const runRow = (id: string, rank: number, projected: number, vor: number): BoardRowView => ({
	id,
	slug: id,
	name: id,
	position: 'RB',
	positionRank: rank,
	team: 'DET',
	headshot: 'https://a.espncdn.com/x.png',
	orderBasis: 'projection',
	ourRank: rank,
	vorRound: 1,
	adp: 1.4,
	gap: 0.4,
	projected,
	vor,
	expectedGames: 11,
	floor: null,
	median: null,
	ceiling: null,
	tier: 1
});

const liveRow = (id: string, rank: number, total: number, over: number): OrderRow => ({
	line: {
		player: {
			host_id: '',
			board_id: id,
			name: id,
			position: 'RB',
			team: 'DET',
			injured_reserve: false
		},
		headshot: null,
		slug: id,
		position_rank: rank,
		points_over_replacement: null,
		rest_of_season_per_game: 22,
		week_projection: null,
		projection_delta: null,
		opp_rank: null,
		season_avg: 30.7,
		last_points: 37.7,
		held: false,
		facts: {
			week: 6,
			opponent: null,
			home: null,
			kickoff: null,
			bye: true,
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
	},
	rank,
	rest_of_season_points: total,
	points_over_replacement: over,
	roster: null,
	move: null
});

/** The run's strip: Gibbs, Bijan, then Henry ahead of McMillan, as the front door printed it. */
const POOL = [
	runRow('gibbs', 1, 242.5, 144.7),
	runRow('bijan', 2, 217.6, 119.8),
	runRow('mcmillan', 3, 184.4, 86.4),
	runRow('henry', 4, 184.0, 86.2)
];
/** The API's answer at 7:25 pm: the same points, the line 2.1 lower for backs, 1.1 for receivers, so
 * Henry passes McMillan. */
const ANSWER: Pick<OrderAdvice, 'rows' | 'basis'> = {
	basis:
		"Our rest-of-season order from week 7. A position ranks by Projected through week 17, byes out, All by Over repl., his points less a free pickup's in a 12-team PPR league.",
	rows: [
		liveRow('gibbs', 1, 242.5, 146.8),
		liveRow('bijan', 2, 217.6, 121.9),
		liveRow('henry', 3, 184.0, 88.3),
		liveRow('mcmillan', 4, 184.4, 87.5)
	]
};

void test("a signed-in member's strip is the API's order at the clock, to its tenth", () => {
	const rows = liveStrip(POOL, ANSWER, 12, 4);
	assert.ok(rows !== null);
	assert.deepEqual(
		rows.map((r) => [r.id, r.ourRank, r.projected, r.vor]),
		ANSWER.rows.map((r) => [
			r.line.player.board_id,
			r.rank,
			r.rest_of_season_points,
			r.points_over_replacement
		])
	);
	// The run's own Gap is its ADP less its rank: the live place leaves it unsaid, the face and tier
	// stay the run's.
	assert.ok(rows.every((r) => r.gap === null && r.tier === 1 && r.vorRound === 1));
});

void test('a strip the run did not carry, or a figure the answer lacks, keeps the run strip', () => {
	const stranger = {
		...ANSWER,
		rows: [...ANSWER.rows.slice(0, 3), liveRow('kamara', 4, 100, 4.3)]
	};
	assert.equal(liveStrip(POOL, stranger, 12, 4), null);
	const unvalued = {
		...ANSWER,
		rows: ANSWER.rows.map((r, i) => (i === 0 ? { ...r, points_over_replacement: null } : r))
	};
	assert.equal(liveStrip(POOL, unvalued, 12, 4), null);
	assert.equal(liveStrip(POOL, { ...ANSWER, rows: ANSWER.rows.slice(0, 2) }, 12, 4), null);
	assert.equal(STRIP_ROWS, 10);
});

void test("the signed-out strip says the run's time beside its figures", () => {
	assert.deepEqual(runStampPart(RUN_AT, ZONE), {
		text: 'Projected and Over repl. as of the run, 8:50 am Central.',
		phone: true
	});
});

void test("the live strip's lead says its weeks, the shape and when it was read", () => {
	const run = [
		{ text: 'Our PPR board, the rest of the 2026 season from week 6.', phone: true },
		{ text: 'GP and Avg are this season’s.', phone: false }
	];
	const league = liveLeadPart(ANSWER, shapeWords(12, true), READ_AT, ZONE);
	assert.equal(
		league.text,
		"Our rest-of-season order from week 7, by points over replacement for 12 teams, your league's shape, read 7:25 pm Central."
	);
	assert.equal(
		liveLeadPart(ANSWER, shapeWords(12, false), READ_AT, ZONE).text,
		'Our rest-of-season order from week 7, by points over replacement for 12 teams, read 7:25 pm Central.'
	);
	assert.deepEqual(liveBasis(run, league), [league, run[1]]);
});
