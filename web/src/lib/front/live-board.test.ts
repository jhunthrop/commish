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
	answerReadAt,
	liveBasis,
	liveLeadPart,
	liveStrip,
	overReplacementPart,
	runStampPart,
	shapeWords,
	stripBasisParts,
	stripHead
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

void test("a player the run's rows do not hold is drawn from the answer's own line (review R1-M1)", () => {
	// A two-quarterback league's live top ten holds quarterbacks far down the one-quarterback board.
	const qb = liveRow('allen', 1, 280.4, 160.2);
	const rows = liveStrip(POOL, { ...ANSWER, rows: [qb, ...ANSWER.rows.slice(0, 3)] }, 12, 4);
	assert.ok(rows !== null);
	const first = rows[0];
	assert.ok(first !== undefined);
	assert.deepEqual(
		[first.id, first.slug, first.ourRank, first.projected, first.vor, first.untiered],
		['allen', 'allen', 1, 280.4, 160.2, true]
	);
	// No run tier, ADP or games for him: they are the run's. His Avg is the answer's (B78).
	assert.equal(first.adp, null);
	assert.deepEqual(first.season, { games: null, pointsPerGame: 30.7 });
	const unplayed = { ...qb, line: { ...qb.line, season_avg: null } };
	const none = liveStrip(POOL, { ...ANSWER, rows: [unplayed, ...ANSWER.rows.slice(0, 3)] }, 12, 4);
	assert.equal(none?.[0]?.season, undefined);
	// One basis part says why Tier reads empty, only when a built row is shown, never per row (Lane
	// 117): the run tiers him, and the page carries its top 40 alone.
	assert.deepEqual(stripBasisParts(rows, 'PPR', { format: 'ppr', league_own: true }), [
		{ text: 'Tier reads "--" for a player outside the top 40 of our PPR board.', phone: false }
	]);
	assert.deepEqual(stripBasisParts(rows.slice(1), 'PPR', { format: 'ppr', league_own: true }), []);
	assert.deepEqual(
		rows.slice(1).map((r) => r.untiered),
		[undefined, undefined, undefined]
	);
	// A line with no page to link keeps the run strip.
	const pageless = { ...qb, line: { ...qb.line, slug: null } };
	assert.equal(
		liveStrip(POOL, { ...ANSWER, rows: [pageless, ...ANSWER.rows.slice(0, 3)] }, 12, 4),
		null
	);
});

void test("the live Avg is the answer's, in the league's scoring, beside the run's games", () => {
	const seasoned = POOL.map((r) => ({ ...r, season: { games: 5, pointsPerGame: 30.7 } }));
	const half = {
		...ANSWER,
		rows: ANSWER.rows.map((r) => ({ ...r, line: { ...r.line, season_avg: 26.1 } }))
	};
	const rows = liveStrip(seasoned, half, 12, 4);
	assert.ok(rows !== null);
	assert.ok(rows.every((r) => r.season?.games === 5 && r.season.pointsPerGame === 26.1));
});

void test("the strip's head names the scoring its figures are in (review R1-M2)", () => {
	assert.equal(stripHead('PPR', null), 'The top of our PPR board');
	assert.equal(stripHead('PPR', { format: 'ppr', league_own: true }), 'The top of our PPR board');
	// A league that scores exactly half PPR or standard reads its own board's name (B78).
	assert.equal(
		stripHead('PPR', { format: 'half_ppr', league_own: true }),
		'The top of our half PPR board'
	);
	assert.equal(
		stripHead('PPR', { format: 'standard', league_own: true }),
		'The top of our standard board'
	);
	// Avg is in the league's own scoring: the basis says so once when the head names the nearest.
	assert.deepEqual(stripBasisParts([], 'PPR', { format: 'half_ppr', league_own: false }), [
		{ text: "Avg in your league's scoring.", phone: false }
	]);
	assert.deepEqual(stripBasisParts([], 'PPR', { format: 'half_ppr', league_own: true }), []);
	assert.deepEqual(stripBasisParts([], 'PPR', null), []);
	assert.equal(
		stripHead('PPR', { format: 'half_ppr', league_own: false }),
		'The top of our board, half PPR nearest your rules'
	);
	assert.equal(
		stripHead('PPR', { format: 'ppr', league_own: false }),
		'The top of our board, PPR nearest your rules'
	);
});

void test("the lead's read time is the answer's read, else the page's clock as it landed (review R1-L4)", () => {
	assert.equal(
		answerReadAt({ read_at: '2026-10-20T00:21:00.000Z' }, READ_AT),
		Date.parse('2026-10-20T00:21:00.000Z')
	);
	assert.equal(answerReadAt({ read_at: null }, READ_AT), READ_AT);
});

void test('a figure the answer lacks, or a short answer, keeps the run strip', () => {
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
		text: 'Projected and Over replacement updated 8:50 am Central.',
		phone: true
	});
	// "Run" is never the page's word (B53).
	assert.doesNotMatch(runStampPart(RUN_AT, ZONE).text, /\brun\b/i);
});

void test('the basis says once what Over replacement counts, for the shape (B46)', () => {
	assert.equal(
		overReplacementPart(12).text,
		'Over replacement: his projected points above the last starter at his position for 12 teams.'
	);
	assert.match(overReplacementPart(10).text, /for 10 teams\.$/);
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
