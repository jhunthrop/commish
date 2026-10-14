// The basis line names scorings only, never a lineup shape, and promises nothing: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { figuresLine } from './model.ts';

void test('a TE premium league on the PPR figures says both scorings', () => {
	assert.equal(figuresLine('PPR', 'te_premium'), 'Figures are PPR. Your league scores TE premium.');
});

void test('a league scoring like the figures says the same', () => {
	assert.equal(figuresLine('PPR', 'ppr'), 'Figures are PPR. Your league scores the same.');
	assert.equal(
		figuresLine('Half PPR', 'half_ppr'),
		'Figures are half PPR. Your league scores the same.'
	);
});

void test('the line never names a lineup shape or promises exact rules', () => {
	const line = figuresLine('PPR', 'standard');
	assert.equal(line, 'Figures are PPR. Your league scores standard.');
	assert.doesNotMatch(line, /superflex|Draft Pass|exact rules/i);
});
