// Signing in to follow a league returns to where the visitor meant to go (Lane 59, M3): the follow
// page, with the screen a rail item named, or the league screen they were on, never the front door.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followThen, safeThen } from './then-path.ts';

const ORIGIN = 'https://trycommish.app';

void test('from any other page, signing in to follow a league goes on to the follow page', () => {
	assert.equal(followThen('/'), '/league/new');
	assert.equal(followThen('/board/ppr-12'), '/league/new');
	assert.equal(followThen('/players/puka-nacua?x=1'), '/league/new');
});

void test('on the follow page it keeps the screen the rail item named', () => {
	assert.equal(followThen('/league/new?screen=matchup'), '/league/new?screen=matchup');
	assert.equal(followThen('/league/new'), '/league/new');
});

void test("on a league's screen it goes back to that screen", () => {
	assert.equal(followThen('/league/abc123/waivers'), '/league/abc123/waivers');
	assert.equal(followThen('/league/abc123'), '/league/abc123');
});

void test('every place it goes on to is one the account page accepts', () => {
	for (const path of ['/', '/league/new?screen=start', '/league/abc123/matchup']) {
		const then = followThen(path);
		assert.equal(safeThen(then, ORIGIN), then);
	}
});
