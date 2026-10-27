// The lobby notice's quiet way back (B252, review L3): a page that did not load keeps Join a lobby
// when its notice has no way of its own; a failed action on a loaded page never gets it beside the
// page's own verb. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keepsWayOut } from './notice-way-out.ts';

const link = { label: 'Sign in', href: '/sign-in' };

void test('a lobby page whose read failed with no verb of its own keeps the way back', () => {
	assert.equal(keepsWayOut({}, 'lobby', true), true);
});

void test('a failed Leave, Join another lobby or bots draft on a loaded page gets none', () => {
	assert.equal(keepsWayOut({}, 'lobby', false), false);
});

void test('a notice with its own verb or quiet way, or another subject, gets none', () => {
	assert.equal(keepsWayOut({ verb: link }, 'lobby', true), false);
	assert.equal(keepsWayOut({ quiet: link }, 'lobby', true), false);
	assert.equal(keepsWayOut({}, 'mock', true), false);
	assert.equal(keepsWayOut({}, 'setup', true), false);
});
