// THE RUN AGAINST THE WEB'S OWN READER (the nightly's `schema` gate, `research/nightly/schema_gate.py`).
//
// Every artifact of one run, read through the web's `openRun` and parsed with the schema the web build
// parses it with (`web/src/lib/run/schema.ts`, copied from the repository into the research image at
// build), then the cross-file checks the build makes (`web/src/lib/server/run.ts`: the manifest names
// its own run, the index matches the manifest, ids and slugs are unique, every format has its board,
// every index entry has its page). A run this refuses is one the web build would refuse.
//
//   node --experimental-strip-types run-contract.ts <web dir> <runs root> <run id>
//
// <web dir> holds `src/lib/run/*.ts`, `src/lib/types/player.ts` and a node_modules with zod and
// aws4fetch (the web's own versions). Every refusal is printed as one line, `schema:<file>:<message>`,
// and the exit status is 1 when there is any, 2 when the checker itself could not run.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [webDir, root, runId] = process.argv.slice(2);
if (!webDir || !root || !runId) {
	process.stderr.write('usage: run-contract.ts <web dir> <runs root> <run id>\n');
	process.exit(2);
}
const lib = (path: string): string => pathToFileURL(resolve(webDir, 'src/lib/run', path)).href;
const schema = await import(lib('schema.ts'));
const { openRun } = await import(lib('source.ts'));
const run = await openRun({ runId, location: { kind: 'directory', path: resolve(root) } });

const refusals: string[] = [];
const refuse = (file: string, message: string): void => {
	refusals.push(`schema:${file}:${message.replaceAll('\n', ' ')}`);
};

async function read<T>(path: string, parser: unknown): Promise<T | null> {
	try {
		return (await run.read(path, parser)) as T;
	} catch (error) {
		refuse(path, error instanceof Error ? error.message : String(error));
		return null;
	}
}

interface Entry {
	id: string;
	slug: string;
}
interface Format {
	id: string;
}

const manifest = await read<{ runId: string; players: number; formats: Format[] }>(
	schema.RUN_PATHS.manifest,
	schema.manifestSchema
);
const index = await read<Entry[]>(schema.RUN_PATHS.index, schema.indexSchema);
if (manifest && manifest.runId !== run.runId) refuse('manifest.json', `names run ${manifest.runId}, read as ${run.runId}`);
if (manifest && index && index.length !== manifest.players) {
	refuse('index.json', `lists ${index.length} players, the manifest says ${manifest.players}`);
}
for (const key of ['id', 'slug'] as const) {
	const values = (index ?? []).map((entry) => entry[key]);
	const repeated = values.filter((value, at) => values.indexOf(value) !== at);
	for (const value of new Set(repeated)) refuse('index.json', `repeats the ${key} ${value}`);
}
let rows = 0;
for (const format of manifest?.formats ?? []) {
	const board = await read<{ format: string; rows: unknown[] }>(schema.RUN_PATHS.board(format.id), schema.boardSchema);
	if (board && board.format !== format.id) refuse(`boards/${format.id}.json`, `says it is the ${board.format} board`);
	rows += board?.rows.length ?? 0;
}
let pages = 0;
for (const entry of index ?? []) {
	if (await read(schema.RUN_PATHS.player(entry.id), schema.playerSchema)) pages += 1;
}
for (const [path, parser] of [
	[schema.RUN_PATHS.adp, schema.adpSchema],
	[schema.RUN_PATHS.record, schema.recordSchema],
	[schema.RUN_PATHS.clubs, schema.clubsSchema],
	[schema.RUN_PATHS.schedule, schema.scheduleSchema]
] as const) {
	await read(path, parser);
}
for (const line of refusals) process.stdout.write(`${line}\n`);
process.stdout.write(
	`run ${run.runId}: ${refusals.length} refusals; ${manifest?.formats.length ?? 0} formats (${rows} board rows), ` +
		`${pages} of ${index?.length ?? 0} player pages parsed, adp, record, clubs, schedule\n`
);
process.exit(refusals.length === 0 ? 0 : 1);
