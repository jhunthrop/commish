// Records the stand-in run's pages of the apps' sheet players and its schedule (Lane 192), beside the
// board record-standin-run.ts keeps (Lane 190) under shared/fixtures/standin-run: each player's page as
// the web's player page and shelf read it (`npm run standin`), his week read and his capsule with it,
// and the run's schedule, which says when the season's first game kicked off (whether the run is
// under way) and each week's last kickoff. The players are shared/scripts/sheet-players.ts's, each on
// the fixture league, so the fixture API answers his week too. Each file is held to the run's schema
// and written as read; nothing is changed.
//
//   npm run standin && node scripts/record-standin-pages.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { SHEET_PLAYER_IDS } from '../../shared/scripts/sheet-players.ts';
import {
	LATEST_POINTER,
	RUN_PATHS,
	latestPointerSchema,
	playerSchema,
	scheduleSchema
} from '../src/lib/run/schema.ts';

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
	const { runId: recorded } = await read(latestPointerSchema, new URL(LATEST_POINTER, OUT));
	if (recorded !== runId) {
		throw new Error(`shared/fixtures/standin-run holds ${recorded}, the stand-in is ${runId}.`);
	}
	const run = new URL(`${runId}/`, RUNS);
	const out = new URL(`${runId}/`, OUT);
	for (const id of SHEET_PLAYER_IDS) {
		const page = await read(playerSchema, new URL(RUN_PATHS.player(id), run));
		await write(new URL(RUN_PATHS.player(id), out), page);
	}
	await write(
		new URL(RUN_PATHS.schedule, out),
		await read(scheduleSchema, new URL(RUN_PATHS.schedule, run))
	);
}

if (import.meta.main) await record();
