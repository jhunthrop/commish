// The hourly backstop's choice: build only when the live site holds a run other than the latest one.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backstopChoice, parseDeployedRun } from './deployed.ts';

void test('an hour where the site already holds the latest run skips, and says so', () => {
	const choice = backstopChoice('2026-10-15T05', '2026-10-15T05');
	assert.equal(choice.build, false);
	assert.equal(
		choice.line,
		'The site already holds run 2026-10-15T05, the latest; nothing to build.'
	);
});

void test('a newer published run builds', () => {
	const choice = backstopChoice('2026-10-15T05', '2026-10-14T05');
	assert.equal(choice.build, true);
	assert.match(choice.line, /holds run 2026-10-14T05.*latest is 2026-10-15T05/);
});

void test('a site whose run cannot be read builds', () => {
	const choice = backstopChoice('2026-10-15T05', null);
	assert.equal(choice.build, true);
	assert.match(choice.line, /could not be read/);
});

void test('the deployed run is the text the build wrote, trimmed, or nothing when it is not a run id', () => {
	assert.equal(parseDeployedRun('2026-10-15T05\n'), '2026-10-15T05');
	assert.equal(parseDeployedRun('<!doctype html><title>404</title>'), null);
	assert.equal(parseDeployedRun(''), null);
});
