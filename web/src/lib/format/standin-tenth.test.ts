// The stand-in run's writer rounds as the API and the nightly do (Lane 66n re-review N2): every case of
// the shared tenth table, and the Gap as the nightly writes it, on the half cases the shared Picks
// later table holds. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dropBetween, gapOf, tenth } from '../../../scripts/tenth.ts';

const read = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));

void test('the stand-in writer rounds every case of the shared tenth table as the API does', () => {
	for (const { in: n, out } of read('tenth-table.json') as { in: number; out: number }[]) {
		assert.equal(tenth(n), out, String(n));
	}
});

void test("the stand-in's Gap is the nightly's: the API's Picks later with our rank as the pick, negated", () => {
	for (const { pick, adp, later } of read('picks-later-table.json') as {
		pick: number;
		adp: number;
		later: number;
	}[]) {
		assert.equal(gapOf(adp, pick), later === 0 ? 0 : -later, `${String(adp)} at ${String(pick)}`);
	}
	assert.equal(gapOf(null, 3), null);
});

void test("the stand-in's tier drop is the nightly's: the two projections as shown, the difference to its tenth", () => {
	for (const { last, first, drop } of read('tier-drop-table.json') as {
		last: number;
		first: number;
		drop: number;
	}[]) {
		assert.equal(dropBetween(last, first), drop, `${String(last)} to ${String(first)}`);
	}
});
