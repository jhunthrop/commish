// The sheet's status line (B52): an empty sheet says no save, and a saved sheet carries the one
// changed date the account holds, never the visit's. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusWords, type StatusFacts } from './status.ts';

/** Monday October 19, 2026, 7:41 pm Central: the founder's visit in the sense check. */
const VISIT = new Date('2026-10-20T00:41:00.000Z');
const OCT_13 = '2026-10-13T18:05:00.000Z';
const TODAY = '2026-10-20T00:40:30.000Z';

const saved: StatusFacts = {
	status: 'saved',
	problem: null,
	changedAt: OCT_13,
	answeredAt: VISIT,
	players: 42
};

void test('an empty sheet says no save, in every state but a problem', () => {
	for (const status of [
		'local',
		'checking',
		'saving',
		'saved',
		'offline',
		'storage-blocked'
	] as const) {
		assert.equal(statusWords({ ...saved, status, players: 0 }), null, status);
	}
	assert.equal(
		statusWords({ ...saved, status: 'failed', problem: 'Your sheet did not save', players: 0 }),
		'Your sheet did not save'
	);
});

void test('a visit that wrote nothing says the day the sheet last changed, the account list day', () => {
	assert.equal(statusWords(saved), 'Saved to your account Oct 13');
});

void test('a sheet changed today says the time it changed, not the time of the visit', () => {
	const words = statusWords({ ...saved, changedAt: TODAY });
	assert.match(words ?? '', /^Saved to your account at \d{1,2}:\d{2}\s?[AP]M$/);
});

void test('before the account answers a saved sheet says only that it is saved', () => {
	assert.equal(statusWords({ ...saved, changedAt: null }), 'Saved to your account');
	assert.equal(statusWords({ ...saved, answeredAt: null }), 'Saved to your account Oct 13');
});

void test('a sheet with players keeps its other states', () => {
	assert.equal(statusWords({ ...saved, status: 'local' }), 'Saved in this browser');
	assert.equal(statusWords({ ...saved, status: 'offline' }), 'Offline. Saved in this browser');
	assert.equal(statusWords({ ...saved, status: 'failed' }), 'Not saved to your account');
});
