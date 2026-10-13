/** The record page: the run's record as written, with the format it is graded in. */
import type { Format, RunRecord } from '#lib/run/schema.ts';
import { formatById, record } from '../run.ts';

export interface RecordPage {
	record: RunRecord;
	format: Format;
}

export async function recordPage(): Promise<RecordPage> {
	const loaded = await record();
	return { record: loaded, format: await formatById(loaded.format) };
}
