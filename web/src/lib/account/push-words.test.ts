// The push switches' words (Lane 198), which the apps' Account screens print: the three kinds, quiet
// hours, where the switches are kept, the permission and the channel. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedIn } from '#lib/format/copy-guard.ts';
import { PUSH } from './push-words.ts';

void test('every push word passes the copy guard', () => {
	for (const [key, text] of Object.entries(PUSH))
		assert.equal(bannedIn(text), null, `${key}: ${text}`);
});

void test('the three kinds and quiet hours each have a name and a line', () => {
	for (const key of ['thursday', 'status', 'waivers', 'quiet'] as const) {
		assert.ok(PUSH[key].length > 0, key);
		assert.ok(PUSH[`${key}Line`].length > 0, `${key}Line`);
	}
});
