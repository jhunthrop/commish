// The player page's rest-of-season figures on one clock (Lane 86, re-review N1): before the read
// answers, the run's; once it has, the read's, and a figure the read lacks is the empty figure, never
// the run's beside the read's. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cliffAt, lineFiguresAt, matesAt } from './live-figures.ts';

const MATES = [
	{ id: 'chase', projected: 182.2, positionRank: 1, span: null },
	{ id: 'nacua', projected: 179.0, positionRank: 2, span: null },
	{ id: 'lamb', projected: 175.4, positionRank: 3, span: null }
];
const CLIFF = { drop: 12.1, nextTier: 3, nextId: 'adams' };
const TIER = {
	points: { chase: 167.5, nacua: 165.0 },
	ranks: null,
	spans: null,
	drop: null,
	basis: ''
};

void test("before the read answers the run's figures stand", () => {
	assert.deepEqual(matesAt(MATES, null), MATES);
	assert.deepEqual(cliffAt(CLIFF, null), CLIFF);
	assert.deepEqual(lineFiguresAt({ points: 214.8, vor: 71.8 }, 'ppr', null), {
		points: 214.8,
		vor: 71.8
	});
});

void test("once it has, a mate missing from the live board is the empty figure, not his run's", () => {
	assert.deepEqual(
		matesAt(MATES, TIER).map((m) => m.projected),
		[167.5, 165.0, null]
	);
	assert.deepEqual(cliffAt(CLIFF, TIER), { ...CLIFF, drop: null });
	assert.equal(cliffAt(null, TIER), null);
});

void test("a format the read carries no figure for is empty under the read's head", () => {
	const formats = {
		head: 'Rest of season from week 8',
		figures: { ppr: { points: 195.3, vor: 52.3 } }
	};
	assert.deepEqual(lineFiguresAt({ points: 214.8, vor: 71.8 }, 'ppr', formats), {
		points: 195.3,
		vor: 52.3
	});
	assert.deepEqual(lineFiguresAt({ points: 214.2, vor: 71.2 }, 'half_ppr', formats), {
		points: null,
		vor: null
	});
	assert.deepEqual(lineFiguresAt({ points: 214.2, vor: 71.2 }, null, formats), {
		points: null,
		vor: null
	});
});

void test("with an answer that ranks them, the box draws the read's ranks in their order (Lane 162, D02, D03)", () => {
	// Chase's game is played: his total drops below Lamb's and the read ranks him third, as his head does.
	const ranked = {
		...TIER,
		points: { chase: 160.1, nacua: 165.0, lamb: 163.2 },
		ranks: { chase: 3, nacua: 1, lamb: 2 },
		spans: { chase: 'weeks 8 to 17', nacua: null, lamb: null }
	};
	const drawn = matesAt(MATES, ranked);
	assert.deepEqual(
		drawn.map((m) => [m.id, m.positionRank, m.projected, m.span]),
		[
			['nacua', 1, 165.0, null],
			['lamb', 2, 163.2, null],
			['chase', 3, 160.1, 'weeks 8 to 17']
		]
	);
	// A player the read ranks nowhere (a season-long list since the run) draws no rank, last.
	const listed = matesAt(MATES, { ...ranked, ranks: { chase: null, nacua: 1, lamb: 2 } });
	assert.deepEqual(
		listed.map((m) => [m.id, m.positionRank]),
		[
			['nacua', 1],
			['lamb', 2],
			['chase', null]
		]
	);
	// An answer older than the ranks keeps the run's ranks and order.
	assert.deepEqual(
		matesAt(MATES, TIER).map((m) => [m.id, m.positionRank]),
		[
			['chase', 1],
			['nacua', 2],
			['lamb', 3]
		]
	);
});
