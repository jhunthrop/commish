import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPTIONAL_READS, buildReads } from './reads.ts';

void test('a build reads the manifest, a board per format, the index, a page per player and the run-wide files', () => {
	assert.deepEqual(buildReads([{ id: 'ppr-12' }, { id: 'standard-12' }], ['4429795']), [
		'manifest.json',
		'boards/ppr-12.json',
		'boards/standard-12.json',
		'index.json',
		'players/4429795.json',
		'adp.json',
		'record.json',
		'clubs.json',
		'schedule.json'
	]);
});

void test('a page id that is not a player id fails the read list', () => {
	assert.throws(() => buildReads([], ['../x']), /not a player id/);
});

void test('the designations and the held pages are the reads a run may leave out', () => {
	assert.deepEqual(OPTIONAL_READS, ['designations.json', 'held.json']);
});
