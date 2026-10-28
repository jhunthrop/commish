/** The record's fixtures (Lane 194): the run's record file (record.json, as GET /run/record answers it
 * in its `record` field) in the shape the nightly writes since Lane 114, the weekly and draft records
 * beside the run's own, for the apps' Our record screen. Each is the record shots' run record
 * (web/scripts/record-fixture/record-live.json, the dev store's record on Monday night of week 6)
 * as it is, `waiting` (week 6 set and played, waiting on its stats with the run's gradesFrom, Lane
 * 250), and with its two records added by web/scripts/record-fixture/two.ts: `upcoming`, the state at the run
 * (week 7 not set yet, the draft record's real figures); `graded`, a STAND-IN week 7 graded against
 * ESPN; `published`, the same STAND-IN with the week's published projection beside ESPN. The
 * stand-ins' figures are not a grade of anything (two.ts says how they are made). The contract run's
 * own record (shared/fixtures/run, before Lane 114) is the record with neither. README.md, written
 * beside them, lists each file.
 *
 *   node shared/scripts/export-record.ts */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPOSITORY, generatedBy, writeOutputs, type Outputs } from './generated.ts';

const SCRIPT = 'shared/scripts/export-record.ts';
/** The folder the record's fixtures are written to. */
export const RECORD_FIXTURE = 'shared/fixtures/record';
const LIVE_RECORD = 'web/scripts/record-fixture/record-live.json';
const TWO = 'web/scripts/record-fixture/two.ts';

/** The modes two.ts writes, each with what its file holds. */
export const RECORD_MODES = [
	{
		mode: 'waiting',
		about: "the run's own record alone, week 6 set and waiting on its stats with the day it usually grades"
	},
	{
		mode: 'upcoming',
		about: 'the weekly record before its first week is set, and the draft record'
	},
	{
		mode: 'set',
		about:
			"the weekly record with week 7 set and played, waiting on its stats with the day it usually grades, and the draft record"
	},
	{
		mode: 'set-missed',
		about:
			'the weekly record as `set` with week 6 before it, missed (no order was set before its kickoff)'
	},
	{
		mode: 'graded',
		about: 'the weekly record with a STAND-IN week 7 graded against ESPN, and the draft record'
	},
	{
		mode: 'published',
		about:
			"the STAND-IN week 7 with the week's published projection graded beside ESPN, and the draft record"
	}
] as const;

export type RecordMode = (typeof RECORD_MODES)[number]['mode'];

/** A mode's file under the folder. */
export function recordFile(mode: RecordMode): string {
	return `${RECORD_FIXTURE}/${mode}.json`;
}

/** The record with its two records in a mode, as the run writes it. */
export async function recordIn(mode: RecordMode): Promise<unknown> {
	const live = JSON.parse(await readFile(join(REPOSITORY, LIVE_RECORD), 'utf8')) as unknown;
	if (mode === 'waiting') return live;
	const two = (await import(join(REPOSITORY, TWO))) as {
		withTwoRecords: (record: unknown, mode: Exclude<RecordMode, 'waiting'>) => Promise<unknown>;
	};
	return two.withTwoRecords(live, mode);
}

function readme(): string {
	const rows = RECORD_MODES.map(({ mode, about }) => `| \`${mode}.json\` | ${about} |`);
	return `# The record's fixtures

${generatedBy(SCRIPT, `${LIVE_RECORD} and ${TWO}`)}

The run's record file (\`record.json\`, the \`record\` field of \`GET /run/record\`) with the weekly
and draft records the nightly writes beside the run's own since Lane 114, for the apps' Our record
screen and its parity (\`shared/fixtures/parity/record.json\`). Week 7 graded is a STAND-IN made by
\`${TWO}\` from the live record's week 2: its figures are not a grade of anything. The contract
run's own record (\`shared/fixtures/run\`) is the record before Lane 114, with neither.

| File | What it holds |
| --- | --- |
${rows.join('\n')}
`;
}

export async function generate(): Promise<Outputs> {
	const files = await Promise.all(
		RECORD_MODES.map(async ({ mode }): Promise<[string, string]> => [
			recordFile(mode),
			`${JSON.stringify(await recordIn(mode), null, '\t')}\n`
		])
	);
	return new Map([...files, [`${RECORD_FIXTURE}/README.md`, readme()]]);
}

if (import.meta.main) await writeOutputs(await generate());
