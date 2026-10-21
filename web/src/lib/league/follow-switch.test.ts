// The selection is the member's (Lane 102, B38): opening a league's page never chooses it. A source
// guard, as the store's choice needs a browser. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

void test('a league page never chooses the league: follow-switch imports no choice (B38)', async () => {
	// The root cause of B38: a league page called choose() on mount, a PUT /me/league.
	const source = await readFile(new URL('./follow-switch.svelte.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /choose\.svelte\.ts/);
	assert.doesNotMatch(source, /\bchoose\(/);
});
