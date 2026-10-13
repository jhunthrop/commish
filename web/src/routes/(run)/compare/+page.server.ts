import { formatChips } from '#lib/server/pages/board.ts';
import type { PageServerLoad } from './$types';

/** The comparison page is built once with no players chosen. The two players come from the query
 * string in the browser (?a=chris-olave&b=nico-collins), which a prerendered page cannot read at build. */
export const load: PageServerLoad = async () => ({ formats: await formatChips() });
