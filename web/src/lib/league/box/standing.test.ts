// The Matchup bug's standing line and its Decided state (Lane 99, B31): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KICKOFF } from './kickoff.ts';
import { decidedHead, standingLine } from './matchup.ts';

const STANDING = 'Down 14.1 with nobody left, McCaffrey and Kittle playing for them';

void test('the standing line is the API sentence from the first kickoff, never before it', () => {
	assert.equal(standingLine({ standing: STANDING }, true), STANDING);
	assert.equal(standingLine({ standing: STANDING }, false), null);
	assert.equal(standingLine(null, true), null);
	// An answer from the API before this lane has none.
	assert.equal(standingLine({}, true), null);
});

void test('Decided replaces the state word while the game plays, never before kickoff or once final', () => {
	const live = { head: KICKOFF.kickedOff, words: '' };
	assert.deepEqual(decidedHead(live, true, true), { head: KICKOFF.decided, words: '' });
	assert.deepEqual(
		decidedHead({ head: KICKOFF.next, words: 'Mon 7:15 pm, SF vs WSH' }, true, true),
		{ head: KICKOFF.decided, words: '' }
	);
	assert.deepEqual(decidedHead(live, false, true), live);
	const first = { head: KICKOFF.first, words: 'Sun 12:00 pm, CHI at ATL' };
	assert.deepEqual(decidedHead(first, true, false), first);
	const final = { head: KICKOFF.final, words: '' };
	assert.deepEqual(decidedHead(final, true, true), final);
	assert.equal(decidedHead(null, true, true), null);
});
