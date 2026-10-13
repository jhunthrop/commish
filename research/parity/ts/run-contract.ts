// THE RUN AGAINST THE WEB'S OWN READER: every artifact of a run, read through `openRun` and parsed
// with the schema the build parses it with (`web/src/lib/run/schema.ts`), then the cross-file checks
// the build makes (`web/src/lib/server/run.ts`: the index against the manifest, unique ids and
// slugs, a board for every format, the manifest naming its own run). A run this passes is one the
// web build reads with no change.
//
//   node --experimental-strip-types research/parity/ts/run-contract.ts <web dir> <runs root> [run id|latest]
//
// <web dir> is a checkout of web/ with its node_modules (the schema resolves zod from there).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [webDir, root, runArg = 'latest'] = process.argv.slice(2);
if (!webDir || !root) throw new Error('usage: run-contract.ts <web dir> <runs root> [run id|latest]');
const lib = (path: string): string => pathToFileURL(resolve(webDir, 'src/lib/run', path)).href;
const schema = await import(lib('schema.ts'));
const { openRun } = await import(lib('source.ts'));

const run = await openRun({ runId: runArg, location: { kind: 'directory', path: resolve(root) } });
const manifest = await run.read(schema.RUN_PATHS.manifest, schema.manifestSchema);
if (manifest.runId !== run.runId) throw new Error(`manifest says ${manifest.runId}, read ${run.runId}`);
const index = await run.read(schema.RUN_PATHS.index, schema.indexSchema);
if (index.length !== manifest.players) throw new Error(`index ${index.length} != manifest ${manifest.players}`);
for (const key of ['id', 'slug'] as const) {
	const values = index.map((entry: Record<string, string>) => entry[key]);
	if (new Set(values).size !== values.length) throw new Error(`index repeats a ${key}`);
}
let rows = 0;
for (const format of manifest.formats) {
	const board = await run.read(schema.RUN_PATHS.board(format.id), schema.boardSchema);
	if (board.format !== format.id) throw new Error(`boards/${format.id}.json says ${board.format}`);
	rows += board.rows.length;
}
let capsules = 0;
let pulls = 0;
for (const entry of index) {
	const player = await run.read(schema.RUN_PATHS.player(entry.id), schema.playerSchema);
	if (player.capsule) {
		capsules += 1;
		pulls += player.capsule.pulls.length;
	}
}
for (const [path, parser] of [
	[schema.RUN_PATHS.adp, schema.adpSchema],
	[schema.RUN_PATHS.record, schema.recordSchema],
	[schema.RUN_PATHS.clubs, schema.clubsSchema],
	[schema.RUN_PATHS.schedule, schema.scheduleSchema]
] as const) {
	await run.read(path, parser);
}
process.stdout.write(
	`run ${run.runId} parses with the web's reader: ${manifest.formats.length} formats (${rows} board rows), ` +
		`${index.length} player pages (${capsules} capsules, ${pulls} pull figures), adp, record, clubs, schedule\n`
);
