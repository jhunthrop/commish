// A designation's words on every screen (Lane 63): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { DESIGNATION_STATUSES } from '#lib/run/schema.ts';
import { monthDay, zoneWord } from './clock.ts';
import {
	CAPTURE_BEHIND_MS,
	captureLine,
	captureShort,
	designationWord,
	newerCapture,
	rankWord,
	seasonLongLine,
	seasonLongMark,
	sitsHim,
	stampWords
} from './designation.ts';

const CENTRAL = 'America/Chicago';
const LISTED = '2026-10-13T02:03:00.000Z';
const CHECKED = '2026-10-16T14:05:00.000Z';
const SOON = Date.parse(CHECKED) + 60 * 60 * 1000;

void test('a season-long status says since when and what the order does with him', () => {
	assert.equal(
		seasonLongLine(
			{ status: 'injured_reserve', since: '2026-10-14T15:00:00.000Z' },
			CHECKED,
			true,
			CENTRAL
		),
		'On injured reserve since October 14. Our rest-of-season figure assumes he plays, so he sits below the available players.'
	);
	assert.equal(
		seasonLongLine({ status: 'pup', since: null }, CHECKED, false, CENTRAL),
		'On the PUP list as of October 16. Our projection assumes he plays, so he sits below the available players.'
	);
});

void test('the day is the member’s own', () => {
	// 03:30 UTC on October 15 is still October 14 in Chicago.
	assert.equal(monthDay('2026-10-15T03:30:00.000Z', CENTRAL), 'October 14');
	assert.equal(monthDay('2026-10-15T03:30:00.000Z', 'UTC'), 'October 15');
	assert.equal(zoneWord('America/New_York'), 'Eastern');
	assert.equal(zoneWord('America/Los_Angeles'), 'Pacific');
});

void test('"read" is said only for a real check, and a stamp names its month and day', () => {
	assert.equal(stampWords(CHECKED, CENTRAL), 'Fri Oct 16, 9:05 am CT');
	assert.equal(
		captureLine({ readAt: LISTED, checkedAt: CHECKED }, SOON, CENTRAL),
		'Injury status from the hourly capture, read Fri Oct 16, 9:05 am CT.'
	);
	assert.equal(
		captureLine({ readAt: LISTED, checkedAt: null }, Date.parse(LISTED) + 1000, CENTRAL),
		'Injury status from the hourly capture, as the list stood Mon Oct 12, 9:03 pm CT.'
	);
});

void test('past 36 hours the basis says how old the statuses are, and they stay applied', () => {
	const late = Date.parse(CHECKED) + CAPTURE_BEHIND_MS + 1;
	assert.equal(
		captureLine({ readAt: LISTED, checkedAt: CHECKED }, late, CENTRAL),
		'These injury statuses are from the hourly capture, read Fri Oct 16, 9:05 am CT, over a day and a half before now. Players keep them until a newer list is read.'
	);
	assert.match(
		captureLine(
			{ readAt: LISTED, checkedAt: null },
			Date.parse(LISTED) + CAPTURE_BEHIND_MS + 1,
			CENTRAL
		),
		/^These injury statuses are from the hourly capture, as the list stood Mon Oct 12, 9:03 pm CT, over/
	);
	assert.match(
		captureLine(
			{ readAt: LISTED, checkedAt: CHECKED },
			Date.parse(CHECKED) + CAPTURE_BEHIND_MS,
			CENTRAL
		),
		/^Injury status from/
	);
});

void test('the marks', () => {
	assert.equal(
		seasonLongMark({ status: 'injured_reserve', since: CHECKED }, CENTRAL),
		'IR since Oct 16'
	);
	assert.equal(seasonLongMark({ status: 'pup', since: null }, CENTRAL), 'PUP');
	assert.equal(rankWord('injured_reserve'), 'IR');
	assert.equal(designationWord('nfi'), 'On the NFI list');
	assert.deepEqual(
		DESIGNATION_STATUSES.filter((status) => !sitsHim(status)),
		['questionable', 'doubtful']
	);
});

void test('the short capture for a board basis says the read, the hour on the member’s own day, and how old past a day and a half', () => {
	const capture = { readAt: LISTED, checkedAt: CHECKED };
	assert.equal(captureShort(capture, SOON, CENTRAL), 'Status read today 9:05 am CT.');
	const nextDay = Date.parse(CHECKED) + 20 * 60 * 60 * 1000;
	assert.equal(
		captureShort(capture, nextDay, CENTRAL),
		'Status read Oct 16.',
		'an earlier day keeps its date'
	);
	assert.equal(
		captureShort({ readAt: LISTED, checkedAt: null }, SOON, CENTRAL),
		'Status as of Oct 12, over 36 hours ago.'
	);
});

void test('no line carries an em-dash or a semicolon', () => {
	const lines = [
		...DESIGNATION_STATUSES.map((status) =>
			seasonLongLine({ status, since: null }, CHECKED, true, CENTRAL)
		),
		...DESIGNATION_STATUSES.map((status) => seasonLongMark({ status, since: null }, CENTRAL)),
		captureLine({ readAt: LISTED, checkedAt: CHECKED }, SOON, CENTRAL),
		captureLine({ readAt: LISTED, checkedAt: null }, SOON + CAPTURE_BEHIND_MS, CENTRAL)
	];
	for (const line of lines) assert.doesNotMatch(line, bannedPattern(), line);
});

void test('the board dates its statuses by the newer of the run’s capture and the live order’s (Lane 280)', () => {
	const run = { readAt: LISTED, checkedAt: null };
	const live = { readAt: LISTED, checkedAt: CHECKED };
	assert.equal(newerCapture(run, null), run, 'run only');
	assert.equal(newerCapture(null, live), live, 'live only');
	assert.equal(newerCapture(null, null), null);
	assert.equal(newerCapture(run, live), live, 'live newer');
	assert.equal(newerCapture(live, run), live, 'live older: the run’s stands');
	assert.equal(newerCapture(live, { ...live }), live, 'a tie keeps the run’s');
	assert.equal(
		captureShort(newerCapture(run, live) ?? run, SOON, CENTRAL),
		'Status read today 9:05 am CT.'
	);
});
