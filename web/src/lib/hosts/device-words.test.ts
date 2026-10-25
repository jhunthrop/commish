// The Paired devices list's words (Lane 198): each device's line, the head's count and the verbs, read
// by the web's account page and the apps' Account screens alike. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICES, deviceCount, deviceLine } from './device-words.ts';

void test("a device's line says the day it was paired and the day it was last used, on the site's clock", () => {
	assert.equal(
		deviceLine({ created_at: '2026-10-12T15:00:00Z', last_used_at: '2026-10-17T16:00:00Z' }),
		'Paired Oct 12, last used Oct 17'
	);
});

void test('a device never used says so', () => {
	assert.equal(
		deviceLine({ created_at: '2026-10-12T15:00:00Z', last_used_at: null }),
		'Paired Oct 12, not used yet'
	);
});

void test("the head counts the devices and the verbs are the list's own", () => {
	assert.equal(deviceCount(1), '1 device');
	assert.equal(deviceCount(2), '2 devices');
	assert.equal(DEVICES.unpair, 'Unpair');
	assert.equal(DEVICES.title, 'Paired devices');
});
