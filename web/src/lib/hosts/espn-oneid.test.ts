// Disney's sign-in hands the page a session somewhere in what it answers: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSession } from './espn-oneid.ts';

const S2 = 'AEB'.repeat(30);

void test('the two values are found by name at any depth, the SWID braced', () => {
	const login = {
		token: { access_token: 'x', swid: '00000001-0000-4000-8000-000000000001' },
		guest: { profile: { name: 'm' }, s2: S2 }
	};
	assert.deepEqual(findSession(login), {
		swid: '{00000001-0000-4000-8000-000000000001}',
		s2: S2
	});
});

void test('a payload missing either value hands over nothing', () => {
	assert.equal(findSession({ token: { swid: '{00000001-0000-4000-8000-000000000001}' } }), null);
	assert.equal(findSession({ s2: S2, swid: 'not-a-swid' }), null);
	assert.equal(findSession(null), null);
	assert.equal(findSession('s2'), null);
});
