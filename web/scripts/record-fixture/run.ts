// THE RECORD SHOTS RUN (Lane 82). The contract fixture's 2026-10-21T12-ros run with its record swapped
// for record.json here, the record in live's shape a week on: six graded weeks, week 7 frozen and not
// played, the published projection kept from week 7 and so not graded on any row yet, weeks 8 to 18
// upcoming. Weeks 1 and 2 are the contract fixture's real grades; weeks 3 to 6 are STAND-INS (live
// has weeks 3 to 5 missed and week 6 waiting on its stats), so the record page's shots measure the
// basis, the bug and the table on the shape live will carry. Every other artifact is the contract
// fixture's as written. The manifest keeps the fixture's time (the boards' refresh and the run's header
// agree, Oct 21) and takes this run's id; week 7 froze the morning of the run, before its kickoff.
//
// Usage: node scripts/record-fixture/run.ts   writes web/.runs/runs/2026-10-21T12-live-shape/
// then build with PUBLIC_RUN_BASE_URL=.runs PUBLIC_RUN_ID=2026-10-21T12-live-shape.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { manifestSchema, recordSchema, RUN_PATHS } from '../../src/lib/run/schema.ts';

const RECORD_SHOTS_RUN = '2026-10-21T12-live-shape';
const SOURCE_RUN = new URL(
	'../../../research/nightly/contract/fixture/runs/2026-10-21T12-ros/',
	import.meta.url
);
const RECORD_FIXTURE = new URL('record.json', import.meta.url);
const OUT = new URL(`../../.runs/runs/${RECORD_SHOTS_RUN}/`, import.meta.url);

async function json(url: URL): Promise<unknown> {
	return JSON.parse(await readFile(url, 'utf8')) as unknown;
}

const record = recordSchema.parse(await json(RECORD_FIXTURE));
const manifest = manifestSchema.parse(await json(new URL(RUN_PATHS.manifest, SOURCE_RUN)));
const graded = record.weeks.flatMap((week) => (week.gradedAt === null ? [] : [week.gradedAt]));
const sources = manifest.sources.map((source) =>
	source.artifact === 'record'
		? { ...source, window: { ...source.window, to: graded.toSorted().at(-1) ?? source.window.to } }
		: source
);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(SOURCE_RUN, OUT, { recursive: true });
await writeFile(new URL(RUN_PATHS.record, OUT), JSON.stringify(record));
await writeFile(
	new URL(RUN_PATHS.manifest, OUT),
	JSON.stringify(manifestSchema.parse({ ...manifest, runId: RECORD_SHOTS_RUN, sources }))
);
process.stdout.write(`wrote ${OUT.pathname}\n`);
