// Records the stand-in run's PPR board as the bucket would hold it, for the apps' Board before the draft
// (Lane 190): the board the web's pre-draft board is built from (`npm run standin`), with its manifest,
// its ADP and its designations, under shared/fixtures/standin-run in the bucket's layout
// (`runs/latest.json` and `runs/<runId>/`), the layout of shared/fixtures/run, so one reader serves
// both as the API's run routes answer them. Each file is held to the run's schema and to the members
// the API sends (api/internal/runs project.go): the manifest's sources and the designations' source
// are provenance and are dropped. The manifest's runAt is moved to PRE_DRAFT_RUN_AT, before the
// season's first kickoff, the clock the pre-draft board is shown at; nothing else is changed.
//
//   npm run standin && node scripts/record-standin-run.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import {
	LATEST_POINTER,
	adpSchema,
	boardSchema,
	designationsSchema,
	latestPointerSchema,
	manifestSchema
} from '../src/lib/run/schema.ts';

/** The instant the recorded run says it finished: before the 2026 season's first kickoff. */
export const PRE_DRAFT_RUN_AT = '2026-09-01T12:00:00.000Z';
/** The board the apps' pre-draft Board reads. */
const FORMAT = 'ppr-12';
const STAND_IN_SUFFIX = '-standin';

const RUNS = new URL('../.runs/runs/', import.meta.url);
const OUT = new URL('../../shared/fixtures/standin-run/runs/', import.meta.url);

async function read<S extends z.ZodType>(schema: S, file: URL): Promise<z.infer<S>> {
	return schema.parse(JSON.parse(await readFile(file, 'utf8')));
}

async function write(file: URL, value: unknown): Promise<void> {
	await mkdir(dirname(fileURLToPath(file)), { recursive: true });
	await writeFile(file, `${JSON.stringify(value)}\n`);
}

async function record(): Promise<void> {
	const { runId } = await read(latestPointerSchema, new URL(LATEST_POINTER, RUNS));
	if (!runId.endsWith(STAND_IN_SUFFIX)) {
		throw new Error(`The latest run is ${runId}, not the stand-in: run npm run standin first.`);
	}
	const run = new URL(`${runId}/`, RUNS);
	const { sources: _sources, ...manifest } = await read(
		manifestSchema,
		new URL('manifest.json', run)
	);
	const { source: _source, ...designations } = await read(
		designationsSchema,
		new URL('designations.json', run)
	);
	const board = await read(boardSchema, new URL(`boards/${FORMAT}.json`, run));
	const adp = await read(adpSchema, new URL('adp.json', run));
	const out = new URL(`${runId}/`, OUT);
	await write(new URL(LATEST_POINTER, OUT), { runId });
	await write(new URL('manifest.json', out), { ...manifest, runAt: PRE_DRAFT_RUN_AT });
	await write(new URL(`boards/${FORMAT}.json`, out), board);
	await write(new URL('adp.json', out), adp);
	await write(new URL('designations.json', out), designations);
}

if (import.meta.main) await record();
