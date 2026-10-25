// The fixture run (shared/fixtures/run, written by export-run.ts): its files where the bucket holds
// them, the run's own files byte for byte, and its designations held to the index. Run with
// `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PPR_FORMAT, RUN_FIXTURE, heldToIndex, runFiles } from './export-run.ts';
import { REPOSITORY } from './generated.ts';

const RUN_ID = '2026-10-21T12-ros';
const CONTRACT = join(REPOSITORY, 'research/nightly/contract/fixture/runs', RUN_ID);
const fixture = (path: string): string => readFileSync(join(REPOSITORY, RUN_FIXTURE, path), 'utf8');

void test('the fixture holds the pointer and each file the run routes answer, once', () => {
	const files = runFiles(RUN_ID);
	const paths = files.map((f) => f.path);
	assert.deepEqual(paths, [
		'runs/latest.json',
		`runs/${RUN_ID}/manifest.json`,
		`runs/${RUN_ID}/boards/${PPR_FORMAT}.json`,
		`runs/${RUN_ID}/index.json`,
		`runs/${RUN_ID}/adp.json`,
		`runs/${RUN_ID}/designations.json`
	]);
	const readme = fixture('README.md');
	for (const file of files) assert.ok(readme.includes(file.path), file.path);
});

void test('the latest pointer names the run, whose manifest says it is that run', () => {
	const pointer = JSON.parse(fixture('runs/latest.json')) as { runId: string };
	assert.equal(pointer.runId, RUN_ID);
	const manifest = JSON.parse(fixture(`runs/${RUN_ID}/manifest.json`)) as {
		runId: string;
	};
	assert.equal(manifest.runId, RUN_ID);
});

void test("the manifest, the board, the index and the ADP are the run's files byte for byte", () => {
	for (const path of ['manifest.json', `boards/${PPR_FORMAT}.json`, 'index.json', 'adp.json']) {
		assert.equal(
			fixture(`runs/${RUN_ID}/${path}`),
			readFileSync(join(CONTRACT, path), 'utf8'),
			path
		);
	}
});

void test('the designations key only players the index names', () => {
	const index = JSON.parse(fixture(`runs/${RUN_ID}/index.json`)) as {
		id: string;
	}[];
	const indexed = new Set(index.map((entry) => entry.id));
	const designations = JSON.parse(fixture(`runs/${RUN_ID}/designations.json`)) as {
		players: Record<string, unknown>;
	};
	const keyed = Object.keys(designations.players);
	assert.ok(keyed.length > 0, 'the capture lists a player the run indexes');
	for (const id of keyed) assert.ok(indexed.has(id), id);
});

void test('a capture held to the index keeps its stamps and drops every other player', () => {
	const capture = {
		readAt: 'r',
		players: { a: { status: 'out' }, b: { status: 'pup' } }
	};
	assert.deepEqual(heldToIndex(capture, new Set(['b'])), {
		readAt: 'r',
		players: { b: { status: 'pup' } }
	});
	assert.deepEqual(Object.keys(capture.players), ['a', 'b'], 'the capture is not changed');
});
