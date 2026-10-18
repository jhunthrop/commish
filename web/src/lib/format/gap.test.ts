// The Gap's one text and tone (Lane 66n): the run's tenth printed as given, a true minus, a plain zero,
// green on plus and rose on minus, "--" for a player with none, and no Gap at all on a screen whose
// run carries none (re-review N1). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NO_GAP, carriesGap, gapText, gapTone } from './gap.ts';

void test('the gap prints the run tenth as given, with a true minus, a plain zero and -- for none', () => {
	assert.equal(gapText(1.8), '+1.8');
	assert.equal(gapText(-4.5), '−4.5');
	assert.equal(gapText(-0.5), '−0.5');
	assert.equal(gapText(0), '0.0');
	assert.equal(gapText(null), NO_GAP);
	assert.equal(gapText(undefined), '--');
});

void test('plus is green, minus is rose, zero and none are neither', () => {
	assert.equal(gapTone(3.5), 'gain');
	assert.equal(gapTone(-0.5), 'loss');
	assert.equal(gapTone(0), 'even');
	assert.equal(gapTone(null), null);
});

void test('a screen carries the gap when any row does: none, mixed, every one', () => {
	assert.equal(carriesGap([{}, { gap: null }]), false);
	assert.equal(carriesGap([{ gap: null }, { gap: -4.5 }]), true);
	assert.equal(carriesGap([{ gap: 0 }]), true);
	assert.equal(carriesGap([]), false);
});

void test('an older run without the column carries no gap on any row', () => {
	// The run contract's recorded run from before the Gap: its board rows have no gap key.
	const board = JSON.parse(
		readFileSync(
			new URL(
				'../../../../research/nightly/contract/fixture/runs/2026-10-13T21-2/boards/ppr-12.json',
				import.meta.url
			),
			'utf8'
		)
	) as { rows: { gap?: number | null }[] };
	assert.ok(board.rows.length > 0);
	assert.equal(carriesGap(board.rows), false);
});
