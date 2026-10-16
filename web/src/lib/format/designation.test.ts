// A designation's words on every screen (Lane 63): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthDay, zoneWord } from './clock.ts';
import { DESIGNATION_STATUSES } from '#lib/run/schema.ts';
import {
	captureLine,
	designationMark,
	designationWord,
	rankWord,
	seasonLongLine,
	sitsHim
} from './designation.ts';

const CENTRAL = 'America/Chicago';
const READ = '2026-10-16T14:05:00.000Z';

test('a season-long status says since when and what the order does with him', () => {
	assert.equal(
		seasonLongLine(
			{ status: 'injured_reserve', since: '2026-10-14T15:00:00.000Z' },
			READ,
			true,
			CENTRAL
		),
		'On injured reserve since October 14. Our rest-of-season figure assumes he plays, so he sits below the available players.'
	);
	assert.equal(
		seasonLongLine({ status: 'pup', since: null }, READ, false, CENTRAL),
		'On the PUP list as of October 16. Our projection assumes he plays, so he sits below the available players.'
	);
});

test('the day is the member’s own', () => {
	// 03:30 UTC on October 15 is still October 14 in Chicago.
	assert.equal(monthDay('2026-10-15T03:30:00.000Z', CENTRAL), 'October 14');
	assert.equal(monthDay('2026-10-15T03:30:00.000Z', 'UTC'), 'October 15');
});

test('the basis sentence names the capture and its read on the member’s clock', () => {
	assert.equal(
		captureLine(READ, CENTRAL),
		'Injury status from the hourly capture, read Fri 9:05 am Central.'
	);
	assert.equal(zoneWord('America/New_York'), 'Eastern');
	assert.equal(zoneWord('America/Los_Angeles'), 'Pacific');
});

test('the marks', () => {
	assert.equal(designationMark('doubtful', READ, CENTRAL), 'Doubtful as of Fri 9:05 am');
	assert.equal(rankWord('injured_reserve'), 'IR');
	assert.equal(designationWord('nfi'), 'On the NFI list');
	assert.deepEqual(
		DESIGNATION_STATUSES.filter((status) => !sitsHim(status)),
		['questionable', 'doubtful']
	);
});

test('no line carries an em-dash or a semicolon', () => {
	const lines = [
		...DESIGNATION_STATUSES.map((status) =>
			seasonLongLine({ status, since: null }, READ, true, CENTRAL)
		),
		...DESIGNATION_STATUSES.map((status) => designationMark(status, READ, CENTRAL)),
		captureLine(READ, CENTRAL)
	];
	for (const line of lines) assert.doesNotMatch(line, /[—;]/u, line);
});
