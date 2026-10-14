import { manifest } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** The comparison page is built once with no players chosen. The two players come from the query
 * string in the browser (?a=chris-olave&b=nico-collins), which a prerendered page cannot read at build.
 * It carries every format the run has, the default first, so it compares in the context's (the
 * selected league's) when the run carries it. */
export const load: PageServerLoad = async () => ({ formats: (await manifest()).formats });
