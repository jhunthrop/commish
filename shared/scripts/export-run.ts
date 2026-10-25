/** The web's fixture run as the bucket holds it, under shared/fixtures/run, for the API's run routes
 * test (api/internal/runs) and the apps: the nightly's contract fixture run the web's shots build
 * from (CONTRACT_RUN_ID, web/scripts/inseason-fixture/run-ids.ts), its manifest, its PPR board, its
 * index and its ADP exactly as written, the latest pointer naming it, and its designations: the
 * stand-in's injury capture (web/scripts/standin-designations.json) held to the players the run
 * indexes, the way the stand-in writes a run's designations. README.md, written beside them, lists
 * each file with the route that answers it.
 *
 *   node shared/scripts/export-run.ts */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPOSITORY, generatedBy, writeOutputs, type Outputs } from './generated.ts';

const SCRIPT = 'shared/scripts/export-run.ts';
/** The fixture run's folder: the bucket's layout, `runs/latest.json` and `runs/<runId>/`. */
export const RUN_FIXTURE = 'shared/fixtures/run';
const RUN_IDS = 'web/scripts/inseason-fixture/run-ids.ts';
const CONTRACT_RUNS = 'research/nightly/contract/fixture/runs';
const DESIGNATIONS = 'web/scripts/standin-designations.json';
/** The PPR board's format id, the default the manifest lists first. */
export const PPR_FORMAT = 'ppr-12';
/** The run's files copied byte for byte. */
const COPIED = ['manifest.json', `boards/${PPR_FORMAT}.json`, 'index.json', 'adp.json'] as const;

/** A file of the fixture, the route the API answers it on (null for the pointer), and what it holds. */
export interface RunFile {
	path: string;
	route: string | null;
	about: string;
}

/** The files the fixture carries, each where the run writes it in the bucket. */
export function runFiles(runId: string): RunFile[] {
	const at = (path: string): string => `runs/${runId}/${path}`;
	return [
		{
			path: 'runs/latest.json',
			route: null,
			about: 'the latest pointer, naming the fixture run'
		},
		{
			path: at('manifest.json'),
			route: 'GET /run/manifest',
			about: 'the run: its formats, its players and its sources'
		},
		{
			path: at(`boards/${PPR_FORMAT}.json`),
			route: `GET /run/boards/${PPR_FORMAT}`,
			about: 'the PPR board, every row as written'
		},
		{
			path: at('index.json'),
			route: 'GET /run/index',
			about: 'every player with his season so far'
		},
		{
			path: at('adp.json'),
			route: 'GET /run/adp',
			about: 'every ADP source and its value per player'
		},
		{
			path: at('designations.json'),
			route: 'GET /run/designations',
			about: "the stand-in's injury capture, held to the run's players"
		}
	];
}

interface Capture {
	players: Record<string, unknown>;
}

/** The capture with only the players the index names, in the capture's own order. */
export function heldToIndex(capture: Capture, indexed: ReadonlySet<string>): Capture {
	return {
		...capture,
		players: Object.fromEntries(Object.entries(capture.players).filter(([id]) => indexed.has(id)))
	};
}

async function contractRunId(): Promise<string> {
	const ids = (await import(join(REPOSITORY, RUN_IDS))) as {
		CONTRACT_RUN_ID?: unknown;
	};
	if (typeof ids.CONTRACT_RUN_ID !== 'string') {
		throw new Error(`${RUN_IDS} exports no CONTRACT_RUN_ID.`);
	}
	return ids.CONTRACT_RUN_ID;
}

const text = (path: string): Promise<string> => readFile(join(REPOSITORY, path), 'utf8');

function readme(files: readonly RunFile[], runId: string): string {
	const rows = files.map(
		(f) => `| \`${f.path}\` | ${f.route === null ? 'none' : `\`${f.route}\``} | ${f.about} |`
	);
	return `# The fixture run

${generatedBy(SCRIPT, `${CONTRACT_RUNS}/${runId} and ${DESIGNATIONS}`)}

The nightly's contract fixture run \`${runId}\` as the bucket holds it (\`runs/latest.json\` and
\`runs/<runId>/\`), the run the web's shots build from. The API's run routes test reads this folder
as its bucket and holds every answer equal to its file; the apps may read the same files. The
manifest, the board, the index and the ADP are the run's files byte for byte; the designations are
the stand-in's capture held to the players the run indexes. The run is older than the boards' Gap
and Drop columns and the kickers' and defenses' rows, so its board carries none of them: the API's
examples for the run routes (api/openapi.yaml) carry each, and the web's test parses them.

| File | Route | What it holds |
| --- | --- | --- |
${rows.join('\n')}
`;
}

export async function generate(): Promise<Outputs> {
	const runId = await contractRunId();
	const source = (path: string): string => `${CONTRACT_RUNS}/${runId}/${path}`;
	const index = JSON.parse(await text(source('index.json'))) as {
		id: string;
	}[];
	const capture = JSON.parse(await text(DESIGNATIONS)) as Capture;
	const designations = heldToIndex(capture, new Set(index.map((entry) => entry.id)));
	const copied = await Promise.all(
		COPIED.map(async (path): Promise<[string, string]> => [
			`${RUN_FIXTURE}/runs/${runId}/${path}`,
			await text(source(path))
		])
	);
	return new Map([
		[`${RUN_FIXTURE}/runs/latest.json`, `${JSON.stringify({ runId })}\n`],
		...copied,
		[`${RUN_FIXTURE}/runs/${runId}/designations.json`, `${JSON.stringify(designations)}\n`],
		[`${RUN_FIXTURE}/README.md`, readme(runFiles(runId), runId)]
	]);
}

if (import.meta.main) await writeOutputs(await generate());
