import { buildInstant } from '#lib/server/build-clock.ts';
import { recordHead } from '#lib/server/pages/head.ts';
import { recordPage } from '#lib/server/pages/record.ts';
import { firstKickoff, record } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const [page, { run }, kickoff, loaded] = await Promise.all([
		recordPage(buildInstant()),
		parent(),
		firstKickoff(),
		record()
	]);
	return {
		page,
		head: recordHead(loaded, page.format, {
			firstKickoff: kickoff,
			runAt: run.runAt
		})
	};
};
