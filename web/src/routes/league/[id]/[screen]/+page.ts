import { isScreen } from '#lib/league/inseason/words.ts';
import { FLAGS } from '#lib/site/flags.ts';
import type { PageLoad } from './$types';

/** A followed league's in-season screen: start, waivers or trades while the in-season tools are on;
 * null for any other segment, or with the tools off, which the page answers as not found. */
export const load: PageLoad = ({ params }) => ({
	screen: FLAGS.in_season_tools && isScreen(params.screen) ? params.screen : null
});
