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
//        node scripts/record-fixture/run.ts two [upcoming|graded|published]   (Lane 114, two.ts) writes
// web/.runs/runs/2026-10-21T12-two-<mode>/: the live record with the draft and weekly records.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { manifestSchema, recordSchema, RUN_PATHS } from '../../src/lib/run/schema.ts';
import { withTwoRecords, type TwoMode } from './two.ts';
import {
	RECORD_LIVE_RUN_ID,
	RECORD_SHAPE_RUN_ID,
	recordTwoRunId
} from '../inseason-fixture/run-ids.ts';

/** `live` (Lane 93) shoots the record as the nightly writes it from the dev store on Monday night of
 * week 6 (record-live.json): weeks 1 and 2 graded with their players, 3 to 5 not set, 6 waiting.
 * `two` (Lane 114) is the live record with its two records beside it. */
const TWO = process.argv[2] === 'two';
const TWO_MODE: TwoMode =
	process.argv[3] === 'graded' || process.argv[3] === 'published' ? process.argv[3] : 'upcoming';
const LIVE = process.argv[2] === 'live' || TWO;
const RECORD_SHOTS_RUN = TWO
	? recordTwoRunId(TWO_MODE)
	: LIVE
		? RECORD_LIVE_RUN_ID
		: RECORD_SHAPE_RUN_ID;
const SOURCE_RUN = new URL(
	'../../../research/nightly/contract/fixture/runs/2026-10-21T12-ros/',
	import.meta.url
);
const RECORD_FIXTURE = new URL(LIVE ? 'record-live.json' : 'record.json', import.meta.url);
const OUT = new URL(`../../.runs/runs/${RECORD_SHOTS_RUN}/`, import.meta.url);

async function json(url: URL): Promise<unknown> {
	return JSON.parse(await readFile(url, 'utf8')) as unknown;
}

const live = recordSchema.parse(await json(RECORD_FIXTURE));
const record = TWO ? recordSchema.parse(await withTwoRecords(live, TWO_MODE)) : live;
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
