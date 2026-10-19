// The ADP's one form (the sweep's C19, Y8): the pool row, the call card and the board row print the
// figure, never a sentence against the pick. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { adpFigure } from './draft.ts';
import { EMPTY_FIGURE } from './empty.ts';

void test('the ADP prints as its tenth, or the empty figure with none', () => {
	assert.equal(adpFigure(66), '66.0');
	assert.equal(adpFigure(12.3), '12.3');
	assert.equal(adpFigure(null), EMPTY_FIGURE);
});

void test('the pool row, the call card and the board row print the ADP in its one form', () => {
	for (const file of ['../room/Pool.svelte', '../ui/CallPanel.svelte', '../ui/Row.svelte']) {
		const source = readFileSync(new URL(file, import.meta.url), 'utf8');
		assert.match(source, /adpFigure\(/u, file);
		assert.doesNotMatch(source, /drafters take him/u, file);
	}
});
