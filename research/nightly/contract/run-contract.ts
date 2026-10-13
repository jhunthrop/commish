// THE RUN AGAINST THE WEB'S OWN READER (the nightly's `schema` gate, `research/nightly/schema_gate.py`).
//
// Every artifact of one run, read through the web build's own reader, `web/src/lib/server/run.ts`:
// the same module the build prerenders from, with its schemas (`src/lib/run/schema.ts`) and every
// cross-file check it makes (the manifest names its own run, the index matches the manifest, ids and
// slugs are unique, each format's board says it is that format, each page's log runs the schedule's
// weeks and its season is the index's two numbers for him, and `season-checks.ts` across the season
// blocks). Nothing here restates a check (fix round 2, N6): a check the web adds is gated the night
// the image carrying it deploys. A run this refuses is one the web build would refuse.
//
//   node --experimental-strip-types run-contract.ts <web dir> <runs root> <run id>
//
// <web dir> holds `src/lib/run/*.ts`, `src/lib/server/run.ts`, `src/lib/types/player.ts` and a
// node_modules with zod and aws4fetch (the web's own versions). The reader's one SvelteKit import,
// `$app/env/public` (the build's PUBLIC_RUN_ID and PUBLIC_RUN_BASE_URL), is answered here with the run
// to check. Every refusal is printed as one line, `schema:<file>:<message>`, and the exit status is 1
// when there is any, 2 when the checker itself could not run.
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [webDir, root, runId] = process.argv.slice(2);
if (!webDir || !root || !runId) {
	process.stderr.write('usage: run-contract.ts <web dir> <runs root> <run id>\n');
	process.exit(2);
}

const ENV_MODULE = '$app/env/public';
const envSource =
	`export const PUBLIC_RUN_ID = ${JSON.stringify(runId)};\n` +
	`export const PUBLIC_RUN_BASE_URL = ${JSON.stringify(resolve(root))};\n`;
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === ENV_MODULE) {
			return { url: `data:text/javascript,${encodeURIComponent(envSource)}`, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
});

const web = await import(pathToFileURL(resolve(webDir, 'src/lib/server/run.ts')).href);

interface Entry {
	id: string;
}
interface Format {
	id: string;
}

// One line per refusal, named by the first file that met it: the reader shares one read per artifact,
// so a broken schedule refuses every page through the same error.
const refusals = new Map<string, string>();
async function check<T>(file: string, read: () => Promise<T>): Promise<T | null> {
	try {
		return await read();
	} catch (error) {
		const message = (error instanceof Error ? error.message : String(error)).replaceAll('\n', ' ');
		if (!refusals.has(message)) refusals.set(message, `schema:${file}:${message}`);
		return null;
	}
}

const manifest = await check<{ formats: Format[] }>('manifest.json', () => web.manifest());
await check('manifest.json', () => web.stamp());
const index = await check<Entry[]>('index.json', () => web.index());
let rows = 0;
for (const format of manifest?.formats ?? []) {
	const board = await check<{ rows: unknown[] }>(`boards/${format.id}.json`, () => web.board(format.id));
	rows += board?.rows.length ?? 0;
}
let pages = 0;
for (const entry of index ?? []) {
	if (await check(`players/${entry.id}.json`, () => web.player(entry.id))) pages += 1;
}
await check('adp.json', () => web.adp());
await check('record.json', () => web.record());
await check('clubs.json', () => web.clubs());
await check('schedule.json', () => web.schedule());
await check('schedule.json', () => web.firstKickoff());

for (const line of refusals.values()) process.stdout.write(`${line}\n`);
process.stdout.write(
	`run ${runId}: ${refusals.size} refusals; ${manifest?.formats.length ?? 0} formats (${rows} board rows), ` +
		`${pages} of ${index?.length ?? 0} player pages parsed, adp, record, clubs, schedule\n`
);
process.exit(refusals.size === 0 ? 0 : 1);
