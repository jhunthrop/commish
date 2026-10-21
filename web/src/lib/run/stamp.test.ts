// "Updated Oct 19" (Lane 102, B53): the words every header, the absent-format page and the offline
// page say about when the numbers were made, never "run". Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absentWords } from '#lib/site/absent.ts';
import { offlineLead } from '#lib/site/offline-words.ts';
import { runStampText, type RunStamp } from './stamp.ts';

const RUN: RunStamp = {
	runId: '2026-10-19T13',
	runAt: '2026-10-19T13:50:24.188Z',
	season: 2026,
	standIn: false,
	search: 'Search 619 ranked players',
	formats: ['ppr-12']
};
const RUN_WORD = /\brun\b/i;

void test('the stamp says Updated and the day, a stand-in says so', () => {
	assert.equal(runStampText(RUN), 'Updated Oct 19');
	assert.equal(
		runStampText({ ...RUN, standIn: true, runAt: '2026-10-15T13:50:00.000Z' }),
		'Stand-in, updated Oct 15'
	);
});

void test('the absent format and the offline page never say run', () => {
	const absent = absentWords('Half PPR', runStampText(RUN), ['PPR', 'Standard']);
	assert.deepEqual(absent, {
		title: 'Half PPR is not on our board yet',
		line: 'Our board ranks PPR and Standard only. Updated Oct 19.'
	});
	assert.equal(
		offlineLead(RUN.runAt),
		"You're offline, so this is the last board this device saved, updated Oct 19."
	);
	for (const said of [absent.title, absent.line, offlineLead(RUN.runAt), runStampText(RUN)]) {
		assert.doesNotMatch(said, RUN_WORD);
	}
});
