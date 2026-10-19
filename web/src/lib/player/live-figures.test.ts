// The player page's rest-of-season figures on one clock (Lane 86, re-review N1): before the read
// answers, the run's; once it has, the read's, and a figure the read lacks is the empty figure, never
// the run's beside the read's. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cliffAt, lineFiguresAt, matesAt } from './live-figures.ts';

const MATES = [
	{ id: 'chase', projected: 182.2 },
	{ id: 'nacua', projected: 179.0 },
	{ id: 'lamb', projected: 175.4 }
];
const CLIFF = { drop: 12.1, nextTier: 3, nextId: 'adams' };
const TIER = { points: { chase: 167.5, nacua: 165.0 }, drop: null, basis: '' };

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
