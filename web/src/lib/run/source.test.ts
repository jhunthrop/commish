// The run reader's optional artifact (Lane 63's designations.json): run with `npm test`.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { designationsSchema } from './schema.ts';
import { openRun } from './source.ts';

const RUN = '2026-10-21T12';

async function runDir(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'run-source-'));
	await mkdir(join(root, 'runs', RUN), { recursive: true });
	for (const [name, body] of Object.entries(files))
		await writeFile(join(root, 'runs', RUN, name), body);
	return root;
}

test('an artifact the run left out reads as null, one it carries is parsed', async () => {
	const empty = await openRun({
		runId: RUN,
		location: { kind: 'directory', path: await runDir({}) }
	});
	assert.equal(await empty.readOptional('designations.json', designationsSchema), null);
	const file = {
		readAt: '2026-10-21T11:00:00.000Z',
		source: 'tank01_injuries_by_date',
		players: {
			'4429795': { status: 'injured_reserve', seasonLong: true, since: '2026-10-14T15:00:00.000Z' }
		}
	};
	const carried = await openRun({
		runId: RUN,
		location: {
			kind: 'directory',
			path: await runDir({ 'designations.json': JSON.stringify(file) })
		}
	});
	assert.deepEqual(await carried.readOptional('designations.json', designationsSchema), file);
});

test('a file that is there but wrong fails the build by name', async () => {
	const bad = {
		readAt: '2026-10-21T11:00:00.000Z',
		source: 'x',
		players: { p1: { status: 'doubtful', seasonLong: false, since: '2026-10-14T15:00:00.000Z' } }
	};
	const run = await openRun({
		runId: RUN,
		location: {
			kind: 'directory',
			path: await runDir({ 'designations.json': JSON.stringify(bad) })
		}
	});
	await assert.rejects(
		run.readOptional('designations.json', designationsSchema),
		/Only a season-long status has a since/
	);
});
